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
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";
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
  readTicketContext: vi.fn(),
  launchThread: vi.fn(),
}));
const nativeDelete = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => ({ workbench: vi.fn(), archived: vi.fn() }));
vi.mock("../state/threads", () => ({
  threadEnvironment: {
    unarchive: "unarchive",
    create: "createThread",
    delete: "deleteThread",
    startTurn: "launchThread",
  },
}));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    updateTicket: "updateTicket",
    createAssignment: "createAssignment",
    replaceAssignment: "replaceAssignment",
    unlinkAssignment: "unlinkAssignment",
    prepareTicketWorkspace: "prepareTicketWorkspace",
    readTicketContext: "readTicketContext",
  },
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: keyof typeof commands) => commands[command],
}));
vi.mock("../state/use-orchestration-command", () => ({
  useOrchestrationCommand: (command: keyof typeof commands) => commands[command],
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
  title: "Delivery Ticket",
  markdown: "",
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
const attachable = {
  id: assignment.threadId,
  environmentId,
  title: "Linked Thread",
  projectId,
  branch: null,
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
  references: [],
  projects: [workspace],
  tickets: [ticket],
  assignments: [],
  threadRecaps: [],
  ticketWorkspaces: [],
  reservedThreadIds: [],
};
type HookInput = Parameters<typeof useWorkbenchThreadActions>[0];
type HarnessInput = {
  canOperate?: boolean;
  archivedThread?: boolean;
  snapshot: WorkbenchSnapshot;
  environmentId: EnvironmentId | null;
  existingThreadIds: ReadonlySet<ThreadId>;
  repositoryScopeDraft: WorkbenchRepositoryScopeDraft | null;
  liveEnvironmentIds?: ReadonlySet<EnvironmentId>;
  remoteEnvironmentStates?: Map<EnvironmentId, "ready" | "checking" | "offline">;
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
    canOperate: input.canOperate ?? true,
    snapshot: input.snapshot,
    referencesByTicket: new Map(),
    snapshotProjects: input.snapshot.projects,
    projects,
    providers: [],
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    availableEditors: [],
    query,
    refreshWorkbenchSnapshot: query.refresh,
    ticketDrafts: new Map(),
    clearTicketDraft: vi.fn(),
    optimisticStatus: {
      tickets: input.snapshot.tickets,
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
    archivedThreadsById: new Map(
      input.archivedThread
        ? [
            [
              assignment.threadId,
              makeThreadFixture({
                id: assignment.threadId,
                projectId,
                environmentId,
                archivedAt: createdAt,
              }),
            ],
          ]
        : [],
    ),
    threadLookupReady: true,
    threadLookupError: null,
    refreshArchivedThreads: refresh.archived,
    refreshThreadLookup: vi.fn(),
    remoteEnvironmentStates: input.remoteEnvironmentStates ?? new Map(),
    remoteRepositoriesByBoard: new Map(),
    environmentLabels: new Map(),
    liveEnvironmentIds: input.liveEnvironmentIds ?? new Set(),
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
  commands.readTicketContext.mockResolvedValue(
    AsyncResult.success({ text: "Ticket brief.", audience: "remote-thread", threads: [] }),
  );
  nativeDelete.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  refresh.workbench.mockReset();
  refresh.archived.mockReset();
  useWorkbenchFloatingChatStore.setState({ pageChat: null });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("linked Thread failure recovery", () => {
  it("does not restore an archived Thread without operate permission and permits a later grant", async () => {
    const { router, update } = await mount({ canOperate: false, archivedThread: true });
    await act(async () => actions.openAssignedThread(assignment.threadId));
    expect(commands.unarchive).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/workbench");
    expect(pending).toBeNull();
    await update({ canOperate: true });
    await act(async () => actions.openAssignedThread(assignment.threadId));
    expect(commands.unarchive).toHaveBeenCalledWith({
      environmentId,
      input: { threadId: assignment.threadId },
    });
    expect(router.state.location.pathname).toBe(`/${environmentId}/${assignment.threadId}`);
  });

  it("retains a failed attach for retry, then links and opens the selected native Thread", async () => {
    const { router, update } = await mount({ existingThreadIds: new Set([assignment.threadId]) });
    commands.createAssignment.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("Assignment could not be saved."))),
    );
    await act(async () => actions.setAttachThreadTicket(ticket));
    await act(async () => actions.attachExistingThread(attachable));
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
    await act(async () => actions.attachExistingThread(attachable));
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
    expect(router.state.location.search).toEqual({});
    expect(commands.createThread).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "ticket" as const, ticketId: ticket.id },
    { kind: "board" as const, projectId: workspace.id },
  ])("shows the linked Thread in the mounted $kind chat", async (owner) => {
    const showThread = vi.fn();
    useWorkbenchFloatingChatStore.setState({
      pageChat: { environmentId, ...owner, showThread },
    });
    const { router } = await mount();
    commands.createAssignment.mockResolvedValueOnce(AsyncResult.success(assignment));
    await act(async () => actions.setAttachThreadTicket(ticket));
    await act(async () => actions.attachExistingThread(attachable));
    expect(showThread).toHaveBeenCalledExactlyOnceWith(assignment.threadId);
    expect(router.state.location.pathname).toBe("/workbench");
    expect(actions.attachThreadTicket).toBeNull();
  });

  it("links a Thread on another machine with its machine and shows it in the chat", async () => {
    const showThread = vi.fn();
    useWorkbenchFloatingChatStore.setState({
      pageChat: { environmentId, kind: "ticket", ticketId: ticket.id, showThread },
    });
    const { router, update } = await mount();
    const remoteThread = {
      ...attachable,
      id: ThreadId.make("remote-linked"),
      environmentId: EnvironmentId.make("other-machine"),
      projectId: otherProjectId,
    };
    await act(async () => actions.setAttachThreadTicket(ticket));
    // The machine went offline after the dialog listed its Thread.
    await act(async () => actions.attachExistingThread(remoteThread));
    expect(commands.createAssignment).not.toHaveBeenCalled();
    expect(error).toContain("not connected");
    await update({ liveEnvironmentIds: new Set([remoteThread.environmentId]) });
    commands.createAssignment.mockResolvedValueOnce(AsyncResult.success(assignment));
    await act(async () => actions.attachExistingThread(remoteThread));
    expect(commands.createAssignment).toHaveBeenLastCalledWith({
      environmentId,
      input: expect.objectContaining({
        threadId: remoteThread.id,
        environmentId: remoteThread.environmentId,
        projectId: otherProjectId,
      }),
    });
    expect(showThread).toHaveBeenCalledExactlyOnceWith(remoteThread.id);
    expect(router.state.location.pathname).toBe("/workbench");
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
      expect(error).toBe("Restore this Board before creating a Thread.");
      expectNoStartEffects();
    },
  );

  it("does not replace a Thread whose machine went offline after the dialog opened", async () => {
    const remote = EnvironmentId.make("other-machine");
    const remoteAssignment = {
      ...assignment,
      threadId: ThreadId.make("remote-missing"),
      environmentId: remote,
      projectId,
    };
    const { update } = await mount({
      snapshot: { ...snapshot, assignments: [remoteAssignment] },
      remoteEnvironmentStates: new Map([[remote, "ready"]]),
    });
    await act(async () =>
      actions.requestReplacementThread({ ticket, previousThreadId: remoteAssignment.threadId }),
    );
    // A remote Thread its machine lacks never launched, so the request relaunches it there.
    expect(actions.startThreadRequest?.retry).toEqual(remoteAssignment);
    await update({ remoteEnvironmentStates: new Map([[remote, "offline"]]) });
    await confirm();
    expectNoStartEffects();
  });

  const remoteEnvironment = EnvironmentId.make("other-machine");
  const remoteStart = {
    project: { id: otherProjectId, environmentId: remoteEnvironment, workspaceRoot: "/laptop/app" },
    baseRef: "main",
    branch: "delivery-ticket-abc123",
    startFromOrigin: false,
    instruction: "Fix the parser.",
  };
  const startRemote = () =>
    act(async () => actions.startSelectedThread({ modelSelection, remote: remoteStart }));

  // The Ticket's live Thread must not swallow a new Thread chosen on another machine.
  it("starts an additional Thread on another machine when the Ticket already has one", async () => {
    await mount({
      snapshot: { ...snapshot, assignments: [assignment] },
      existingThreadIds: new Set([assignment.threadId]),
    });
    await act(async () => actions.requestNewThread(ticket));
    await startRemote();
    expect(commands.launchThread).toHaveBeenCalledOnce();
    expect(commands.createAssignment).toHaveBeenCalledWith({
      environmentId,
      input: expect.objectContaining({
        environmentId: remoteEnvironment,
        projectId: otherProjectId,
      }),
    });
  });

  // Relaunching a removed Assignment's ids would start an agent no Ticket tracks.
  it("does not relaunch a Thread another client removed while the dialog was open", async () => {
    const remoteAssignment = {
      ...assignment,
      threadId: ThreadId.make("remote-not-started"),
      environmentId: remoteEnvironment,
      projectId: otherProjectId,
    };
    const { update } = await mount({
      snapshot: { ...snapshot, assignments: [remoteAssignment] },
      remoteEnvironmentStates: new Map([[remoteEnvironment, "ready"]]),
    });
    await act(async () =>
      actions.requestReplacementThread({ ticket, previousThreadId: remoteAssignment.threadId }),
    );
    expect(actions.startThreadRequest?.retry).toEqual(remoteAssignment);
    await update({ snapshot });
    await startRemote();
    expect(commands.launchThread).not.toHaveBeenCalled();
    expect(error).toContain("no longer on the Ticket");
  });

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
    expect(router.state.location.search).toEqual({});
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

  it("shows a Thread created on the ticket page in its floating chat instead of navigating", async () => {
    const showThread = vi.fn();
    useWorkbenchFloatingChatStore.setState({
      pageChat: { environmentId, kind: "ticket", ticketId: ticket.id, showThread },
    });
    const { router } = await mount({
      snapshot: { ...snapshot, ticketWorkspaces: [readyWorkspace] },
    });
    await act(async () => actions.requestNewThread(ticket));
    await confirm();
    expect(commands.createThread).toHaveBeenCalledOnce();
    expect(showThread).toHaveBeenCalledExactlyOnceWith(
      commands.createThread.mock.calls[0]?.[0].input.threadId,
    );
    expect(router.state.location.pathname).toBe("/workbench");
    expect(actions.startThreadRequest).toBeNull();
  });

  it("shows a board-created Thread in the Workspace's floating chat", async () => {
    const showThread = vi.fn();
    useWorkbenchFloatingChatStore.setState({
      pageChat: { environmentId, kind: "board", projectId: workspace.id, showThread },
    });
    const { router } = await mount({
      snapshot: { ...snapshot, ticketWorkspaces: [readyWorkspace] },
    });
    await act(async () => actions.requestNewThread(ticket));
    await confirm();
    expect(showThread).toHaveBeenCalledExactlyOnceWith(
      commands.createThread.mock.calls[0]?.[0].input.threadId,
    );
    expect(router.state.location.pathname).toBe("/workbench");
    expect(actions.startThreadRequest).toBeNull();
  });

  it("navigates when another Workspace's board chat is mounted", async () => {
    const showThread = vi.fn();
    useWorkbenchFloatingChatStore.setState({
      pageChat: {
        environmentId,
        kind: "board",
        projectId: WorkbenchProjectId.make("other-workspace"),
        showThread,
      },
    });
    const { router } = await mount({
      snapshot: { ...snapshot, ticketWorkspaces: [readyWorkspace] },
    });
    await act(async () => actions.requestNewThread(ticket));
    await confirm();
    expect(commands.createThread).toHaveBeenCalledOnce();
    expect(showThread).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe(
      `/remote/${commands.createThread.mock.calls[0]?.[0].input.threadId}`,
    );
  });

  it.each(["ticket", "board"] as const)(
    "navigates to the original environment when its pending creation finishes in another environment's %s chat",
    async (kind) => {
      const originalChat = vi.fn();
      const otherChat = vi.fn();
      const owner =
        kind === "ticket" ? { kind, ticketId: ticket.id } : { kind, projectId: workspace.id };
      useWorkbenchFloatingChatStore.setState({
        pageChat: { environmentId, ...owner, showThread: originalChat },
      });
      const { update, router } = await mount({
        snapshot: { ...snapshot, ticketWorkspaces: [readyWorkspace] },
      });
      await act(async () => actions.requestNewThread(ticket));
      const created = AsyncResult.success(undefined);
      let finishCreation: (result: typeof created) => void = () => {};
      commands.createThread.mockReturnValueOnce(
        new Promise<typeof created>((resolve) => {
          finishCreation = resolve;
        }),
      );
      let start: Promise<void> | undefined;
      await act(() => {
        start = actions.startSelectedThread({ modelSelection });
      });
      expect(commands.createThread).toHaveBeenCalledOnce();
      const otherEnvironmentId = EnvironmentId.make("other-host");
      useWorkbenchFloatingChatStore.setState({
        pageChat: { environmentId: otherEnvironmentId, ...owner, showThread: otherChat },
      });
      await update({ environmentId: otherEnvironmentId });
      await act(async () => {
        finishCreation(created);
        await start;
      });
      expect(originalChat).not.toHaveBeenCalled();
      expect(otherChat).not.toHaveBeenCalled();
      expect(router.state.location.pathname).toBe(
        `/remote/${commands.createThread.mock.calls[0]?.[0].input.threadId}`,
      );
    },
  );

  // Other Threads write the brief and Progress while the dialog is open; only repositories need review.
  it("creates a Thread from the latest Ticket when only its brief changed", async () => {
    const { update } = await mount();
    await act(async () => actions.requestNewThread(ticket));
    await update({
      snapshot: { ...snapshot, tickets: [{ ...ticket, revision: 1, markdown: "Agent progress" }] },
    });
    await act(async () =>
      actions.startSelectedThread({
        modelSelection,
        repositoryScope: { repositoryProjectIds: [projectId, otherProjectId] },
      }),
    );
    expect(error).toBeNull();
    expect(commands.updateTicket).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ expectedRevision: 1 }) }),
    );
    expect(commands.createThread).toHaveBeenCalledOnce();
  });

  it("refreshes changed repository choices before allowing a second confirmation", async () => {
    const { update, router } = await mount();
    await act(async () => actions.requestNewThread(ticket));
    const revisedTicket = {
      ...ticket,
      revision: 1,
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
      value: { repositoryProjectIds: [otherProjectId] },
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
