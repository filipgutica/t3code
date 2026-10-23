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
  epicId: null,
  title: "Ship a change",
  markdown: "",
  kind: "story",
  primaryT3ProjectId: projects[0]!.id,
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
      projectId: ticket.primaryT3ProjectId,
      isPrimary: true,
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
}: {
  pending?: boolean;
  repositoryScope?: WorkbenchRepositoryScope;
  availableProjects?: ReadonlyArray<Project>;
  savedTicket?: WorkbenchTicket;
  preparedWorkspace?: WorkbenchTicketWorkspace;
  unprepared?: boolean;
} = {}) => {
  await act(async () =>
    root.render(
      <WorkbenchStartThreadDialog
        open
        onOpenChange={onOpenChange}
        providers={[provider]}
        request={{
          environmentId,
          defaultModelSelection: null,
          ticket: savedTicket,
          projects: availableProjects,
          workspace: unprepared ? undefined : preparedWorkspace,
          initialRepositoryScope: repositoryScope,
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
const labelledButton = (label: string) => {
  const result = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
};
const repositoryList = () =>
  document.querySelector('[aria-label="Work area repositories"]')?.textContent ?? "";
const addRepository = async (label: string) => {
  await act(async () => button("Add repository").click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!option) throw new Error(`Missing repository option: ${label}`);
  await act(async () => option.click());
};
const menuAction = (label: string) => {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((candidate) =>
    candidate.textContent?.startsWith(label),
  );
  if (!item) throw new Error(`Missing menu action: ${label}`);
  return item;
};

it("adds a repository to a prepared work area and submits the reviewed choices", async () => {
  await render();
  await addRepository("Additional");
  expect(repositoryList()).toContain("Adding");
  expect(onOpenChange).not.toHaveBeenCalled();
  await act(async () => button("Create work area and Thread").click());
  expect(onStart).toHaveBeenCalledWith({
    modelSelection: { instanceId: provider.instanceId, model: "gpt-default" },
    repositoryScope: {
      primaryT3ProjectId: ticket.primaryT3ProjectId,
      repositoryProjectIds: projects.map((project) => project.id),
    },
  });
});

it("removes an added repository to reuse the prepared work area and blocks edits while pending", async () => {
  await render();
  await addRepository("Additional");
  await act(async () => labelledButton("Remove Additional").click());
  expect(repositoryList()).not.toContain("Additional");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(onOpenChange).not.toHaveBeenCalled();
  await act(async () => button("Create Thread").click());
  expect(onStart).toHaveBeenCalledWith({
    modelSelection: { instanceId: provider.instanceId, model: "gpt-default" },
  });
  await render({ pending: true });
  expect(button("Add repository").disabled).toBe(true);
  expect(button("Cancel").disabled).toBe(true);
});

it("removes one of many added repositories without losing the primary", async () => {
  const extraProjects = Array.from({ length: 12 }, (_, index) => ({
    ...projects[1]!,
    id: ProjectId.make(`extra-${index}`),
    title: `Extra repository ${index}`,
  }));
  const availableProjects = [...projects, ...extraProjects];
  await render({
    availableProjects,
    repositoryScope: {
      primaryT3ProjectId: ticket.primaryT3ProjectId,
      repositoryProjectIds: availableProjects.map((project) => project.id),
    },
  });
  await act(async () => labelledButton("Remove Extra repository 4").click());
  expect(repositoryList()).not.toContain("Extra repository 4");
  await act(async () => button("Create work area and Thread").click());
  expect(onStart).toHaveBeenCalledWith({
    modelSelection: { instanceId: provider.instanceId, model: "gpt-default" },
    repositoryScope: {
      primaryT3ProjectId: ticket.primaryT3ProjectId,
      repositoryProjectIds: availableProjects
        .filter((project) => project.id !== ProjectId.make("extra-4"))
        .map((project) => project.id),
    },
  });
});

it("lets an unavailable additional repository be removed", async () => {
  const unavailableId = ProjectId.make("unlinked-repository");
  await render({
    repositoryScope: {
      primaryT3ProjectId: ticket.primaryT3ProjectId,
      repositoryProjectIds: [ticket.primaryT3ProjectId, unavailableId],
    },
  });
  expect(button("Create work area and Thread").disabled).toBe(true);
  await act(async () => labelledButton("Remove Repository unavailable").click());
  expect(repositoryList()).toContain("Primary");
  expect(button("Create Thread").disabled).toBe(false);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await act(async () => button("Create Thread").click());
  expect(onStart).toHaveBeenCalledWith({
    modelSelection: { instanceId: provider.instanceId, model: "gpt-default" },
  });
});

it.each(["ready", "failed"] as const)(
  "preserves prepared choices while allowing additions (%s)",
  async (status) => {
    const extra = { ...projects[1]!, id: ProjectId.make("extra"), title: "Extra" };
    const savedTicket = { ...ticket, repositoryProjectIds: projects.map((project) => project.id) };
    const preparedWorkspace = {
      ...workspace,
      status,
      repositories: projects.map((project, index) => ({
        ...workspace.repositories[0]!,
        projectId: project.id,
        isPrimary: index === 0,
        sourcePath: project.workspaceRoot,
        worktreePath: `/worktrees/${project.id}`,
      })),
    };
    await render({ savedTicket, preparedWorkspace, availableProjects: [...projects, extra] });
    expect(document.querySelector('button[aria-label^="Actions for"]')).toBeNull();
    expect(document.querySelector('button[aria-label^="Remove"]')).toBeNull();
    await addRepository("Extra");
    await act(async () => button("Create work area and Thread").click());
    expect(onStart).toHaveBeenCalledWith({
      modelSelection: { instanceId: provider.instanceId, model: "gpt-default" },
      repositoryScope: {
        primaryT3ProjectId: ticket.primaryT3ProjectId,
        repositoryProjectIds: [projects[0]!.id, projects[1]!.id, extra.id],
      },
    });
  },
);

it("stages a removal with undo and keeps the former primary when changing primary", async () => {
  const savedTicket = { ...ticket, repositoryProjectIds: projects.map((project) => project.id) };
  await render({ savedTicket, unprepared: true });
  await act(async () => labelledButton("Actions for Additional").click());
  await act(async () => menuAction("Remove from ticket").click());
  expect(repositoryList()).toContain("Removing");
  await act(async () => button("Undo").click());
  expect(repositoryList()).not.toContain("Removing");
  await act(async () => labelledButton("Actions for Primary").click());
  expect(menuAction("Remove from ticket").getAttribute("aria-disabled")).toBe("true");
  await act(async () => labelledButton("Actions for Additional").click());
  await act(async () => menuAction("Make primary").click());
  await act(async () => button("Create work area and Thread").click());
  expect(onStart).toHaveBeenCalledWith({
    modelSelection: { instanceId: provider.instanceId, model: "gpt-default" },
    repositoryScope: {
      primaryT3ProjectId: projects[1]!.id,
      repositoryProjectIds: projects.map((project) => project.id),
    },
  });
});

it("restores prepared choices from an unsaved narrowing draft", async () => {
  await render({
    repositoryScope: {
      primaryT3ProjectId: projects[1]!.id,
      repositoryProjectIds: [projects[1]!.id],
    },
  });
  await act(async () => button("Create work area and Thread").click());
  expect(onStart).toHaveBeenCalledWith({
    modelSelection: { instanceId: provider.instanceId, model: "gpt-default" },
    repositoryScope: {
      primaryT3ProjectId: ticket.primaryT3ProjectId,
      repositoryProjectIds: [projects[0]!.id, projects[1]!.id],
    },
  });
});

it("keeps a repository removed from the saved ticket excluded despite its retained worktree", async () => {
  await render({
    preparedWorkspace: {
      ...workspace,
      repositories: [
        ...workspace.repositories,
        { ...workspace.repositories[0]!, projectId: projects[1]!.id, isPrimary: false },
      ],
    },
  });
  expect(repositoryList()).not.toContain("Additional");
  await act(async () => button("Create Thread").click());
  expect(onStart).toHaveBeenCalledWith({
    modelSelection: { instanceId: provider.instanceId, model: "gpt-default" },
  });
});

it("lists every selected repository by name", async () => {
  const extraProjects = Array.from({ length: 12 }, (_, index) => ({
    ...projects[1]!,
    id: ProjectId.make(`extra-${index}`),
    title: `Extra repository ${index}`,
  }));
  const availableProjects = [...projects, ...extraProjects];
  await render({
    availableProjects,
    repositoryScope: {
      primaryT3ProjectId: ticket.primaryT3ProjectId,
      repositoryProjectIds: availableProjects.map((project) => project.id),
    },
  });
  const list = document.querySelector('[aria-label="Work area repositories"]');
  for (const project of availableProjects) expect(list?.textContent).toContain(project.title);
});

it("points a locked unavailable repository to relinking instead of removal", async () => {
  const unavailableId = ProjectId.make("unlinked-repository");
  await render({
    savedTicket: { ...ticket, repositoryProjectIds: [ticket.primaryT3ProjectId, unavailableId] },
    preparedWorkspace: {
      ...workspace,
      status: "failed",
      repositories: [
        ...workspace.repositories,
        { ...workspace.repositories[0]!, projectId: unavailableId, isPrimary: false },
      ],
    },
  });
  const alert = document.querySelector('[role="alert"]')?.textContent ?? "";
  expect(alert).toContain("Link it again");
  expect(alert).not.toContain("Remove");
});
