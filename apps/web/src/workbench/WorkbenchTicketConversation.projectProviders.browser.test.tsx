import { render } from "../../test/render";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  WorkbenchProjectId,
  type ServerProvider,
} from "@t3tools/contracts";
import { DEFAULT_SERVER_SETTINGS, type ServerSettings } from "@t3tools/contracts/settings";
import { type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import type { Project } from "../types";
const observed = vi.hoisted(() => ({
  settings: null as ServerSettings | null,
  beginInput: vi.fn(),
}));
vi.mock("../hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hooks/useSettings")>()),
  useEnvironmentSettings: () => observed.settings,
}));
vi.mock("../components/ChatView", () => ({ default: () => null }));
vi.mock("../components/WorkspacePageHeader", () => ({
  WorkspacePageHeader: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("./WorkbenchForms", () => ({ WorkbenchInlineError: () => null }));
vi.mock("./WorkbenchTicketDraftPanel", () => ({
  WorkbenchTicketDraftFieldsForm: () => null,
  getTicketDraftCreateState: () => null,
}));
vi.mock("./state", () => ({
  workbenchEnvironment: { beginTicketDraft: "begin", updateTicketDraft: "update" },
}));
vi.mock("./useWorkbenchTicketConversation", () => ({
  useTicketDraftBegin: (
    input: Parameters<typeof import("./useWorkbenchTicketConversation").useTicketDraftBegin>[0],
  ) => {
    observed.beginInput(input);
    return { state: { status: "idle" }, retry: () => {} };
  },
  useTicketDraftEditor: () => null,
  useTicketDraftTransitions: () => null,
}));
import { WorkbenchTicketConversation } from "./WorkbenchTicketConversation";
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
const mount = () => {
  observed.beginInput.mockReset();
  return render(
    <WorkbenchTicketConversation
      environmentId={environmentId}
      workspace={{
        id: WorkbenchProjectId.make("workspace"),
        title: "Test",
        linkedProjectIds: [anchor, first],
        archivedAt: null,
        revision: 0,
        createdAt: provider.checkedAt,
        updatedAt: provider.checkedAt,
      }}
      draft={null}
      requestedDraftId={null}
      ticket={null}
      draftsSupported
      providers={[provider]}
      linkedProjects={projects}
      epics={[]}
      jiraEpics={[]}
      jiraBinding={null}
      localOnlySupported
      jiraOwnershipKnown
      initialEpicId={null}
      refreshSnapshot={() => {}}
      onClose={() => {}}
      onCreateManually={() => {}}
      onCreateEpic={() => {}}
      onDraftPrepared={() => {}}
      onTicketCreated={() => {}}
      onDiscarded={() => {}}
      onWorkStarted={() => {}}
      onShowTicketDetails={() => {}}
    />,
  );
};
it("blocks planning when the workspace anchor disables the provider despite native project order", async () => {
  observed.settings = {
    ...DEFAULT_SERVER_SETTINGS,
    projectSettingsOverrides: {
      [anchor]: { providerInstances: { [instanceId]: { enabled: false } } },
    },
  };
  await using screen = await mount();
  expect(observed.beginInput).toHaveBeenCalledWith(
    expect.objectContaining({ modelSelection: null }),
  );
  await expect
    .element(screen.getByText("Ticket planning needs a supported provider", { exact: false }))
    .toBeVisible();
});
it("supplies the anchor's enabled provider and default model to planning despite reversed native project order", async () => {
  observed.settings = {
    ...DEFAULT_SERVER_SETTINGS,
    providerInstances: { [instanceId]: { driver: provider.driver, enabled: false } },
    projectSettingsOverrides: {
      [anchor]: { providerInstances: { [instanceId]: { enabled: true } } },
    },
  };
  await using screen = await mount();
  expect(observed.beginInput).toHaveBeenCalledWith(
    expect.objectContaining({
      environmentId,
      modelSelection: { instanceId, model: "gpt-anchor" },
    }),
  );
});
