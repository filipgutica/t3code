import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EMPTY_ENVIRONMENT_THREAD_STATE } from "@t3tools/client-runtime/state/threads";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  OrchestrationV2ThreadLaunchError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WorkbenchTicketWorkspaceAttemptId,
  type ModelSelection,
  type WorkbenchAssignment,
  type WorkbenchTicket,
  type WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { describe, expect, it } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { resolveThreadRouteRenderState } from "../threadRoutes";

import {
  coordinateWorkbenchTicketStart,
  getWorkbenchTicketStartProgressLabel,
  isWorkbenchTicketStartPending,
} from "./startWorkbenchTicket";

const environmentId = EnvironmentId.make("environment-one");
const projectId = ProjectId.make("repository-one");
const threadId = ThreadId.make("thread-new");
const assignmentId = WorkbenchAssignmentId.make("assignment-new");
const createdAt = "2026-09-03T12:00:00.000Z";
const modelSelection: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5",
};
const project = {
  id: projectId,
  environmentId,
  title: "T3 Code",
  workspaceRoot: "/repos/t3code",
  defaultModelSelection: modelSelection,
} as EnvironmentProject;
const ticket = {
  id: WorkbenchTicketId.make("ticket-one"),
  projectId: WorkbenchProjectId.make("workspace-one"),
  title: "Streamline Ticket Threads",
  markdown: "## Goal\n\nStart the first turn.",
  repositoryProjectIds: [projectId],
  status: "todo",
  blocked: false,
  revision: 0,
  createdAt,
  updatedAt: createdAt,
} as const satisfies WorkbenchTicket;

const success = AsyncResult.success(undefined);
const failure = AsyncResult.failure(Cause.fail("failed"));
const decodeLaunchError = Schema.decodeSync(OrchestrationV2ThreadLaunchError);
const workspaceFailure = AsyncResult.failure<WorkbenchTicketWorkspace, string>(
  Cause.fail("failed"),
);
const preparedWorkspace = {
  ticketId: ticket.id,
  attemptId: WorkbenchTicketWorkspaceAttemptId.make("attempt-one"),
  status: "ready",
  branchName: "workbench/ticket-one",
  errorMessage: null,
  repositories: [
    {
      projectId,
      sourcePath: "/repos/t3code",
      worktreePath: "/worktrees/ticket-one/t3code",
      branchName: "workbench/ticket-one",
      status: "ready",
      errorMessage: null,
      createdAt,
      updatedAt: createdAt,
    },
  ],
  createdAt,
  updatedAt: createdAt,
} as WorkbenchTicketWorkspace;

function makeDependencies(events: string[]) {
  return {
    updateTicket: async () => AsyncResult.success(ticket),
    prepareTicketWorkspace: async () => {
      events.push("prepare-workspace");
      return AsyncResult.success(preparedWorkspace);
    },
    createThread: async () => {
      events.push("create-thread");
      return success;
    },
    createAssignment: async () => {
      events.push("create-assignment");
      return success;
    },
    replaceAssignment: async () => {
      events.push("replace-assignment");
      return success;
    },
    deleteThread: async () => {
      events.push("delete-thread");
      return success;
    },
    readTicketContext: async () => {
      events.push("read-context");
      return AsyncResult.success(null);
    },
    launchThread: async () => {
      events.push("launch-thread");
      return success;
    },
    canOperateEnvironment: () => true,
    waitForThread: async () => {},
    openThread: async () => {
      events.push("open-thread");
    },
    resolveModelSelection: () => modelSelection,
    resolveRuntimeMode: () => "auto" as const,
    makeThreadId: () => threadId,
    makeAssignmentId: () => assignmentId,
    now: () => createdAt,
  };
}

function startInput(assignment?: WorkbenchAssignment) {
  return {
    environmentId,
    ticket,
    projects: [project],
    assignment,
    existingThreadIds: new Set<ThreadId>(),
    threadLookupState: "ready" as const,
    board: undefined,
  };
}

describe("coordinateWorkbenchTicketStart", () => {
  // The Thread's repository resolves against the saved Ticket, so a preference the save unlinked yields.
  it("recovers an unavailable preferred repository through the reviewed scope", async () => {
    const replacementId = ProjectId.make("replacement-repository");
    const replacementProject = { ...project, id: replacementId };
    const reviewedScope = {
      repositoryProjectIds: [replacementId],
    };
    const events: string[] = [];
    const result = await coordinateWorkbenchTicketStart(
      { ...startInput(), projects: [replacementProject] },
      {
        ...makeDependencies(events),
        updateTicket: async () => {
          events.push("save-repositories");
          return AsyncResult.success({ ...ticket, ...reviewedScope, revision: 1 });
        },
        prepareTicketWorkspace: async () => {
          events.push("prepare-workspace");
          return AsyncResult.success({
            ...preparedWorkspace,
            repositories: [{ ...preparedWorkspace.repositories[0]!, projectId: replacementId }],
          });
        },
        createThread: async ({ input }) => {
          expect(input.projectId).toBe(replacementId);
          events.push("create-thread");
          return success;
        },
      },
      { modelSelection, repositoryScope: reviewedScope, repositoryProjectId: projectId },
    );
    expect(result).toEqual({ state: "opened", threadId });
    expect(events.slice(0, 3)).toEqual(["save-repositories", "prepare-workspace", "create-thread"]);
  });

  it("saves reviewed repositories before preparing and starts the Thread in the chosen one", async () => {
    const secondaryId = ProjectId.make("repository-two");
    const secondaryProject = {
      ...project,
      id: secondaryId,
      title: "API",
      workspaceRoot: "/repos/api",
    };
    const reviewedScope = {
      repositoryProjectIds: [projectId, secondaryId],
    };
    const savedTicket = { ...ticket, ...reviewedScope, revision: 1 };
    const workspace: WorkbenchTicketWorkspace = {
      ...preparedWorkspace,
      repositories: [
        preparedWorkspace.repositories[0]!,
        {
          ...preparedWorkspace.repositories[0]!,
          projectId: secondaryId,
          sourcePath: "/repos/api",
          worktreePath: "/worktrees/ticket-one/api",
        },
      ],
    };
    const events: string[] = [];
    let createdThreadInput: unknown;
    await coordinateWorkbenchTicketStart(
      { ...startInput(), projects: [project, secondaryProject] },
      {
        ...makeDependencies(events),
        resolveRuntimeMode: (repository) =>
          resolveProjectSettings(
            {
              ...DEFAULT_SERVER_SETTINGS,
              defaultRuntimeMode: "full-access",
              projectSettingsOverrides: { [secondaryId]: { defaultRuntimeMode: "auto" } },
            },
            repository.id,
          ).settings.defaultRuntimeMode,
        updateTicket: async ({ input }) => {
          expect(input).toMatchObject({
            id: ticket.id,
            expectedRevision: ticket.revision,
            ...reviewedScope,
          });
          events.push("save-repositories");
          return AsyncResult.success(savedTicket);
        },
        prepareTicketWorkspace: async () => {
          events.push("prepare-workspace");
          return AsyncResult.success(workspace);
        },
        createThread: async ({ input }) => {
          createdThreadInput = input;
          return success;
        },
      },
      { modelSelection, repositoryScope: reviewedScope, repositoryProjectId: secondaryId },
    );
    expect(events.slice(0, 2)).toEqual(["save-repositories", "prepare-workspace"]);
    expect(createdThreadInput).toMatchObject({
      projectId: secondaryId,
      runtimeMode: "auto",
      worktreePath: "/worktrees/ticket-one/api",
    });
  });

  it("returns the saved Ticket when its repository cannot start a Thread", async () => {
    const unavailableId = ProjectId.make("repository-unavailable");
    const savedTicket = { ...ticket, repositoryProjectIds: [unavailableId], revision: 1 };
    const result = await coordinateWorkbenchTicketStart(
      startInput(),
      { ...makeDependencies([]), updateTicket: async () => AsyncResult.success(savedTicket) },
      { modelSelection, repositoryScope: { repositoryProjectIds: [unavailableId] } },
    );
    expect(result).toEqual({ state: "project-unavailable", ticket: savedTicket });
  });

  // Worktrees exist only on the Board host, so a repository on another machine neither hosts
  // the Thread nor needs a prepared checkout.
  it("starts a host Thread when the Ticket also scopes a repository on another machine", async () => {
    const remoteId = ProjectId.make("repository-remote");
    const mixedTicket = { ...ticket, repositoryProjectIds: [remoteId, projectId] };
    let createdThreadInput: unknown;
    const result = await coordinateWorkbenchTicketStart(
      {
        ...startInput(),
        ticket: mixedTicket,
        board: {
          remoteProjects: {
            [remoteId]: {
              environmentId: EnvironmentId.make("environment-remote"),
              environmentLabel: "Laptop",
              projectTitle: "Remote",
            },
          },
        },
      },
      {
        ...makeDependencies([]),
        createThread: async ({ input }) => {
          createdThreadInput = input;
          return success;
        },
      },
      { modelSelection },
    );
    expect(result).toEqual({ state: "opened", threadId });
    expect(createdThreadInput).toMatchObject({
      projectId,
      worktreePath: "/worktrees/ticket-one/t3code",
    });
  });

  it("does not prepare repositories or create a Thread when the reviewed scope cannot be saved", async () => {
    const events: string[] = [];
    const result = await coordinateWorkbenchTicketStart(
      startInput(),
      {
        ...makeDependencies(events),
        updateTicket: async () => {
          events.push("save-repositories");
          return AsyncResult.failure<WorkbenchTicket, string>(Cause.fail("revision conflict"));
        },
      },
      {
        modelSelection,
        repositoryScope: {
          repositoryProjectIds: [projectId, ProjectId.make("repository-two")],
        },
      },
    );
    expect(result).toMatchObject({ state: "failed", stage: "repositories" });
    expect(events).toEqual(["save-repositories"]);
  });
  it("reports visible progress while creating a new Thread", async () => {
    const stages: string[] = [];

    await coordinateWorkbenchTicketStart(startInput(), {
      ...makeDependencies([]),
      onStage: (stage) => stages.push(stage),
    });

    expect(stages).toEqual([
      "checking-thread",
      "preparing-workspace",
      "creating-thread",
      "linking-thread",
      "opening-thread",
    ]);
  });

  it("maps pending start stages to user-facing labels", () => {
    expect(
      getWorkbenchTicketStartProgressLabel(`start:${ticket.id}:creating-thread`, ticket.id),
    ).toBe("Creating Thread…");
    expect(isWorkbenchTicketStartPending(`start:${ticket.id}:creating-thread`, ticket.id)).toBe(
      true,
    );
    expect(getWorkbenchTicketStartProgressLabel("delete:ticket-one", ticket.id)).toBeNull();
  });

  it("opens the intended route only after the new thread reaches the client", async () => {
    const events: string[] = [];
    let resolveShellReady = () => {};
    let resolveWaitingForShell = () => {};
    const shellReady = new Promise<void>((resolve) => {
      resolveShellReady = resolve;
    });
    const waitingForShell = new Promise<void>((resolve) => {
      resolveWaitingForShell = resolve;
    });
    let shellExists = false;
    let openedRouteState: ReturnType<typeof resolveThreadRouteRenderState> | undefined;
    const dependencies = {
      ...makeDependencies(events),
      waitForThread: async () => {
        resolveWaitingForShell();
        await shellReady;
      },
      openThread: async () => {
        openedRouteState = resolveThreadRouteRenderState({
          bootstrapComplete: true,
          serverThreadExists: shellExists,
          serverThreadDeleted: false,
          unlistedThreadDetail: EMPTY_ENVIRONMENT_THREAD_STATE,
          draftThreadExists: false,
        });
      },
    };
    const start = coordinateWorkbenchTicketStart(startInput(), dependencies);
    try {
      expect(
        await Promise.race([
          start.then(() => "opened-before-shell"),
          waitingForShell.then(() => "waiting-for-shell"),
        ]),
      ).toBe("waiting-for-shell");
      expect(openedRouteState).toBeUndefined();
    } finally {
      shellExists = true;
      resolveShellReady();
      await start;
    }
    expect(openedRouteState).toBe("ready");
  });

  it("replaces the requested missing link without sending a prompt", async () => {
    const events: string[] = [];
    const liveThreadId = ThreadId.make("live-sibling");
    const missingThreadId = ThreadId.make("missing-target");
    const assignment: WorkbenchAssignment = {
      id: WorkbenchAssignmentId.make("live-assignment"),
      ticketId: ticket.id,
      threadId: liveThreadId,
      createdAt,
      supersededAt: null,
    };
    let replacedThreadId: ThreadId | undefined;
    await coordinateWorkbenchTicketStart(
      {
        ...startInput(assignment),
        existingThreadIds: new Set([liveThreadId]),
      },
      {
        ...makeDependencies(events),
        replaceAssignment: async ({ input }) => {
          replacedThreadId = input.previousThreadId;
          events.push("replace-assignment");
          return success;
        },
      },
      {
        mode: "replace",
        previousThreadId: missingThreadId,
        modelSelection,
      },
    );
    expect(replacedThreadId).toBe(missingThreadId);
    expect(events).toEqual([
      "prepare-workspace",
      "create-thread",
      "replace-assignment",
      "open-thread",
    ]);
  });
  it("creates the Thread and Assignment, then opens it", async () => {
    const events: string[] = [];
    let createdThreadInput: unknown;
    const selectedModel: ModelSelection = { ...modelSelection, model: "gpt-5.4-mini" };
    const result = await coordinateWorkbenchTicketStart(
      { ...startInput(), threadLookupState: "checking" as const },
      {
        ...makeDependencies(events),
        createThread: async (input) => {
          events.push("create-thread");
          createdThreadInput = input.input;
          return success;
        },
      },
      { modelSelection: selectedModel },
    );

    expect(result).toEqual({ state: "opened", threadId });
    expect(createdThreadInput).toMatchObject({
      branch: "workbench/ticket-one",
      worktreePath: "/worktrees/ticket-one/t3code",
      modelSelection: selectedModel,
      runtimeMode: "auto",
    });
    expect(events).toEqual([
      "prepare-workspace",
      "create-thread",
      "create-assignment",
      "open-thread",
    ]);
  });

  it("cleans up the new Thread when Assignment creation fails", async () => {
    const events: string[] = [];
    const dependencies = {
      ...makeDependencies(events),
      createAssignment: async () => {
        events.push("create-assignment");
        return failure;
      },
    };

    const result = await coordinateWorkbenchTicketStart(startInput(), dependencies);

    expect(result).toMatchObject({ state: "failed", stage: "assignment" });
    expect(events).toEqual([
      "prepare-workspace",
      "create-thread",
      "create-assignment",
      "delete-thread",
    ]);
  });

  it("preserves the prior Assignment by using replacement", async () => {
    const events: string[] = [];
    const assignment = {
      id: WorkbenchAssignmentId.make("assignment-old"),
      ticketId: ticket.id,
      threadId: ThreadId.make("thread-missing"),
      createdAt,
      supersededAt: null,
    } as const;

    const result = await coordinateWorkbenchTicketStart(
      startInput(assignment),
      makeDependencies(events),
    );

    expect(result).toEqual({ state: "opened", threadId });
    expect(events).toEqual([
      "prepare-workspace",
      "create-thread",
      "replace-assignment",
      "open-thread",
    ]);
  });

  it("opens an existing active Thread without starting another", async () => {
    const events: string[] = [];
    const assignment = {
      id: WorkbenchAssignmentId.make("assignment-old"),
      ticketId: ticket.id,
      threadId: ThreadId.make("thread-existing"),
      createdAt,
      supersededAt: null,
    } as const;

    const result = await coordinateWorkbenchTicketStart(
      {
        ...startInput(assignment),
        projects: [],
        existingThreadIds: new Set([assignment.threadId]),
      },
      makeDependencies(events),
    );

    expect(result).toEqual({ state: "opened", threadId: assignment.threadId });
    expect(events).toEqual(["open-thread"]);
  });

  it("creates an additional Thread without replacing the active Assignment", async () => {
    const events: string[] = [];
    let createdThreadInput: unknown;
    let createdAssignmentInput: unknown;
    const assignment = {
      id: WorkbenchAssignmentId.make("assignment-active"),
      ticketId: ticket.id,
      threadId: ThreadId.make("thread-existing"),
      createdAt,
      supersededAt: null,
    } as const;
    const selectedModel: ModelSelection = { ...modelSelection, model: "claude-sonnet" };
    const result = await coordinateWorkbenchTicketStart(
      startInput(assignment),
      {
        ...makeDependencies(events),
        createThread: async (input) => {
          events.push("create-thread");
          createdThreadInput = input.input;
          return success;
        },
        createAssignment: async (input) => {
          events.push("create-assignment");
          createdAssignmentInput = input.input;
          return success;
        },
      },
      { mode: "additional", modelSelection: selectedModel },
    );

    expect(result).toEqual({ state: "opened", threadId });
    expect(createdThreadInput).toMatchObject({
      modelSelection: selectedModel,
      runtimeMode: "auto",
    });
    expect(createdAssignmentInput).toMatchObject({
      ticketId: ticket.id,
      threadId,
    });
    expect(events).toEqual([
      "prepare-workspace",
      "create-thread",
      "create-assignment",
      "open-thread",
    ]);
  });

  it("keeps a rejected navigation observable after starting work", async () => {
    const events: string[] = [];
    const dependencies = {
      ...makeDependencies(events),
      openThread: async () => {
        events.push("open-thread");
        throw new Error("navigation failed");
      },
    };

    const result = await coordinateWorkbenchTicketStart(startInput(), dependencies);

    expect(result).toMatchObject({ state: "navigation-failed" });
    expect(events).toEqual([
      "prepare-workspace",
      "create-thread",
      "create-assignment",
      "open-thread",
    ]);
  });

  it("does not create a Thread when repository preparation fails", async () => {
    const events: string[] = [];
    const dependencies = {
      ...makeDependencies(events),
      prepareTicketWorkspace: async () => {
        events.push("prepare-workspace");
        return workspaceFailure;
      },
    };

    const result = await coordinateWorkbenchTicketStart(startInput(), dependencies);

    expect(result).toMatchObject({ state: "failed", stage: "workspace" });
    expect(events).toEqual(["prepare-workspace"]);
  });
});

describe("coordinateWorkbenchTicketStart on another machine", () => {
  const remoteEnvironmentId = EnvironmentId.make("environment-remote");
  const remoteProjectId = ProjectId.make("repository-remote");
  const remoteTicket = { ...ticket, repositoryProjectIds: [remoteProjectId] };
  const remoteBoard = {
    remoteProjects: {
      [remoteProjectId]: {
        environmentId: remoteEnvironmentId,
        environmentLabel: "Laptop",
        projectTitle: "Remote",
      },
    },
  };
  const remote = {
    project: {
      id: remoteProjectId,
      environmentId: remoteEnvironmentId,
      workspaceRoot: "/remote/repos/app",
    },
    baseRef: "main",
    branch: "streamline-ticket-threads",
    startFromOrigin: false,
    instruction: "Start with the parser.",
  };
  const remoteInput = (existingThreadIds = new Set<ThreadId>()) => ({
    ...startInput(),
    ticket: remoteTicket,
    existingThreadIds,
    board: remoteBoard,
  });
  const remoteContext = {
    text: "Ticket brief for a Thread on another machine.",
    audience: "remote-thread" as const,
    threads: [],
  };
  type Launch = Parameters<Parameters<typeof coordinateWorkbenchTicketStart>[1]["launchThread"]>[0];

  function makeRemoteDependencies(
    events: string[],
    launched: Launch[],
    launchResults: Array<typeof success | AsyncResult.Failure<unknown, unknown>> = [success],
  ) {
    return {
      ...makeDependencies(events),
      readTicketContext: async ({
        environmentId: hostEnvironmentId,
        input,
      }: {
        environmentId: EnvironmentId;
        input: { audience: "remote-thread" };
      }) => {
        events.push(`read-context:${hostEnvironmentId}:${input.audience}`);
        return AsyncResult.success(remoteContext);
      },
      createAssignment: async ({ input }: { input: Record<string, unknown> }) => {
        events.push(`create-assignment:${String(input.environmentId)}:${String(input.projectId)}`);
        return success;
      },
      launchThread: async (launch: Launch) => {
        events.push(`launch-thread:${launch.environmentId}`);
        launched.push(launch);
        return launchResults.shift() ?? success;
      },
      openThread: async (openedThreadId: ThreadId, openedEnvironmentId: EnvironmentId) => {
        events.push(`open-thread:${openedEnvironmentId}:${openedThreadId}`);
      },
    };
  }

  // A closed tab after the write leaves a visible Assignment to retry, never an untracked agent.
  it("records the Assignment on the host before it launches the Thread on the remote", async () => {
    const events: string[] = [];
    const launched: Launch[] = [];
    const result = await coordinateWorkbenchTicketStart(
      remoteInput(),
      makeRemoteDependencies(events, launched),
      { modelSelection, remote },
    );

    expect(result).toEqual({ state: "opened", threadId });
    expect(events).toEqual([
      `read-context:${environmentId}:remote-thread`,
      `create-assignment:${remoteEnvironmentId}:${remoteProjectId}`,
      `launch-thread:${remoteEnvironmentId}`,
      `open-thread:${remoteEnvironmentId}:${threadId}`,
    ]);
    expect(launched[0]?.input).toMatchObject({
      threadId,
      commandId: `workbench-remote-start:${assignmentId}`,
      message: {
        text: `${remoteContext.text}\n\nStart with the parser.`,
        attachments: [],
      },
      bootstrap: {
        createThread: {
          projectId: remoteProjectId,
          title: ticket.title,
          modelSelection,
          runtimeMode: "auto",
          branch: "streamline-ticket-threads",
          worktreePath: null,
        },
        prepareWorktree: {
          projectCwd: "/remote/repos/app",
          baseBranch: "main",
          branch: "streamline-ticket-threads",
        },
      },
    });
  });

  it("keeps a failed launch's Assignment so the row offers Retry and Remove", async () => {
    const events: string[] = [];
    const result = await coordinateWorkbenchTicketStart(
      remoteInput(),
      makeRemoteDependencies(events, [], [failure]),
      { modelSelection, remote },
    );

    expect(result).toMatchObject({
      state: "not-started",
      assignment: {
        id: assignmentId,
        ticketId: ticket.id,
        threadId,
        environmentId: remoteEnvironmentId,
        projectId: remoteProjectId,
        supersededAt: null,
      },
    });
    expect(events).toEqual([
      `read-context:${environmentId}:remote-thread`,
      `create-assignment:${remoteEnvironmentId}:${remoteProjectId}`,
      `launch-thread:${remoteEnvironmentId}`,
    ]);
  });

  const notStarted = {
    id: assignmentId,
    ticketId: ticket.id,
    threadId,
    environmentId: remoteEnvironmentId,
    projectId: remoteProjectId,
    createdAt,
    supersededAt: null,
  } satisfies WorkbenchAssignment;
  const retryOptions = { modelSelection, remote: { ...remote, retry: notStarted } };
  const retryDependencies = (
    events: string[],
    launched: Launch[],
    launchResults: Array<typeof success | AsyncResult.Failure<unknown, unknown>>,
  ) => ({
    ...makeRemoteDependencies(events, launched, launchResults),
    makeThreadId: () => ThreadId.make("thread-never-used"),
    makeAssignmentId: () => WorkbenchAssignmentId.make("assignment-never-used"),
  });
  const launchIds = (launched: ReadonlyArray<Launch>) =>
    launched.map(({ input }) => [input.threadId, input.commandId]);

  // The remote creates the Thread before it accepts the first message, so a failure in between
  // leaves an empty Thread; relaunching with the same ids replays creation and sends the brief.
  it("relaunches with the Assignment's ids even when its Thread already exists", async () => {
    const events: string[] = [];
    const launched: Launch[] = [];
    const dependencies = retryDependencies(events, launched, [failure, success]);

    const failedRetry = await coordinateWorkbenchTicketStart(
      remoteInput(),
      dependencies,
      retryOptions,
    );
    const retried = await coordinateWorkbenchTicketStart(
      remoteInput(new Set([threadId])),
      dependencies,
      retryOptions,
    );

    expect(failedRetry).toMatchObject({ state: "not-started", assignment: notStarted });
    expect(retried).toEqual({ state: "opened", threadId });
    expect(events.filter((event) => event.startsWith("create-assignment"))).toEqual([]);
    expect(launchIds(launched)).toEqual([
      [threadId, `workbench-remote-start:${assignmentId}`],
      [threadId, `workbench-remote-start:${assignmentId}`],
    ]);
  });

  // The remote refuses a command id it recorded as rejected, so Retry can never succeed.
  it("tells a recorded rejection apart from a launch that can be retried", async () => {
    // The wire form of the remote's error chain, as `orchestration.launchThread` sends it.
    const rejection = decodeLaunchError({
      _tag: "OrchestrationV2ThreadLaunchError",
      commandId: `workbench-remote-start:${assignmentId}`,
      projectId: remoteProjectId,
      message: "Failed to launch thread",
      cause: {
        name: "ThreadLaunchError",
        message: "Thread launch failed during create-thread.",
        cause: { name: "OrchestratorCommandPreviouslyRejectedError", message: "Rejected." },
      },
    });
    const events: string[] = [];
    const launched: Launch[] = [];
    const dependencies = retryDependencies(events, launched, [
      failure,
      AsyncResult.failure(Cause.fail(rejection)),
    ]);

    const transient = await coordinateWorkbenchTicketStart(
      remoteInput(),
      dependencies,
      retryOptions,
    );
    const rejected = await coordinateWorkbenchTicketStart(
      remoteInput(),
      dependencies,
      retryOptions,
    );

    expect(transient).toMatchObject({ state: "not-started", assignment: notStarted });
    expect(rejected).toMatchObject({ state: "launch-rejected", assignment: notStarted });
    expect(launchIds(launched)).toEqual([
      [threadId, `workbench-remote-start:${assignmentId}`],
      [threadId, `workbench-remote-start:${assignmentId}`],
    ]);
  });

  // The launch's own scope check would refuse it after the Assignment was saved, for good.
  it("writes nothing when this client cannot change Threads on the other machine", async () => {
    const events: string[] = [];
    const launched: Launch[] = [];
    const result = await coordinateWorkbenchTicketStart(
      remoteInput(),
      {
        ...makeRemoteDependencies(events, launched),
        updateTicket: async () => {
          events.push("update-ticket");
          return AsyncResult.success(remoteTicket);
        },
        canOperateEnvironment: (id: EnvironmentId) => id !== remoteEnvironmentId,
      },
      {
        modelSelection,
        repositoryScope: { repositoryProjectIds: [remoteProjectId, projectId] },
        remote,
      },
    );

    expect(result).toEqual({ state: "remote-read-only" });
    expect(events).toEqual([]);
    expect(launched).toEqual([]);
  });

  // An older host returns its host instruction, which names tools and paths the remote lacks.
  it("stops before writing anything when the host does not echo the remote audience", async () => {
    const events: string[] = [];
    const launched: Launch[] = [];
    const result = await coordinateWorkbenchTicketStart(
      remoteInput(),
      {
        ...makeRemoteDependencies(events, launched),
        readTicketContext: async () => {
          events.push("read-context");
          return AsyncResult.success({ text: "Host-only instruction.", threads: [] });
        },
      },
      { modelSelection, remote },
    );

    expect(result).toEqual({ state: "host-outdated" });
    expect(events).toEqual(["read-context"]);
    expect(launched).toEqual([]);
  });
});
