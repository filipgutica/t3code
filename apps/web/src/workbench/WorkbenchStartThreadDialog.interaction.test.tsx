// @vitest-environment jsdom

import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WorkbenchTicketWorkspaceAttemptId,
  type ServerProvider,
  type WorkbenchProject,
  type WorkbenchTicket,
  type WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Project } from "../types";
import { WorkbenchStartThreadDialog } from "./WorkbenchStartThreadDialog";
import type { WorkbenchRepositoryScope } from "./workbenchRepositoryScope";

vi.mock("../hooks/useSettings", async () => {
  const { DEFAULT_CLIENT_SETTINGS, DEFAULT_SERVER_SETTINGS } =
    await import("@t3tools/contracts/settings");
  return {
    useEnvironmentSettings: () => ({ ...DEFAULT_CLIENT_SETTINGS, ...DEFAULT_SERVER_SETTINGS }),
  };
});
vi.mock("../components/chat/ProviderModelPicker", () => ({ ProviderModelPicker: () => null }));
vi.mock("../components/chat/TraitsPicker", () => ({ TraitsPicker: () => null }));
vi.mock("../composerDraftStore", async () => {
  const Schema = await import("effect/Schema");
  const store = {
    stickyActiveProvider: null,
    stickyModelSelectionByProvider: {},
    setStickyModelSelection: vi.fn(),
  };
  return {
    DraftId: Schema.String.pipe(Schema.brand("DraftId")),
    useComposerDraftStore: (select: (value: typeof store) => unknown) => select(store),
  };
});

const environmentId = EnvironmentId.make("remote");
const timestamp = "2026-10-13T00:00:00.000Z";
const projects: Project[] = ["Primary", "Additional"].map((title) => ({
  id: ProjectId.make(title),
  environmentId,
  title,
  workspaceRoot: `/repos/${title}`,
  defaultModelSelection: null,
  scripts: [],
  createdAt: timestamp,
  updatedAt: timestamp,
}));
const ticket: WorkbenchTicket = {
  id: WorkbenchTicketId.make("ticket"),
  projectId: WorkbenchProjectId.make("workspace"),
  title: "Ship a change",
  markdown: "",
  repositoryProjectIds: [projects[0]!.id],
  status: "todo",
  blocked: false,
  revision: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const workspace: WorkbenchTicketWorkspace = {
  ticketId: ticket.id,
  attemptId: WorkbenchTicketWorkspaceAttemptId.make("attempt"),
  status: "ready",
  branchName: "workbench/ticket",
  errorMessage: null,
  repositories: [
    {
      projectId: projects[0]!.id,
      sourcePath: "/repos/Primary",
      worktreePath: "/worktrees/Primary",
      branchName: "workbench/ticket",
      status: "ready",
      errorMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  createdAt: timestamp,
  updatedAt: timestamp,
};
const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: timestamp,
  models: [
    {
      slug: "gpt-default",
      name: "GPT Default",
      isCustom: false,
      isDefault: true,
      capabilities: null,
    },
  ],
  slashCommands: [],
  skills: [],
};
const onStart = vi.fn();
const onOpenChange = vi.fn();
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = async ({
  pending = false,
  repositoryScope,
  availableProjects = projects,
  savedTicket = ticket,
  preparedWorkspace = workspace,
  unprepared = false,
  repositoryProjectId,
  board,
}: {
  pending?: boolean;
  repositoryScope?: WorkbenchRepositoryScope;
  availableProjects?: ReadonlyArray<Project>;
  savedTicket?: WorkbenchTicket;
  preparedWorkspace?: WorkbenchTicketWorkspace;
  unprepared?: boolean;
  repositoryProjectId?: ProjectId;
  board?: Pick<WorkbenchProject, "remoteProjects">;
} = {}) => {
  await act(async () =>
    root.render(
      <WorkbenchStartThreadDialog
        open
        onOpenChange={onOpenChange}
        providers={[provider]}
        request={{
          environmentId,
          ticket: savedTicket,
          projects: availableProjects,
          workspace: unprepared ? undefined : preparedWorkspace,
          initialRepositoryScope: repositoryScope,
          repositoryProjectId,
          board,
          additional: true,
        }}
        pending={pending}
        onStart={onStart}
        error={null}
      />,
    ),
  );
};
const button = (label: string) => {
  const result = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
};
const repositoryTrigger = () => {
  const result = document.querySelector<HTMLButtonElement>(
    'button[aria-label^="Thread repository"]',
  );
  if (!result) throw new Error("Missing repository control");
  return result;
};
const openRepositoryMenu = () => act(async () => repositoryTrigger().click());
const menuItem = (role: "menuitemradio" | "menuitem", label: string) => {
  const item = [...document.querySelectorAll<HTMLElement>(`[role="${role}"]`)].find((candidate) =>
    candidate.textContent?.startsWith(label),
  );
  if (!item) throw new Error(`Missing ${role}: ${label}`);
  return item;
};
const radioLabels = () =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].map(
    (item) => item.textContent,
  );
const pickWorkspaceRepository = async (label: string) => {
  await openRepositoryMenu();
  await act(async () => menuItem("menuitem", "Add repository").click());
  await act(async () => menuItem("menuitem", label).click());
};
const bothRepositories = { ...ticket, repositoryProjectIds: projects.map((project) => project.id) };
const bothPrepared = {
  ...workspace,
  repositories: projects.map((project) => ({
    ...workspace.repositories[0]!,
    projectId: project.id,
    sourcePath: project.workspaceRoot,
    worktreePath: `/worktrees/${project.id}`,
  })),
};
const extra = { ...projects[1]!, id: ProjectId.make("extra"), title: "Extra" };
const modelSelection = { instanceId: provider.instanceId, model: "gpt-default" };

it("defaults to the repository of the Ticket's last active Thread", async () => {
  await render({
    savedTicket: bothRepositories,
    preparedWorkspace: bothPrepared,
    repositoryProjectId: projects[1]!.id,
  });
  expect(repositoryTrigger().textContent).toBe("Additional");
  expect(document.body.textContent).toContain(
    "Works in the prepared Additional worktree. Last used by this ticket’s Threads.",
  );
  await act(async () => button("Create Thread").click());
  expect(onStart).toHaveBeenCalledWith({ modelSelection, repositoryProjectId: projects[1]!.id });
});

it("starts the Thread in another linked repository the user picks", async () => {
  await render({
    savedTicket: bothRepositories,
    preparedWorkspace: bothPrepared,
    repositoryProjectId: projects[1]!.id,
  });
  await openRepositoryMenu();
  expect(radioLabels()).toEqual(["PrimaryPrepared", "AdditionalPrepared"]);
  await act(async () => menuItem("menuitemradio", "Primary").click());
  expect(document.body.textContent).toContain("Works in the prepared Primary worktree.");
  expect(document.body.textContent).not.toContain("Last used");
  await act(async () => button("Create Thread").click());
  expect(onStart).toHaveBeenCalledWith({ modelSelection, repositoryProjectId: projects[0]!.id });
});

it("links a picked Workspace repository to the Ticket and starts the Thread there", async () => {
  await render({ savedTicket: bothRepositories, availableProjects: [...projects, extra] });
  await pickWorkspaceRepository("Extra");
  expect(repositoryTrigger().textContent).toBe("Extra");
  expect(document.body.textContent).toContain(
    "Extra will be linked to this ticket and prepared on its branch.",
  );
  await act(async () => button("Create worktrees and Thread").click());
  expect(onStart).toHaveBeenCalledWith({
    modelSelection,
    repositoryProjectId: extra.id,
    repositoryScope: { repositoryProjectIds: [...bothRepositories.repositoryProjectIds, extra.id] },
  });
});

it("discards a pending repository addition when a linked repository is picked", async () => {
  await render({ availableProjects: [...projects, extra] });
  await pickWorkspaceRepository("Extra");
  await openRepositoryMenu();
  await act(async () => menuItem("menuitemradio", "Primary").click());
  expect(document.body.textContent).not.toContain("will be linked");
  await act(async () => button("Create Thread").click());
  expect(onStart).toHaveBeenCalledWith({ modelSelection, repositoryProjectId: projects[0]!.id });
});

it("leaves the Ticket unchanged when canceled after picking a repository to add", async () => {
  await render();
  await pickWorkspaceRepository("Additional");
  await act(async () => button("Cancel").click());
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(onStart).not.toHaveBeenCalled();
});

it("hides Add repository when every Workspace repository is on the Ticket", async () => {
  await render({ savedTicket: bothRepositories, preparedWorkspace: bothPrepared });
  await openRepositoryMenu();
  expect(radioLabels()).toHaveLength(2);
  expect(document.body.textContent).not.toContain("Add repository");
});

it("prepares an unprepared repository before starting there", async () => {
  await render({ savedTicket: bothRepositories, repositoryProjectId: projects[1]!.id });
  expect(document.body.textContent).toContain(
    "Creating the Thread prepares a worktree for Additional.",
  );
  await act(async () => button("Create worktrees and Thread").click());
  expect(onStart).toHaveBeenCalledWith({
    modelSelection,
    repositoryProjectId: projects[1]!.id,
    repositoryScope: { repositoryProjectIds: bothRepositories.repositoryProjectIds },
  });
});

it("restores prepared choices from an unsaved narrowing draft", async () => {
  await render({ repositoryScope: { repositoryProjectIds: [projects[1]!.id] } });
  expect(document.body.textContent).toContain(
    "Repository changes apply when you create the Thread.",
  );
  await act(async () => button("Create worktrees and Thread").click());
  expect(onStart).toHaveBeenCalledWith({
    modelSelection,
    repositoryProjectId: projects[1]!.id,
    repositoryScope: { repositoryProjectIds: [projects[1]!.id, projects[0]!.id] },
  });
});

it("keeps the saved repository order when only a later repository is prepared", async () => {
  await render({
    savedTicket: bothRepositories,
    preparedWorkspace: { ...bothPrepared, repositories: [bothPrepared.repositories[1]!] },
  });
  expect(document.body.textContent).not.toContain("Repository changes apply");
  await act(async () => button("Create worktrees and Thread").click());
  expect(onStart).toHaveBeenCalledWith({
    modelSelection,
    repositoryProjectId: projects[0]!.id,
    repositoryScope: { repositoryProjectIds: bothRepositories.repositoryProjectIds },
  });
});

it("keeps a repository removed from the saved ticket excluded despite its retained worktree", async () => {
  await render({ preparedWorkspace: bothPrepared });
  await openRepositoryMenu();
  expect(radioLabels()).toEqual(["PrimaryPrepared"]);
  await act(async () => button("Create Thread").click());
  expect(onStart).toHaveBeenCalledWith({ modelSelection, repositoryProjectId: projects[0]!.id });
});

it("blocks starting while a Ticket repository is no longer linked to the Workspace", async () => {
  const unavailableId = ProjectId.make("unlinked-repository");
  await render({
    savedTicket: { ...ticket, repositoryProjectIds: [projects[0]!.id, unavailableId] },
  });
  const alert = document.querySelector('[role="alert"]')?.textContent ?? "";
  expect(alert).toContain("Link it again");
  expect(alert).not.toContain("Remove");
  expect(button("Create worktrees and Thread").disabled).toBe(true);
});

it("starts a host Thread when the Ticket also scopes a repository on another machine", async () => {
  const remoteId = ProjectId.make("remote-repository");
  await render({
    savedTicket: { ...ticket, repositoryProjectIds: [remoteId, projects[0]!.id] },
    board: {
      remoteProjects: {
        [remoteId]: {
          environmentId: EnvironmentId.make("laptop"),
          environmentLabel: "Laptop",
          projectTitle: "Remote",
        },
      },
    },
  });
  await openRepositoryMenu();
  expect(radioLabels()).toEqual(["PrimaryPrepared"]);
  await act(async () => button("Create Thread").click());
  expect(onStart).toHaveBeenCalledWith({ modelSelection, repositoryProjectId: projects[0]!.id });
});

it("shows why a Ticket repository failed to prepare", async () => {
  await render({
    savedTicket: bothRepositories,
    preparedWorkspace: {
      ...bothPrepared,
      status: "failed",
      repositories: [
        bothPrepared.repositories[0]!,
        {
          ...bothPrepared.repositories[1]!,
          status: "failed",
          errorMessage: "Branch is checked out",
        },
      ],
    },
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Additional: Branch is checked out",
  );
});

it.each([
  ["pending", { pending: true }],
  ["preparing", { preparedWorkspace: { ...workspace, status: "preparing" as const } }],
])("locks the repository choice while %s", async (_, state) => {
  await render(state);
  expect(repositoryTrigger().disabled).toBe(true);
});
