import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  MessageId,
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
import { describe, expect, it } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

import { coordinateWorkbenchTicketStart } from "./startWorkbenchTicket";

const environmentId = EnvironmentId.make("environment-one");
const projectId = ProjectId.make("repository-one");
const threadId = ThreadId.make("thread-new");
const assignmentId = WorkbenchAssignmentId.make("assignment-new");
const messageId = MessageId.make("message-new");
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
  epicId: null,
  title: "Streamline Ticket Threads",
  kind: "story",
  markdown: "## Goal\n\nStart the first turn.",
  primaryT3ProjectId: projectId,
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
      isPrimary: true,
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
    startTurn: async () => {
      events.push("start-turn");
      return success;
    },
    openThread: async () => {
      events.push("open-thread");
    },
    setRetryDraft: () => {
      events.push("set-retry-draft");
    },
    resolveModelSelection: () => modelSelection,
    makeThreadId: () => threadId,
    makeAssignmentId: () => assignmentId,
    makeMessageId: () => messageId,
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
  it("replaces the requested missing link without opening its live sibling or sending a prompt", async () => {
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
        sendInitialPrompt: false,
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
  it("creates the Thread and Assignment, starts the first turn, then opens it", async () => {
    const events: string[] = [];
    let createdThreadInput: unknown;
    let startedTurnInput: unknown;
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
        startTurn: async (input) => {
          events.push("start-turn");
          startedTurnInput = input.input;
          return success;
        },
      },
      { modelSelection: selectedModel },
    );

    expect(result).toEqual({ state: "started", threadId });
    expect(createdThreadInput).toMatchObject({
      branch: "workbench/ticket-one",
      worktreePath: "/worktrees/ticket-one/t3code",
      modelSelection: selectedModel,
    });
    expect(startedTurnInput).toMatchObject({ modelSelection: selectedModel });
    expect(events).toEqual([
      "prepare-workspace",
      "create-thread",
      "create-assignment",
      "start-turn",
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

  it("preserves the Thread and Assignment with a retry draft when the first turn fails", async () => {
    const events: string[] = [];
    const dependencies = {
      ...makeDependencies(events),
      startTurn: async () => {
        events.push("start-turn");
        return failure;
      },
    };

    const result = await coordinateWorkbenchTicketStart(startInput(), dependencies);

    expect(result).toMatchObject({ state: "failed", stage: "turn" });
    expect(events).toEqual([
      "prepare-workspace",
      "create-thread",
      "create-assignment",
      "start-turn",
      "set-retry-draft",
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

    expect(result).toEqual({ state: "started", threadId });
    expect(events).toEqual([
      "prepare-workspace",
      "create-thread",
      "replace-assignment",
      "start-turn",
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

  it("creates an additional blank Thread without replacing the active Assignment or starting a turn", async () => {
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
    expect(createdThreadInput).toMatchObject({ modelSelection: selectedModel });
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
      "start-turn",
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
