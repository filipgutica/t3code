import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  WorkbenchProjectId,
  type ServerProvider,
} from "@t3tools/contracts";
import { DEFAULT_SERVER_SETTINGS, type ServerSettings } from "@t3tools/contracts/settings";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Project } from "../types";
const observed = vi.hoisted(() => ({
  settings: null as ServerSettings | null,
  beginInput: vi.fn(),
}));
vi.mock("../hooks/useSettings", () => ({ useEnvironmentSettings: () => observed.settings }));
import { usePlanningModelSelection } from "./usePlanningModelSelection";

const environmentId = EnvironmentId.make("environment");
const first = ProjectId.make("native-first");
const anchor = ProjectId.make("workspace-anchor");
const instanceId = ProviderInstanceId.make("codex");
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-11T00:00:00.000Z",
  slashCommands: [],
  skills: [],
  models: ["gpt-first", "gpt-anchor"].map((slug, index) => ({
    slug,
    name: slug,
    isDefault: index === 0,
    isCustom: false,
    capabilities: null,
  })),
};
const projects: Project[] = [first, anchor].map((id, index) => ({
  id,
  environmentId,
  title: id,
  workspaceRoot: `/repos/${id}`,
  scripts: [],
  defaultModelSelection: { instanceId, model: index === 0 ? "gpt-first" : "gpt-anchor" },
  createdAt: provider.checkedAt,
  updatedAt: provider.checkedAt,
}));
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  observed.beginInput.mockReset();
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});
function SelectionHarness() {
  const result = usePlanningModelSelection({
    environmentId,
    workspace: {
      id: WorkbenchProjectId.make("workspace"),
      title: "Test",
      linkedProjectIds: [anchor, first],
      archivedAt: null,
      revision: 0,
      createdAt: provider.checkedAt,
      updatedAt: provider.checkedAt,
    },
    draft: null,
    providers: [provider],
    linkedProjects: projects,
  });
  observed.beginInput(result);
  return null;
}
const mount = () =>
  act(() => {
    renderer = create(<SelectionHarness />);
  });
it("blocks planning when the workspace anchor disables the provider despite native project order", () => {
  observed.settings = {
    ...DEFAULT_SERVER_SETTINGS,
    projectSettingsOverrides: {
      [anchor]: { providerInstances: { [instanceId]: { enabled: false } } },
    },
  };
  mount();
  expect(observed.beginInput).toHaveBeenCalledWith(
    expect.objectContaining({ modelSelection: null }),
  );
});
it("supplies the anchor's enabled provider and default model to planning despite reversed native project order", () => {
  observed.settings = {
    ...DEFAULT_SERVER_SETTINGS,
    providerInstances: { [instanceId]: { driver: provider.driver, enabled: false } },
    projectSettingsOverrides: {
      [anchor]: { providerInstances: { [instanceId]: { enabled: true } } },
    },
  };
  mount();
  expect(observed.beginInput).toHaveBeenCalledWith(
    expect.objectContaining({
      modelSelection: { instanceId, model: "gpt-anchor" },
    }),
  );
});
