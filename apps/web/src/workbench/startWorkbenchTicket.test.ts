import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EMPTY_ENVIRONMENT_THREAD_STATE } from "@t3tools/client-runtime/state/threads";
import {
  DEFAULT_SERVER_SETTINGS,
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
  type WorkbenchTicket,
  type WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { describe, expect, it } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { resolveThreadRouteRenderState } from "../threadRoutes";

import {
  coordinateWorkbenchTicketStart,
  getWorkbenchTicketStartProgressLabel,
  isWorkbenchTicketStartPending,
} from "./startWorkbenchTicket";
import { getWorkbenchRepositoryKey } from "./workbenchRemoteProjects";

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
    threadLookupReady: true,
  };
}

describe("coordinateWorkbenchTicketStart", () => {
  it.each([
    { rejectAssignment: false, replace: false },
    { rejectAssignment: true, replace: false },
    { rejectAssignment: false, replace: true },
  ])(
    "starts remotely and cleans up on Assignment failure: $rejectAssignment, replace: $replace",
    async ({ rejectAssignment, replace }) => {
      const remoteEnvironmentId = EnvironmentId.make("environment:remote-box");
      const remoteProject = { ...project, environmentId: remoteEnvironmentId };
      const events: string[] = [];
      const remoteModel = { ...modelSelection, model: "remote-model" };
      const configs = new Map([
        [environmentId, { ...DEFAULT_SERVER_SETTINGS, defaultModelSelection: modelSelection }],
        [
          remoteEnvironmentId,
          {
            ...DEFAULT_SERVER_SETTINGS,
            defaultModelSelection: remoteModel,
            defaultRuntimeMode: "full-access" as const,
          },
        ],
      ]);
      const assign = async ({
        environmentId: destination,
        input,
      }: {
        environmentId: EnvironmentId;
        input: { remote?: { environmentId: EnvironmentId; projectId: ProjectId } };
      }) => {
        expect(destination).toBe(environmentId);
        expect(input.remote).toEqual({ environmentId: remoteEnvironmentId, projectId });
        events.push("assign-thread");
        return rejectAssignment ? failure : success;
      };
      const result = await coordinateWorkbenchTicketStart(
        {
          ...startInput(),
          projects: [project, remoteProject],
          remoteProjects: [{ projectId, environmentId: remoteEnvironmentId, title: "acme/app" }],
        },
        {
          ...makeDependencies(events),
          resolveModelSelection: (repository) =>
            configs.get(repository.environmentId)?.defaultModelSelection ?? null,
          resolveRuntimeMode: (repository) =>
            configs.get(repository.environmentId)?.defaultRuntimeMode ?? "auto",
          createThread: async ({ environmentId: destination, input }) => {
            expect(destination).toBe(remoteEnvironmentId);
            expect(input).toMatchObject({
              branch: null,
              worktreePath: null,
              modelSelection: remoteModel,
              runtimeMode: "full-access",
            });
            events.push("create-thread");
            return success;
          },
          createAssignment: assign,
          replaceAssignment: assign,
          deleteThread: async ({ environmentId: destination }) => {
            expect(destination).toBe(remoteEnvironmentId);
            events.push("delete-thread");
            return success;
          },
          seedRemotePrompt: async (id, destination, snapshot) => {
            expect([id, destination, snapshot]).toEqual([threadId, remoteEnvironmentId, ticket]);
            events.push("seed-prompt");
          },
          waitForThread: async (id, destination) => {
            expect([id, destination]).toEqual([threadId, remoteEnvironmentId]);
            events.push("wait-thread");
          },
          openThread: async (id, destination) => {
            expect([id, destination]).toEqual([threadId, remoteEnvironmentId]);
            events.push("open-thread");
          },
        },
        replace ? { mode: "replace", previousThreadId: ThreadId.make("thread:old") } : {},
      );
      expect(result.state).toBe(rejectAssignment ? "failed" : "opened");
      expect(events).toEqual([
        "create-thread",
        "assign-thread",
        ...(rejectAssignment ? ["delete-thread"] : ["seed-prompt", "wait-thread", "open-thread"]),
      ]);
    },
  );

  it("starts in this machine's checkout of a repository linked only on another machine", async () => {
    const remoteEnvironmentId = EnvironmentId.make("environment:remote-box");
    const remoteAppId = ProjectId.make("remote-app");
    const localCheckout: EnvironmentProject = {
      ...project,
      repositoryIdentity: {
        canonicalKey: "github.com/acme/app",
        locator: { source: "git-remote", remoteName: "origin", remoteUrl: "acme/app" },
        rootPath: project.workspaceRoot,
      },
    };
    const repositoryKey = getWorkbenchRepositoryKey(localCheckout)!;
    const events: string[] = [];
    let assigned: unknown;
    const result = await coordinateWorkbenchTicketStart(
      {
        ...startInput(),
        ticket: { ...ticket, repositoryProjectIds: [remoteAppId] },
        projects: [localCheckout],
        remoteProjects: [
          { projectId: remoteAppId, environmentId: remoteEnvironmentId, title: "acme/app" },
        ],
        repositoryKeys: [{ projectId: remoteAppId, repositoryKey }],
      },
      {
        ...makeDependencies(events),
        createThread: async ({ environmentId: destination, input }) => {
          expect(destination).toBe(environmentId);
          // Checkout-only: the Ticket's repository has no worktrees on the Board machine.
          expect(input).toMatchObject({ projectId, branch: null, worktreePath: null });
          events.push("create-thread");
          return success;
        },
        createAssignment: async ({ input }) => {
          assigned = input;
          events.push("create-assignment");
          return success;
        },
      },
    );
    expect(result.state).toBe("opened");
    expect(events).toEqual(["create-thread", "create-assignment", "open-thread"]);
    expect(assigned).not.toHaveProperty("remote");
    expect(assigned).toMatchObject({ repository: { repositoryKey, title: project.title } });
  });

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
      { ...startInput(), threadLookupReady: false },
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
