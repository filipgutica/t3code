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
}: {
  pending?: boolean;
  repositoryScope?: WorkbenchRepositoryScope;
  availableProjects?: ReadonlyArray<Project>;
  savedTicket?: WorkbenchTicket;
  preparedWorkspace?: WorkbenchTicketWorkspace;
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
          workspace: preparedWorkspace,
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
const toggleAdditionalRepository = async (label = "Additional") => {
  const trigger = document.querySelector<HTMLButtonElement>(
    '[aria-label="Additional repositories"]',
  );
  if (!trigger) throw new Error("Missing additional repository picker");
  await act(async () => trigger.click());
  const listbox = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  const option = [...(listbox?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!option) throw new Error("Missing additional repository option");
  await act(async () => option.click());
  await act(async () => trigger.click());
};

it("edits prepared repositories in the dialog and submits the reviewed choices", async () => {
  await render();
  await act(async () => button("Edit repositories").click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Primary repository"]')).not.toBeNull();
  expect(onOpenChange).not.toHaveBeenCalled();
  await toggleAdditionalRepository();
  await act(async () => button("Create work area and Thread").click());
  expect(onStart).toHaveBeenCalledWith({
    modelSelection: { instanceId: provider.instanceId, model: "gpt-default" },
    repositoryScope: {
      primaryT3ProjectId: ticket.primaryT3ProjectId,
      repositoryProjectIds: projects.map((project) => project.id),
    },
  });
});

it("cancels repository edits without abandoning thread creation and blocks edits while pending", async () => {
  await render();
  await act(async () => button("Edit repositories").click());
  await toggleAdditionalRepository();
  await act(async () => button("Cancel repository edits").click());
  expect(document.querySelector('[aria-label="Primary repository"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(onOpenChange).not.toHaveBeenCalled();
  await act(async () => button("Create Thread").click());
  expect(onStart).toHaveBeenCalledWith({
    modelSelection: { instanceId: provider.instanceId, model: "gpt-default" },
  });
  await render({ pending: true });
  expect(button("Edit repositories").disabled).toBe(true);
  expect(button("Cancel").disabled).toBe(true);
});

it("keeps many selections in a compact summary and removes one without losing the primary", async () => {
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
  const trigger = document.querySelector('[aria-label="Additional repositories"]');
  expect(trigger?.textContent).toBe("Additional + 12 more");
  expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector('[role="checkbox"]')).toBeNull();
  await toggleAdditionalRepository("Extra repository 4");
  expect(trigger?.textContent).toBe("Additional + 11 more");
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

it("lets an unavailable additional repository be removed from the dropdown", async () => {
  const unavailableId = ProjectId.make("unlinked-repository");
  await render({
    repositoryScope: {
      primaryT3ProjectId: ticket.primaryT3ProjectId,
      repositoryProjectIds: [ticket.primaryT3ProjectId, unavailableId],
    },
  });
  expect(button("Create work area and Thread").disabled).toBe(true);
  await toggleAdditionalRepository(`Repository unavailable (${unavailableId})`);
  expect(document.querySelector('[aria-label="Work area repositories"]')?.textContent).toContain(
    "Primary",
  );
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
    if (status === "ready") await act(async () => button("Edit repositories").click());
    const primary = document.querySelector<HTMLButtonElement>('[aria-label="Primary repository"]')!;
    await act(async () => primary.click());
    expect(primary.getAttribute("aria-expanded")).toBe("false");
    await toggleAdditionalRepository();
    await toggleAdditionalRepository("Extra");
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
  await act(async () => button("Edit repositories").click());
  expect(document.querySelector('[aria-label="Additional repositories"]')?.textContent).toBe(
    "None",
  );
  await act(async () => button("Create Thread").click());
  expect(onStart).toHaveBeenCalledWith({
    modelSelection: { instanceId: provider.instanceId, model: "gpt-default" },
  });
});
