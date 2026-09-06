import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
  type ModelSelection,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderInstanceEntries } from "../providerInstances";
import { resolveWorkbenchStartThreadSelection } from "./WorkbenchStartThreadDialog";

function provider(
  instanceId: string,
  status: ServerProvider["status"],
  models: ReadonlyArray<ServerProviderModel>,
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status,
    auth: { status: "authenticated" },
    checkedAt: "2026-09-05T00:00:00.000Z",
    models,
    slashCommands: [],
    skills: [],
  };
}

const models: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gpt-default",
    name: "GPT Default",
    isCustom: false,
    isDefault: true,
    capabilities: null,
  },
  {
    slug: "gpt-other",
    name: "GPT Other",
    isCustom: false,
    capabilities: null,
  },
];

describe("Workbench start thread selection", () => {
  it("falls back to a ready provider when the project selection is unavailable", () => {
    const entries = deriveProviderInstanceEntries([
      provider("codex", "warning", models),
      provider("codex_personal", "ready", models),
    ]);
    const preferred: ModelSelection = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-default",
    };

    expect(resolveWorkbenchStartThreadSelection(entries, preferred)).toEqual({
      instanceId: ProviderInstanceId.make("codex_personal"),
      model: "gpt-default",
    });
  });

  it("falls back when the preferred provider instance is missing", () => {
    const entries = deriveProviderInstanceEntries([provider("codex_personal", "ready", models)]);
    const preferred: ModelSelection = {
      instanceId: ProviderInstanceId.make("codex_removed"),
      model: "gpt-default",
    };

    expect(resolveWorkbenchStartThreadSelection(entries, preferred)).toEqual({
      instanceId: ProviderInstanceId.make("codex_personal"),
      model: "gpt-default",
    });
  });

  it("preserves an exact ready project selection, including a custom model", () => {
    const entries = deriveProviderInstanceEntries([provider("codex", "ready", models)]);
    const preferred: ModelSelection = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "custom-model",
    };

    expect(resolveWorkbenchStartThreadSelection(entries, preferred)).toBe(preferred);
  });

  it("returns no selection when no provider is ready", () => {
    const entries = deriveProviderInstanceEntries([provider("codex", "warning", models)]);

    expect(resolveWorkbenchStartThreadSelection(entries, null)).toBeNull();
  });
});
