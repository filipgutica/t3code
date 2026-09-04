import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type ModelSelection,
  type WorkbenchAssignment,
  type WorkbenchTicket,
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
const modelSelection = {
  provider: "codex",
  model: "gpt-5",
} as unknown as ModelSelection;
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
  kind: "story",
  markdown: "## Goal\n\nStart the first turn.",
  primaryT3ProjectId: projectId,
  repositoryProjectIds: [projectId],
  status: "todo",
  blocked: false,
  createdAt,
  updatedAt: createdAt,
} as const satisfies WorkbenchTicket;

const success = AsyncResult.success(undefined);
const failure = AsyncResult.failure(Cause.fail("failed"));

function makeDependencies(events: string[]) {
  return {
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
  it("creates the Thread and Assignment, starts the first turn, then opens it", async () => {
    const events: string[] = [];
    const result = await coordinateWorkbenchTicketStart(startInput(), makeDependencies(events));

    expect(result).toEqual({ state: "started", threadId });
    expect(events).toEqual(["create-thread", "create-assignment", "start-turn", "open-thread"]);
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
    expect(events).toEqual(["create-thread", "create-assignment", "delete-thread"]);
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
    expect(events).toEqual(["create-thread", "create-assignment", "start-turn", "set-retry-draft"]);
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
    expect(events).toEqual(["create-thread", "replace-assignment", "start-turn", "open-thread"]);
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
    expect(events).toEqual(["create-thread", "create-assignment", "start-turn", "open-thread"]);
  });
});
