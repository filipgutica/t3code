import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { TicketWorkspaceHost } from "@t3tools/workbench/TicketWorkspaceHost";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layerTest as serverConfigLayerTest } from "../config.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  TextGeneration,
  type BranchNameGenerationInput,
} from "../textGeneration/TextGeneration.ts";
import { ticketWorkspaceHostLayer } from "./TicketWorkspaceService.ts";

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-08T06:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

describe("TicketWorkspaceHost branch generation", () => {
  it.effect("uses native generation with current text or source-control model settings", () =>
    Effect.gen(function* () {
      const first = createModelSelection(ProviderInstanceId.make("codex"), "first-model");
      const second = createModelSelection(ProviderInstanceId.make("codex"), "second-model");
      const writer = createModelSelection(ProviderInstanceId.make("codex"), "writer-model");
      let currentSettings: ServerSettings = {
        ...DEFAULT_SERVER_SETTINGS,
        textGenerationModelSelection: first,
      };
      let availableProviders: ReadonlyArray<ServerProvider> = [provider];
      const calls: BranchNameGenerationInput[] = [];
      const input = {
        cwd: "/repos/kanalytics",
        title: "Validate entity type",
        description: "Filters must match the metric's entity type.",
      };

      yield* Effect.gen(function* () {
        const host = yield* TicketWorkspaceHost;
        expect(yield* host.generateBranchName(input)).toBe("validate-entity-type");
        currentSettings = { ...currentSettings, textGenerationModelSelection: second };
        yield* host.generateBranchName(input);
        currentSettings = { ...currentSettings, sourceControlWriterModelSelection: writer };
        yield* host.generateBranchName(input);
        availableProviders = [];
        yield* host.generateBranchName(input);

        expect(calls).toEqual(
          [first, second, writer, second].map((modelSelection) => ({
            cwd: input.cwd,
            message: `${input.title}\n\n${input.description}`,
            modelSelection,
          })),
        );
      }).pipe(
        Effect.provide(
          ticketWorkspaceHostLayer.pipe(
            Layer.provide(
              Layer.mergeAll(
                serverConfigLayerTest(process.cwd(), { prefix: "t3-workbench-branch-test-" }).pipe(
                  Layer.provide(NodeServices.layer),
                ),
                Layer.mock(GitWorkflowService)({}),
                Layer.mock(ProjectionSnapshotQuery)({}),
                Layer.mock(ServerSettingsService)({
                  getSettings: Effect.sync(() => currentSettings),
                }),
                Layer.mock(ProviderRegistry)({
                  getProviders: Effect.sync(() => availableProviders),
                }),
                Layer.mock(TextGeneration)({
                  generateBranchName: (generationInput) =>
                    Effect.sync(() => {
                      calls.push(generationInput);
                      return { branch: "validate-entity-type" };
                    }),
                }),
              ),
            ),
          ),
        ),
      );
    }),
  );
});
