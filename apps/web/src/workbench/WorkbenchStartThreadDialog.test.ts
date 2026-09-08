import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
  type ModelSelection,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderInstanceEntries } from "../providerInstances";
import {
  isWorkbenchStartThreadSelectionAvailable,
  resolveWorkbenchStartThreadSelection,
  resolveWorkbenchStartThreadSelectionWithFallback,
} from "./WorkbenchStartThreadDialog";

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
  const modelOptions = new Map(
    [ProviderInstanceId.make("codex"), ProviderInstanceId.make("codex_personal")].map(
      (instanceId) => [instanceId, models] as const,
    ),
  );

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

  it("uses the sticky selection when there is no project default", () => {
    const entries = deriveProviderInstanceEntries([provider("codex", "ready", models)]);
    const stickySelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-other", [
      { id: "reasoningEffort", value: "high" },
    ]);

    expect(
      resolveWorkbenchStartThreadSelectionWithFallback({
        entries,
        explicitSelection: null,
        projectSelection: null,
        stickySelection,
        modelOptionsByInstance: modelOptions,
      }),
    ).toEqual(stickySelection);
  });

  it("prefers the project default over the sticky selection", () => {
    const entries = deriveProviderInstanceEntries([provider("codex", "ready", models)]);
    const stickySelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-removed", [
      { id: "reasoningEffort", value: "high" },
    ]);
    const projectSelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-default");

    expect(
      resolveWorkbenchStartThreadSelectionWithFallback({
        entries,
        explicitSelection: null,
        projectSelection,
        stickySelection,
        modelOptionsByInstance: modelOptions,
      }),
    ).toEqual(projectSelection);
    expect(isWorkbenchStartThreadSelectionAvailable(entries, stickySelection, modelOptions)).toBe(
      false,
    );
  });

  it("lets an in-dialog explicit choice override the project default", () => {
    const entries = deriveProviderInstanceEntries([provider("codex", "ready", models)]);
    const explicitSelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-other", [
      { id: "reasoningEffort", value: "high" },
    ]);
    const projectSelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-default");
    const stickySelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-default");

    expect(
      resolveWorkbenchStartThreadSelectionWithFallback({
        entries,
        explicitSelection,
        projectSelection,
        stickySelection,
        modelOptionsByInstance: modelOptions,
      }),
    ).toEqual(explicitSelection);
  });

  it("falls back to the provider when project and sticky selections are unavailable", () => {
    const entries = deriveProviderInstanceEntries([provider("codex", "ready", models)]);
    const projectSelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-removed");
    const stickySelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-missing");

    expect(
      resolveWorkbenchStartThreadSelectionWithFallback({
        entries,
        explicitSelection: null,
        projectSelection,
        stickySelection,
        modelOptionsByInstance: modelOptions,
      }),
    ).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-default",
    });
  });

  it("falls back to the project selection when the sticky provider is unavailable", () => {
    const entries = deriveProviderInstanceEntries([
      provider("codex", "warning", models),
      provider("codex_personal", "ready", models),
    ]);
    const stickySelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-other");
    const projectSelection = createModelSelection(
      ProviderInstanceId.make("codex_personal"),
      "gpt-default",
    );

    expect(
      resolveWorkbenchStartThreadSelectionWithFallback({
        entries,
        explicitSelection: null,
        projectSelection,
        stickySelection,
        modelOptionsByInstance: modelOptions,
      }),
    ).toEqual(projectSelection);
  });

  it("returns no selection when no provider is ready", () => {
    const entries = deriveProviderInstanceEntries([provider("codex", "warning", models)]);

    expect(resolveWorkbenchStartThreadSelection(entries, null)).toBeNull();
  });
});
