import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WorkbenchTicketWorkspaceAttemptId,
  type ModelSelection,
  type WorkbenchAssignment,
  type WorkbenchSnapshot,
  type WorkbenchTicket,
  type WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { act, useEffect, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { makeThreadFixture } from "../test-fixtures";
import { useWorkbenchThreadActions } from "./useWorkbenchThreadActions";
import type { WorkbenchRepositoryScopeDraft } from "./workbenchRepositoryScope";

const commands = vi.hoisted(() => ({
  unarchive: vi.fn(),
  createThread: vi.fn(),
  deleteThread: vi.fn(),
  updateTicket: vi.fn(),
  createAssignment: vi.fn(),
  replaceAssignment: vi.fn(),
  unlinkAssignment: vi.fn(),
  prepareTicketWorkspace: vi.fn(),
}));
const nativeDelete = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => ({ workbench: vi.fn(), archived: vi.fn() }));
vi.mock("../state/threads", () => ({
  threadEnvironment: {
    unarchive: "unarchive",
    create: "createThread",
    delete: "deleteThread",
  },
}));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    updateTicket: "updateTicket",
    createAssignment: "createAssignment",
    replaceAssignment: "replaceAssignment",
    unlinkAssignment: "unlinkAssignment",
    prepareTicketWorkspace: "prepareTicketWorkspace",
  },
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: keyof typeof commands) => commands[command],
}));
vi.mock("../hooks/useThreadActions", () => ({
  useThreadActions: () => ({ confirmAndDeleteThread: nativeDelete }),
}));
// Native shell synchronization is external to the repository review guards.
vi.mock("./waitForWorkbenchThread", () => ({
  waitForWorkbenchThread: async () => {},
}));

const environmentId = EnvironmentId.make("remote");
const createdAt = "2026-10-09T00:00:00.000Z";
const projectId = ProjectId.make("repository");
const otherProjectId = ProjectId.make("other-repository");
const modelSelection: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5",
};
const repository = {
  id: projectId,
  environmentId,
  title: "Repository",
  workspaceRoot: "/repos/repository",
  defaultModelSelection: modelSelection,
  scripts: [],
  createdAt,
  updatedAt: createdAt,
};
const workspace = {
  id: WorkbenchProjectId.make("workspace"),
  title: "Delivery",
  linkedProjectIds: [projectId, otherProjectId],
  archivedAt: null,
  revision: 0,
  createdAt,
  updatedAt: createdAt,
};
const ticket: WorkbenchTicket = {
  id: WorkbenchTicketId.make("ticket"),
  projectId: workspace.id,
  epicId: null,
  title: "Delivery Ticket",
  markdown: "",
  kind: "story",
  primaryT3ProjectId: projectId,
  repositoryProjectIds: [projectId],
  status: "todo",
  blocked: false,
  archivedAt: null,
  revision: 0,
  createdAt,
  updatedAt: createdAt,
};
const assignment: WorkbenchAssignment = {
  id: WorkbenchAssignmentId.make("assignment"),
  ticketId: ticket.id,
  threadId: ThreadId.make("linked-thread"),
  supersededAt: null,
  createdAt,
};
const readyWorkspace: WorkbenchTicketWorkspace = {
  ticketId: ticket.id,
  attemptId: WorkbenchTicketWorkspaceAttemptId.make("attempt"),
  status: "ready",
  branchName: "workbench/ticket",
  errorMessage: null,
  repositories: [
    {
      projectId,
      isPrimary: true,
      sourcePath: repository.workspaceRoot,
      worktreePath: "/worktrees/ticket/repository",
      branchName: "workbench/ticket",
      status: "ready",
      errorMessage: null,
      createdAt,
      updatedAt: createdAt,
    },
  ],
  createdAt,
  updatedAt: createdAt,
};
const snapshot: WorkbenchSnapshot = {
  projects: [workspace],
  tickets: [ticket],
  epics: [],
  assignments: [],
  ticketWorkspaces: [],
  reservedThreadIds: [],
};
type HookInput = Parameters<typeof useWorkbenchThreadActions>[0];
type HarnessInput = {
  snapshot: WorkbenchSnapshot;
  environmentId: EnvironmentId | null;
  existingThreadIds: ReadonlySet<ThreadId>;
  repositoryScopeDraft: WorkbenchRepositoryScopeDraft | null;
};
function pageData(input: HarnessInput): HookInput["pageData"] {
  const query = {
    resultIdentity: {},
    data: input.snapshot,
    dataUpdatedAt: 0,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: true,
    refresh: refresh.workbench,
  };
  const projects = [
    repository,
    { ...repository, id: otherProjectId, title: "Other Repository" },
  ].map((project) => ({ ...project, environmentId: input.environmentId ?? environmentId }));
  return {
    snapshot: input.snapshot,
    snapshotProjects: input.snapshot.projects,
    projects,
    repositoriesById: new Map(projects.map((project) => [project.id, project])),
    providers: [],
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    availableEditors: [],
    query,
    jiraQuery: { ...query, data: null },
    jiraSnapshot: null,
    refreshWorkbenchSnapshot: query.refresh,
    refreshJiraSnapshot: vi.fn(),
    ticketDrafts: new Map(),
    clearTicketDraft: vi.fn(),
    optimisticStatus: {
      tickets: input.snapshot.tickets,
      issueLinks: [],
      pendingTicketIds: new Set(),
      begin: () => false,
      succeed: vi.fn(),
      fail: vi.fn(),
    },
    assignmentsByTicket: new Map(
      input.snapshot.assignments.map((value) => [value.ticketId, value]),
    ),
    existingThreadIds: new Set(input.existingThreadIds),
    reservedThreadIds: new Set(),
    threadsById: new Map(
      [...input.existingThreadIds].map((id) => [
        id,
        makeThreadFixture({ id, projectId, environmentId: input.environmentId ?? environmentId }),
      ]),
    ),
    archivedThreadsById: new Map(),
    threadLookupReady: true,
    archivedThreadsError: null,
    refreshArchivedThreads: refresh.archived,
  };
}

let actions: ReturnType<typeof useWorkbenchThreadActions>;
let error: string | null;
let pending: string | null;
let renderer: ReactTestRenderer | undefined;
function Harness({ input }: { input: HarnessInput }) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [message, setError] = useState<string | null>(null);
  const current = useWorkbenchThreadActions({
    environmentId: input.environmentId,
    pageData: pageData(input),
    selectedTicket: input.snapshot.tickets[0] ?? null,
    pendingAction,
    setPendingAction,
    setError,
    ticketForBoardAction: (value) => value,
    repositoryScopeDraft: input.repositoryScopeDraft,
    clearRepositoryScope: vi.fn(),
    acceptSavedRepositoryScope: vi.fn(),
    onEditRepositories: vi.fn(),
  });
  useEffect(() => {
    actions = current;
    error = message;
    pending = pendingAction;
  }, [current, message, pendingAction]);
  return null;
}
async function mount(overrides: Partial<HarnessInput> = {}) {
  let input: HarnessInput = {
    snapshot,
    environmentId,
    existingThreadIds: new Set(),
    repositoryScopeDraft: null,
    ...overrides,
  };
  const root = createRootRoute();
  const workbench = createRoute({ getParentRoute: () => root, path: "/workbench" });
  const nativeThread = createRoute({
    getParentRoute: () => root,
    path: "/$environmentId/$threadId",
  });
  const router = createRouter({
    routeTree: root.addChildren([workbench, nativeThread]),
    history: createMemoryHistory({ initialEntries: ["/workbench"] }),
  });
  await router.load();
  const page = () => (
    <RouterContextProvider router={router}>
      <Harness input={input} />
    </RouterContextProvider>
  );
  await act(async () => {
    renderer = create(page());
  });
  return {
    router,
    update: async (changes: Partial<HarnessInput>) => {
      input = { ...input, ...changes };
      await act(async () => renderer?.update(page()));
    },
  };
}
const confirm = async () => {
  await act(async () => {
    const repositoryScope = actions.startThreadRequest?.repositoryScope;
    await actions.startSelectedThread({
      modelSelection,
      ...(repositoryScope ? { repositoryScope } : {}),
    });
  });
};
const expectNoStartEffects = () => {
  expect(commands.updateTicket).not.toHaveBeenCalled();
  expect(commands.prepareTicketWorkspace).not.toHaveBeenCalled();
  expect(commands.createThread).not.toHaveBeenCalled();
  expect(commands.createAssignment).not.toHaveBeenCalled();
  expect(commands.replaceAssignment).not.toHaveBeenCalled();
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const command of Object.values(commands)) {
    command.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  }
  commands.updateTicket.mockResolvedValue(AsyncResult.success(ticket));
  commands.prepareTicketWorkspace.mockResolvedValue(AsyncResult.success(readyWorkspace));
  nativeDelete.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  refresh.workbench.mockReset();
  refresh.archived.mockReset();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("linked Thread failure recovery", () => {
  it("retains a failed attach for retry, then links and opens the selected native Thread", async () => {
    const { router, update } = await mount({ existingThreadIds: new Set([assignment.threadId]) });
    commands.createAssignment.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("Assignment could not be saved."))),
    );
    await act(async () => actions.setAttachThreadTicket(ticket));
    await act(async () => actions.attachExistingThread(assignment.threadId));
    expect(actions.attachThreadTicket?.id).toBe(ticket.id);
    expect(error).toBe("Assignment could not be saved.");
    expect(pending).toBeNull();
    expect(router.state.location.pathname).toBe("/workbench");
    expect(commands.createThread).not.toHaveBeenCalled();

    await update({
      snapshot: {
        ...snapshot,
        tickets: [{ ...ticket, id: WorkbenchTicketId.make("other-selected-ticket") }, ticket],
      },
    });
    await act(async () => actions.attachExistingThread(assignment.threadId));
    expect(commands.createAssignment).toHaveBeenCalledTimes(2);
    expect(commands.createAssignment).toHaveBeenLastCalledWith({
      environmentId,
      input: {
        id: expect.any(String),
        ticketId: ticket.id,
        threadId: assignment.threadId,
        createdAt: expect.any(String),
      },
    });
    expect(actions.attachThreadTicket).toBeNull();
    expect(error).toBeNull();
    expect(pending).toBeNull();
    expect(router.state.location.pathname).toBe("/remote/linked-thread");
    expect(router.state.location.search).toEqual({ workbench: true });
    expect(commands.createThread).not.toHaveBeenCalled();
  });

  it("reports an unlink failure and releases pending state so another action remains usable", async () => {
    await mount({
      snapshot: { ...snapshot, assignments: [assignment] },
      existingThreadIds: new Set([assignment.threadId]),
    });
    commands.unlinkAssignment.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("Thread link could not be removed."))),
    );
    await act(async () => actions.unlinkThread(assignment.threadId));
    expect(error).toBe("Thread link could not be removed.");
    expect(pending).toBeNull();
    expect(commands.unlinkAssignment).toHaveBeenCalledWith({
      environmentId,
      input: { ticketId: ticket.id, threadId: assignment.threadId },
    });
    await act(async () => actions.requestNewThread(ticket));
    expect(actions.startThreadRequest?.ticket.id).toBe(ticket.id);
    expect(error).toBeNull();
    expect(commands.createThread).not.toHaveBeenCalled();
  });

  it("refreshes lookup after native deletion fails and unlocks the page", async () => {
    await mount({
      snapshot: { ...snapshot, assignments: [assignment] },
      existingThreadIds: new Set([assignment.threadId]),
    });
    const failure = AsyncResult.failure(
      Cause.fail(new Error("Native Thread could not be deleted.")),
    );
    let finishDeletion: (result: typeof failure) => void = () => {};
    nativeDelete.mockReturnValueOnce(
      new Promise<typeof failure>((resolve) => {
        finishDeletion = resolve;
      }),
    );
    let deletion: Promise<void> | undefined;
    await act(() => {
      deletion = actions.deleteAssignedThread(assignment.threadId);
    });
    expect(pending).toBe(`delete-thread:${assignment.threadId}`);
    await act(async () => actions.requestNewThread(ticket));
    expect(actions.startThreadRequest).toBeNull();
    expect(refresh.workbench).not.toHaveBeenCalled();
    expect(refresh.archived).not.toHaveBeenCalled();

    await act(async () => {
      finishDeletion(failure);
      await deletion;
    });
    expect(error).toBe("Native Thread could not be deleted.");
    expect(pending).toBeNull();
    expect(refresh.workbench).toHaveBeenCalledOnce();
    expect(refresh.archived).toHaveBeenCalledOnce();
    expect(nativeDelete).toHaveBeenCalledOnce();
    expect(nativeDelete).toHaveBeenCalledWith(
      { environmentId, threadId: assignment.threadId },
      { preserveWorktree: true },
    );
    await act(async () => actions.requestNewThread(ticket));
    expect(actions.startThreadRequest?.ticket.id).toBe(ticket.id);
    expect(error).toBeNull();
    expect(commands.createThread).not.toHaveBeenCalled();
  });
});

describe("Thread repository review", () => {
  it.each(["new", "replacement", "missing-linked"] as const)(
    "blocks the %s creation entry point in an archived Workspace",
    async (entry) => {
      await mount({
        snapshot: {
          ...snapshot,
          projects: [{ ...workspace, archivedAt: createdAt }],
          assignments: entry === "missing-linked" ? [assignment] : [],
        },
      });
      await act(async () => {
        if (entry === "new") actions.requestNewThread(ticket);
        else if (entry === "replacement") {
          actions.requestReplacementThread({ ticket, previousThreadId: assignment.threadId });
        } else actions.requestTicketThread(ticket, assignment.threadId);
      });
      expect(actions.startThreadRequest).toBeNull();
      expect(error).toBe("Restore this Workspace before creating a Thread.");
      expectNoStartEffects();
    },
  );

  it("opens a linked native Thread from an archived Workspace without creating a replacement", async () => {
    const { router } = await mount({
      snapshot: {
        ...snapshot,
        projects: [{ ...workspace, archivedAt: createdAt }],
        assignments: [assignment],
      },
      existingThreadIds: new Set([assignment.threadId]),
    });
    await act(async () => actions.requestTicketThread(ticket, assignment.threadId));
    expect(router.state.location.pathname).toBe("/remote/linked-thread");
    expect(router.state.location.search).toEqual({ workbench: true });
    expect(actions.startThreadRequest).toBeNull();
    expect(error).toBeNull();
    expect(pending).toBeNull();
    expectNoStartEffects();
  });

  it.each([
    {
      change: "Workspace archived",
      projects: [{ ...workspace, archivedAt: createdAt }],
      tickets: [ticket],
    },
    { change: "Workspace deleted", projects: [], tickets: [ticket] },
    {
      change: "Ticket archived",
      projects: [workspace],
      tickets: [{ ...ticket, archivedAt: createdAt }],
    },
    { change: "Ticket deleted", projects: [workspace], tickets: [] },
  ])(
    "closes an invalid review after $change before confirmation",
    async ({ projects, tickets }) => {
      const { update, router } = await mount();
      await act(async () => actions.requestNewThread(ticket));
      expect(actions.startThreadRequest?.ticket.id).toBe(ticket.id);
      await update({ snapshot: { ...snapshot, projects, tickets } });
      await confirm();
      expect(actions.startThreadRequest).toBeNull();
      expect(error).toBe("This Ticket is no longer available for a new Thread.");
      expect(router.state.location.pathname).toBe("/workbench");
      expectNoStartEffects();
    },
  );

  it("refreshes changed repository choices before allowing a second confirmation", async () => {
    const { update, router } = await mount();
    await act(async () => actions.requestNewThread(ticket));
    const revisedTicket = {
      ...ticket,
      revision: 1,
      primaryT3ProjectId: otherProjectId,
      repositoryProjectIds: [otherProjectId],
    };
    await update({ snapshot: { ...snapshot, tickets: [revisedTicket] } });
    await confirm();
    expect(error).toBe(
      "This Ticket changed. Review its current repository choices before creating a Thread.",
    );
    expect(actions.startThreadRequest).toMatchObject({
      ticket: revisedTicket,
      reviewVersion: 1,
      repositoryScope: {
        primaryT3ProjectId: otherProjectId,
        repositoryProjectIds: [otherProjectId],
      },
    });
    expectNoStartEffects();
    commands.prepareTicketWorkspace.mockResolvedValue(
      AsyncResult.success({
        ...readyWorkspace,
        repositories: readyWorkspace.repositories.map((value) => ({
          ...value,
          projectId: otherProjectId,
        })),
      }),
    );
    await confirm();
    expect(commands.createThread).toHaveBeenCalledOnce();
    expect(commands.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId,
        input: expect.objectContaining({ projectId: otherProjectId }),
      }),
    );
    expect(router.state.location.pathname).toMatch(/^\/remote\//);
    expect(actions.startThreadRequest).toBeNull();
    expect(error).toBeNull();
    expect(pending).toBeNull();
  });

  it.each(["preparing", "releasing"] as const)(
    "keeps the review usable while %s blocks confirmation",
    async (status) => {
      const { update, router } = await mount();
      await act(async () => actions.requestNewThread(ticket));
      await update({
        snapshot: { ...snapshot, ticketWorkspaces: [{ ...readyWorkspace, status }] },
      });
      await confirm();
      expect(error).toBe(
        "Wait for workspace preparation or release to finish before creating a Thread.",
      );
      expect(actions.startThreadRequest?.ticket.id).toBe(ticket.id);
      expectNoStartEffects();
      await update({ snapshot: { ...snapshot, ticketWorkspaces: [readyWorkspace] } });
      await confirm();
      expect(commands.createThread).toHaveBeenCalledOnce();
      expect(router.state.location.pathname).toMatch(/^\/remote\//);
      expect(actions.startThreadRequest).toBeNull();
      expect(error).toBeNull();
    },
  );

  it("requires saving or cancelling repository edits for an already prepared Ticket", async () => {
    const draft: WorkbenchRepositoryScopeDraft = {
      environmentId,
      ticket,
      prepare: false,
      value: { primaryT3ProjectId: otherProjectId, repositoryProjectIds: [otherProjectId] },
    };
    const { update } = await mount({
      snapshot: { ...snapshot, ticketWorkspaces: [readyWorkspace] },
      repositoryScopeDraft: draft,
    });
    await act(async () => actions.requestNewThread(ticket));
    expect(actions.startThreadRequest).toBeNull();
    expect(error).toBe("Save or cancel repository edits before creating another Thread.");
    expectNoStartEffects();
    await update({ repositoryScopeDraft: null });
    await act(async () => actions.requestNewThread(ticket));
    await confirm();
    expect(commands.createThread).toHaveBeenCalledOnce();
    expect(actions.startThreadRequest).toBeNull();
    expect(error).toBeNull();
  });

  it("does not confirm a prior environment's review on the newly selected host", async () => {
    const { update, router } = await mount();
    await act(async () => actions.requestNewThread(ticket));
    const otherEnvironmentId = EnvironmentId.make("other-host");
    await update({ environmentId: otherEnvironmentId });
    await confirm();
    expect(actions.startThreadRequest?.environmentId).toBe(environmentId);
    expect(router.state.location.pathname).toBe("/workbench");
    expectNoStartEffects();
    await act(async () => actions.requestNewThread(ticket));
    await confirm();
    expect(commands.createThread).toHaveBeenCalledOnce();
    expect(commands.createThread).toHaveBeenCalledWith(
      expect.objectContaining({ environmentId: otherEnvironmentId }),
    );
    expect(router.state.location.pathname).toMatch(/^\/other-host\//);
    expect(actions.startThreadRequest).toBeNull();
  });
});
