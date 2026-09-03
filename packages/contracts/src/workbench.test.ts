import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  WorkbenchAssignment,
  WorkbenchProject,
  WorkbenchSnapshot,
  WorkbenchTicket,
  WorkbenchTicketStatus,
} from "./workbench.ts";
import { WS_METHODS, WsRpcGroup } from "./rpc.ts";

const decodeWorkbenchSnapshot = Schema.decodeUnknownEffect(WorkbenchSnapshot);
const decodeWorkbenchProject = Schema.decodeUnknownEffect(WorkbenchProject);
const decodeWorkbenchTicketStatus = Schema.decodeUnknownEffect(WorkbenchTicketStatus);
const isWorkbenchProject = Schema.is(WorkbenchProject);
const isWorkbenchTicket = Schema.is(WorkbenchTicket);
const isWorkbenchAssignment = Schema.is(WorkbenchAssignment);

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
        tickets: [
          {
            id: "ticket-1",
            projectId: "workbench-project-1",
            title: "Create the first Ticket flow",
            markdown: "Keep the native T3 Thread experience.",
            primaryT3ProjectId: "t3-project-1",
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
          },
        ],
      });

      expect(snapshot.projects[0]?.linkedProjectIds).toEqual(["t3-project-1"]);
      expect(snapshot.tickets[0]?.status).toBe("in_progress");
      expect(snapshot.assignments[0]?.threadId).toBe("thread-1");
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
      isWorkbenchTicket({
        id: "ticket-1",
        projectId: "project-1",
        title: "Ticket",
        markdown: "Body",
        primaryT3ProjectId: "t3-project-1",
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
