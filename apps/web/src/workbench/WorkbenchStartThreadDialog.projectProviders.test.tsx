import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type ServerProvider,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import { DEFAULT_SERVER_SETTINGS, type ServerSettings } from "@t3tools/contracts/settings";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Project } from "../types";
import type { WorkbenchRepositoryScope } from "./workbenchRepositoryScope";

const observed = vi.hoisted(() => ({ settings: null as ServerSettings | null }));
vi.mock("../hooks/useSettings", () => ({ useEnvironmentSettings: () => observed.settings }));
vi.mock("../components/ui/dialog", () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => children;
  return {
    Dialog: Wrapper,
    DialogDescription: Wrapper,
    DialogFooter: Wrapper,
    DialogHeader: Wrapper,
    DialogPanel: Wrapper,
    DialogPopup: Wrapper,
    DialogTitle: Wrapper,
  };
});
vi.mock("../components/ui/button", () => ({ Button: "button" }));
vi.mock("../components/chat/ProviderModelPicker", () => ({ ProviderModelPicker: () => null }));
vi.mock("../components/chat/TraitsPicker", () => ({ TraitsPicker: () => null }));
vi.mock("./WorkbenchRepositoryScopeFields", () => ({
  WorkbenchRepositoryScopeFields: ({
    value,
    onChange,
  }: {
    value: WorkbenchRepositoryScope;
    onChange: (value: WorkbenchRepositoryScope) => void;
  }) => (
    <button
      onClick={() => onChange({ ...value, primaryT3ProjectId: value.repositoryProjectIds[1]! })}
    >
      Use second primary
    </button>
  ),
}));
import { WorkbenchStartThreadDialog } from "./WorkbenchStartThreadDialog";

const environmentId = EnvironmentId.make("environment");
const first = ProjectId.make("first");
const second = ProjectId.make("second");
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
  models: [
    { slug: "gpt-test", name: "Test", isDefault: true, isCustom: false, capabilities: null },
  ],
};
const projects: Project[] = [first, second].map((id) => ({
  id,
  environmentId,
  title: id,
  workspaceRoot: `/repos/${id}`,
  scripts: [],
  defaultModelSelection: { instanceId, model: "gpt-test" },
  createdAt: provider.checkedAt,
  updatedAt: provider.checkedAt,
}));
const ticket: WorkbenchTicket = {
  id: WorkbenchTicketId.make("ticket"),
  projectId: WorkbenchProjectId.make("workspace"),
  title: "Test",
  markdown: "",
  kind: "story",
  epicId: null,
  primaryT3ProjectId: first,
  repositoryProjectIds: [first, second],
  status: "todo",
  blocked: false,
  archivedAt: null,
  revision: 0,
  createdAt: provider.checkedAt,
  updatedAt: provider.checkedAt,
};
let renderer: ReactTestRenderer;
const start = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  start.mockClear();
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});
const mount = () =>
  act(() => {
    renderer = create(
      <WorkbenchStartThreadDialog
        open
        onOpenChange={() => {}}
        providers={[provider]}
        pending={false}
        onStart={start}
        onEditRepositories={() => {}}
        error={null}
        request={{
          environmentId,
          ticket,
          projects,
          defaultModelSelection: null,
          workspace: undefined,
          initialRepositoryScope: undefined,
        }}
      />,
    );
  });
const submit = () =>
  act(() => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));

it("blocks a machine-enabled provider for the selected primary project and rechecks a changed primary", () => {
  observed.settings = {
    ...DEFAULT_SERVER_SETTINGS,
    projectSettingsOverrides: {
      [first]: { providerInstances: { [instanceId]: { enabled: false } } },
    },
  };
  mount();
  submit();
  expect(start).not.toHaveBeenCalled();
  act(() => renderer.root.findByProps({ children: "Use second primary" }).props.onClick());
  submit();
  expect(start).toHaveBeenCalledWith({
    modelSelection: { instanceId, model: "gpt-test" },
    repositoryScope: { primaryT3ProjectId: second, repositoryProjectIds: [first, second] },
  });
});

it("allows a project override to enable a machine-disabled provider", () => {
  observed.settings = {
    ...DEFAULT_SERVER_SETTINGS,
    providerInstances: { [instanceId]: { driver: provider.driver, enabled: false } },
    projectSettingsOverrides: {
      [first]: { providerInstances: { [instanceId]: { enabled: true } } },
    },
  };
  mount();
  submit();
  expect(start).toHaveBeenCalledWith({
    modelSelection: { instanceId, model: "gpt-test" },
    repositoryScope: { primaryT3ProjectId: first, repositoryProjectIds: [first, second] },
  });
});
