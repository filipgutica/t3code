import type { RunResult } from "@cursor/sdk";
import { ProviderInstanceId } from "@t3tools/contracts";
import { CursorSettings } from "../settings.ts";
import { describe, expect, it } from "@effect/vitest";

import * as Effect from "effect/Effect";

import * as FileSystem from "effect/FileSystem";

import * as Layer from "effect/Layer";

import * as Schema from "effect/Schema";
import { createModelSelection } from "@t3tools/shared/model";
import { beforeEach, vi } from "vite-plus/test";

import { makeCursorTextGeneration } from "./textGeneration.ts";
import * as CursorSdk from "./CursorSdk.ts";

const cursorSdkMock = vi.hoisted(() => ({
  create: vi.fn<(options: unknown) => Promise<unknown>>(),
  send: vi.fn<(prompt: string) => Promise<unknown>>(),
  close: vi.fn(),
  cancel: vi.fn(async () => {}),
  storeOpen: vi.fn<(options: unknown) => Promise<unknown>>(),
  storeDispose: vi.fn(async () => {}),
  prompt: vi.fn<(prompt: string, options: unknown) => Promise<RunResult>>(async () => ({
    id: "run-cursor-text-generation-test",
    status: "finished",
    result:
      '{"subject":"Add generated commit message","body":"- verify cursor sdk text generation"}',
  })),
}));

vi.mock("./sdk.ts", () => ({
  Agent: { create: cursorSdkMock.create },
  createAgentPlatform: vi.fn(),
  SqliteLocalAgentStore: { open: cursorSdkMock.storeOpen },
}));

let hasCustomPolicy = false;
const layerFs = FileSystem.layerNoop({
  exists: () => Effect.succeed(hasCustomPolicy),
  makeTempDirectoryScoped: () => Effect.succeed("/isolated-text-generation"),
});
const layerTest = Layer.merge(layerFs, CursorSdk.layer);

const decodeCursorSettings = Schema.decodeSync(CursorSettings);
const cursorSettings = decodeCursorSettings({ enabled: true });

beforeEach(() => {
  hasCustomPolicy = false;
  cursorSdkMock.create.mockReset();
  cursorSdkMock.send.mockReset();
  cursorSdkMock.create.mockImplementation(async (options) => {
    cursorSdkMock.send.mockImplementation(async (prompt) => ({
      status: "running",
      cancel: cursorSdkMock.cancel,
      wait: () => cursorSdkMock.prompt(prompt, options),
    }));
    return {
      close: cursorSdkMock.close,
      [Symbol.asyncDispose]: async () => {
        cursorSdkMock.close();
      },
      send: cursorSdkMock.send,
    };
  });
  cursorSdkMock.close.mockClear();
  cursorSdkMock.cancel.mockClear();
  cursorSdkMock.storeDispose.mockClear();
  cursorSdkMock.storeOpen.mockReset();
  cursorSdkMock.storeOpen.mockResolvedValue({ dispose: cursorSdkMock.storeDispose });
  cursorSdkMock.prompt.mockReset();
  cursorSdkMock.prompt.mockResolvedValue({
    id: "run-cursor-text-generation-test",
    status: "finished",
    result:
      '{"subject":"Add generated commit message","body":"- verify cursor sdk text generation"}',
  });
});

describe("CursorTextGeneration", () => {
  it.effect("generates schema-validated structured JSON through the Cursor SDK", () =>
    Effect.gen(function* () {
      cursorSdkMock.prompt.mockResolvedValueOnce({
        id: "run-cursor-structured-generation-test",
        status: "finished",
        result: '{"summary":"Improve request validation for selected analytics fields."}',
      });
      const textGeneration = yield* makeCursorTextGeneration(cursorSettings, {
        CURSOR_API_KEY: "test-cursor-key",
      });
      const generated = yield* textGeneration.generateStructured({
        operation: "generateExample",
        cwd: process.cwd(),
        prompt: "Summarize the supplied content.",
        outputSchema: Schema.Struct({ summary: Schema.String }),
        modelSelection: createModelSelection(ProviderInstanceId.make("cursor"), "composer-2"),
      });
      expect(generated.summary).toBe("Improve request validation for selected analytics fields.");
    }).pipe(Effect.provide(layerTest)),
  );
});
