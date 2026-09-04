import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  WorkbenchAssignment,
  WorkbenchCreateEpicInput,
  WorkbenchCreateTicketInput,
  WorkbenchEpic,
  WorkbenchProject,
  WorkbenchReplaceAssignmentInput,
  WorkbenchSnapshot,
  WorkbenchTicket,
  WorkbenchTicketKind,
  WorkbenchTicketWorkspace,
  WorkbenchTicketStatus,
  WorkbenchUpdateTicketInput,
} from "./workbench.ts";
import { WS_METHODS, WsRpcGroup } from "./rpc.ts";

const decodeWorkbenchSnapshot = Schema.decodeUnknownEffect(WorkbenchSnapshot);
const decodeWorkbenchCreateEpicInput = Schema.decodeUnknownEffect(WorkbenchCreateEpicInput);
const decodeWorkbenchProject = Schema.decodeUnknownEffect(WorkbenchProject);
const decodeWorkbenchTicketStatus = Schema.decodeUnknownEffect(WorkbenchTicketStatus);
const decodeWorkbenchTicketKind = Schema.decodeUnknownEffect(WorkbenchTicketKind);
const decodeWorkbenchCreateTicketInput = Schema.decodeUnknownEffect(WorkbenchCreateTicketInput);
const decodeWorkbenchUpdateTicketInput = Schema.decodeUnknownEffect(WorkbenchUpdateTicketInput);
const decodeWorkbenchReplaceAssignmentInput = Schema.decodeUnknownEffect(
  WorkbenchReplaceAssignmentInput,
);
const isWorkbenchProject = Schema.is(WorkbenchProject);
const isWorkbenchEpic = Schema.is(WorkbenchEpic);
const isWorkbenchTicket = Schema.is(WorkbenchTicket);
const isWorkbenchAssignment = Schema.is(WorkbenchAssignment);
const isWorkbenchTicketWorkspace = Schema.is(WorkbenchTicketWorkspace);

describe("Workbench contracts", () => {
  it.effect("decodes the persisted Project, Ticket, and Assignment snapshot", () =>
    Effect.gen(function* () {
      const snapshot = yield* decodeWorkbenchSnapshot({
        projects: [
          {
            id: "workbench-project-1",
            title: "Agent Workbench",
            linkedProjectIds: ["t3-project-1"],
            createdAt: "2026-09-03T12:00:00.000Z",
            updatedAt: "2026-09-03T12:00:00.000Z",
          },
        ],
        epics: [
          {
            id: "epic-1",
            projectId: "workbench-project-1",
            title: "Native planning",
            markdown: "Keep planning connected to execution.",
            archivedAt: null,
            createdAt: "2026-09-03T12:00:30.000Z",
            updatedAt: "2026-09-03T12:00:30.000Z",
          },
        ],
        tickets: [
          {
            id: "ticket-1",
            projectId: "workbench-project-1",
            title: "Create the first Ticket flow",
            epicId: "epic-1",
            kind: "story",
            markdown: "Keep the native T3 Thread experience.",
            primaryT3ProjectId: "t3-project-1",
            repositoryProjectIds: ["t3-project-1", "t3-project-2"],
            status: "in_progress",
            blocked: false,
            createdAt: "2026-09-03T12:01:00.000Z",
            updatedAt: "2026-09-03T12:02:00.000Z",
          },
        ],
        assignments: [
          {
            id: "assignment-1",
            ticketId: "ticket-1",
            threadId: "thread-1",
            createdAt: "2026-09-03T12:02:00.000Z",
            supersededAt: null,
          },
        ],
        ticketWorkspaces: [
          {
            ticketId: "ticket-1",
            attemptId: "attempt-1",
            status: "ready",
            branchName: "workbench/ticket-1-a1b2c3d4",
            errorMessage: null,
            repositories: [
              {
                projectId: "t3-project-1",
                isPrimary: true,
                sourcePath: "/repos/t3-project-1",
                worktreePath: "/worktrees/ticket-1/t3-project-1",
                branchName: "workbench/ticket-1-a1b2c3d4",
                status: "ready",
                errorMessage: null,
                createdAt: "2026-09-03T12:01:30.000Z",
                updatedAt: "2026-09-03T12:01:31.000Z",
              },
            ],
            createdAt: "2026-09-03T12:01:30.000Z",
            updatedAt: "2026-09-03T12:01:31.000Z",
          },
        ],
      });

      expect(snapshot.projects[0]?.linkedProjectIds).toEqual(["t3-project-1"]);
      expect(snapshot.epics[0]).toMatchObject({ id: "epic-1", archivedAt: null });
      expect(snapshot.tickets[0]).toMatchObject({
        epicId: "epic-1",
        kind: "story",
        repositoryProjectIds: ["t3-project-1", "t3-project-2"],
        status: "in_progress",
      });
      expect(snapshot.assignments[0]?.threadId).toBe("thread-1");
      expect(snapshot.assignments[0]?.supersededAt).toBeNull();
      expect(snapshot.ticketWorkspaces[0]).toMatchObject({
        ticketId: "ticket-1",
        status: "ready",
        repositories: [expect.objectContaining({ projectId: "t3-project-1", isPrimary: true })],
      });
    }),
  );

  it.effect("rejects an empty Workbench Workspace link set", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decodeWorkbenchProject({
          id: "workbench-project-1",
          title: "Agent Workbench",
          linkedProjectIds: [],
          createdAt: "2026-09-03T12:00:00.000Z",
          updatedAt: "2026-09-03T12:00:00.000Z",
        }),
      );

      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("rejects unknown Ticket statuses", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(decodeWorkbenchTicketStatus("reviewing"));

      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("accepts only Story and Bug Ticket kinds", () =>
    Effect.gen(function* () {
      expect(yield* decodeWorkbenchTicketKind("story")).toBe("story");
      expect(yield* decodeWorkbenchTicketKind("bug")).toBe("bug");
      expect((yield* Effect.exit(decodeWorkbenchTicketKind("task")))._tag).toBe("Failure");
    }),
  );

  it.effect("decodes pre-type and pre-history Workbench payloads", () =>
    Effect.gen(function* () {
      const snapshot = yield* decodeWorkbenchSnapshot({
        projects: [],
        tickets: [
          {
            id: "ticket-1",
            projectId: "workbench-project-1",
            title: "Legacy Ticket",
            markdown: "Legacy body",
            primaryT3ProjectId: "t3-project-1",
            status: "todo",
            blocked: false,
            createdAt: "2026-09-03T12:00:00.000Z",
            updatedAt: "2026-09-03T12:00:00.000Z",
          },
        ],
        assignments: [
          {
            id: "assignment-1",
            ticketId: "ticket-1",
            threadId: "thread-1",
            createdAt: "2026-09-03T12:00:00.000Z",
          },
        ],
      });

      expect(snapshot.tickets[0]).toMatchObject({ kind: "story", repositoryProjectIds: [] });
      expect(snapshot.epics).toEqual([]);
      expect(snapshot.tickets[0]?.epicId).toBeNull();
      expect(snapshot.assignments[0]?.supersededAt).toBeNull();
      expect(snapshot.ticketWorkspaces).toEqual([]);
    }),
  );

  it.effect("accepts mutation inputs from an older Workbench client", () =>
    Effect.gen(function* () {
      const createInput = yield* decodeWorkbenchCreateTicketInput({
        id: "ticket-1",
        projectId: "workbench-project-1",
        title: "Legacy Ticket",
        markdown: "Legacy body",
        primaryT3ProjectId: "t3-project-1",
        createdAt: "2026-09-03T12:00:00.000Z",
      });
      const updateInput = yield* decodeWorkbenchUpdateTicketInput({
        id: "ticket-1",
        title: "Legacy Ticket",
        markdown: "Updated legacy body",
        status: "in_progress",
        blocked: false,
        updatedAt: "2026-09-03T12:01:00.000Z",
      });
      const replaceInput = yield* decodeWorkbenchReplaceAssignmentInput({
        ticketId: "ticket-1",
        previousThreadId: "thread-1",
        threadId: "thread-2",
        replacedAt: "2026-09-03T12:02:00.000Z",
      });
      const epicInput = yield* decodeWorkbenchCreateEpicInput({
        id: "epic-1",
        projectId: "workbench-project-1",
        title: "Native planning",
        markdown: "",
        createdAt: "2026-09-03T12:00:00.000Z",
      });

      expect(createInput).toMatchObject({ kind: "story" });
      expect(createInput.epicId).toBeUndefined();
      expect(createInput.repositoryProjectIds).toBeUndefined();
      expect(updateInput.kind).toBeUndefined();
      expect(updateInput.primaryT3ProjectId).toBeUndefined();
      expect(updateInput.repositoryProjectIds).toBeUndefined();
      expect(replaceInput.id).toBeUndefined();
      expect(epicInput.title).toBe("Native planning");
    }),
  );

  it("keeps the core records independently decodable", () => {
    expect(
      isWorkbenchProject({
        id: "project-1",
        title: "Project",
        linkedProjectIds: ["t3-project-1"],
        createdAt: "2026-09-03T12:00:00.000Z",
        updatedAt: "2026-09-03T12:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isWorkbenchEpic({
        id: "epic-1",
        projectId: "project-1",
        title: "Epic",
        markdown: "Body",
        archivedAt: null,
        createdAt: "2026-09-03T12:00:00.000Z",
        updatedAt: "2026-09-03T12:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isWorkbenchTicket({
        id: "ticket-1",
        projectId: "project-1",
        title: "Ticket",
        epicId: null,
        kind: "bug",
        markdown: "Body",
        primaryT3ProjectId: "t3-project-1",
        repositoryProjectIds: ["t3-project-1"],
        status: "todo",
        blocked: false,
        createdAt: "2026-09-03T12:00:00.000Z",
        updatedAt: "2026-09-03T12:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isWorkbenchAssignment({
        id: "assignment-1",
        ticketId: "ticket-1",
        threadId: "thread-1",
        createdAt: "2026-09-03T12:00:00.000Z",
        supersededAt: null,
      }),
    ).toBe(true);
    expect(
      isWorkbenchTicketWorkspace({
        ticketId: "ticket-1",
        attemptId: "attempt-1",
        status: "preparing",
        branchName: "workbench/ticket-1-a1b2c3d4",
        errorMessage: null,
        repositories: [
          {
            projectId: "t3-project-1",
            isPrimary: true,
            sourcePath: "/repos/t3-project-1",
            worktreePath: "/worktrees/ticket-1/t3-project-1",
            branchName: "workbench/ticket-1-a1b2c3d4",
            status: "pending",
            errorMessage: null,
            createdAt: "2026-09-03T12:00:00.000Z",
            updatedAt: "2026-09-03T12:00:00.000Z",
          },
        ],
        createdAt: "2026-09-03T12:00:00.000Z",
        updatedAt: "2026-09-03T12:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("registers every Workbench RPC in the shared group", () => {
    expect([...WsRpcGroup.requests.keys()]).toEqual(
      expect.arrayContaining([
        WS_METHODS.workbenchGetSnapshot,
        WS_METHODS.workbenchCreateProject,
        WS_METHODS.workbenchCreateTicket,
        WS_METHODS.workbenchUpdateTicket,
        WS_METHODS.workbenchCreateAssignment,
        WS_METHODS.workbenchReplaceAssignment,
      ]),
    );
  });
});
