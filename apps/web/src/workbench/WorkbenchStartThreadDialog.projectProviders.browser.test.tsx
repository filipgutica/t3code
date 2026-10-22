import { act, render } from "../../test/render";
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
import { type ComponentProps, type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import type { Project } from "../types";
import type { WorkbenchRepositoryScope } from "./workbenchRepositoryScope";
const observed = vi.hoisted(() => ({ settings: null as ServerSettings | null }));
vi.mock("../hooks/useSettings", () => ({ useEnvironmentSettings: () => observed.settings }));
vi.mock("../components/ui/dialog", async () => {
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
      type="button"
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
type StartThread = ComponentProps<typeof WorkbenchStartThreadDialog>["onStart"];
const mount = (start: StartThread) =>
  render(
    <WorkbenchStartThreadDialog
      open
      onOpenChange={() => {}}
      providers={[provider]}
      pending={false}
      onStart={start}
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
const submit = (screen: Awaited<ReturnType<typeof mount>>) =>
  act(() =>
    screen.container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
it("blocks a machine-enabled provider for the selected primary project and rechecks a changed primary", async () => {
  observed.settings = {
    ...DEFAULT_SERVER_SETTINGS,
    projectSettingsOverrides: {
      [first]: { providerInstances: { [instanceId]: { enabled: false } } },
    },
  };
  const start = vi.fn<StartThread>();
  await using screen = await mount(start);
  await submit(screen);
  expect(start).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Use second primary" }).click();
  await submit(screen);
  expect(start).toHaveBeenCalledWith({
    modelSelection: { instanceId, model: "gpt-test" },
    repositoryScope: { primaryT3ProjectId: second, repositoryProjectIds: [first, second] },
  });
});
it("allows a project override to enable a machine-disabled provider", async () => {
  observed.settings = {
    ...DEFAULT_SERVER_SETTINGS,
    providerInstances: { [instanceId]: { driver: provider.driver, enabled: false } },
    projectSettingsOverrides: {
      [first]: { providerInstances: { [instanceId]: { enabled: true } } },
    },
  };
  const start = vi.fn<StartThread>();
  await using screen = await mount(start);
  await submit(screen);
  expect(start).toHaveBeenCalledWith({
    modelSelection: { instanceId, model: "gpt-test" },
    repositoryScope: { primaryT3ProjectId: first, repositoryProjectIds: [first, second] },
  });
});
