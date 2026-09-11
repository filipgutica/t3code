import {
  WorkbenchEpicId,
  type WorkbenchJiraTicketTransition,
  type WorkbenchTicketStatus,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canMoveWorkbenchBoardTicket,
  getWorkbenchBoardDropJiraStatusIds,
  getWorkbenchJiraDropAction,
} from "./workbenchBoardDrag.logic";

const epicId = WorkbenchEpicId.make("epic-1");
const move = {
  ticket: { status: "todo" as const, epicId, archivedAt: null },
  sourceColumnId: "todo",
  target: { columnId: "in_progress", status: "in_progress" as const, epicId },
  jiraManaged: false,
  groupByEpic: true,
  pending: false,
};
const transition = (
  id: string,
  destination = "doing",
  unavailableReason: string | null = null,
): WorkbenchJiraTicketTransition => ({
  id,
  name: id,
  to: { id: destination, name: destination },
  unavailableReason,
});
const result = (transitions: WorkbenchJiraTicketTransition[]) => ({
  remoteUpdatedAt: "2026-09-11T12:00:00.000Z",
  transitions,
});

describe("Workbench board status drops", () => {
  it("allows forward and reverse local status changes, but not same-status reordering", () => {
    const statuses: WorkbenchTicketStatus[] = ["todo", "in_progress", "done"];
    for (const source of statuses) {
      for (const destination of statuses) {
        expect(
          canMoveWorkbenchBoardTicket({
            ...move,
            ticket: { ...move.ticket, status: source },
            sourceColumnId: source,
            target: { ...move.target, columnId: destination, status: destination },
          }),
        ).toBe(source !== destination);
      }
    }
  });

  it("rejects pending, archived, removed, and cross-Epic moves", () => {
    expect(canMoveWorkbenchBoardTicket({ ...move, ticket: { status: "todo", epicId } })).toBe(true);
    expect(canMoveWorkbenchBoardTicket({ ...move, pending: true })).toBe(false);
    expect(
      canMoveWorkbenchBoardTicket({
        ...move,
        ticket: { ...move.ticket, archivedAt: "2026-09-11T12:00:00.000Z" },
      }),
    ).toBe(false);
    expect(canMoveWorkbenchBoardTicket({ ...move, sourceColumnId: undefined })).toBe(false);
    expect(canMoveWorkbenchBoardTicket({ ...move, target: { ...move.target, epicId: null } })).toBe(
      false,
    );
    expect(
      canMoveWorkbenchBoardTicket({
        ...move,
        target: { ...move.target, epicId: WorkbenchEpicId.make("epic-2") },
      }),
    ).toBe(false);
    expect(
      canMoveWorkbenchBoardTicket({
        ...move,
        groupByEpic: false,
        target: { ...move.target, epicId: null },
      }),
    ).toBe(true);
  });

  it("allows distinct Jira columns with the same local status but never a drop into the source column", () => {
    const jiraMove = {
      ...move,
      jiraManaged: true,
      sourceColumnId: "jira-1",
      target: { ...move.target, columnId: "jira-2", status: "todo" as const },
    };
    expect(canMoveWorkbenchBoardTicket(jiraMove)).toBe(true);
    expect(canMoveWorkbenchBoardTicket({ ...jiraMove, jiraManaged: false })).toBe(false);
    expect(canMoveWorkbenchBoardTicket({ ...jiraMove, sourceColumnId: "jira-2" })).toBe(false);
  });

  it("targets the exact mirrored Jira column or the configured local status mapping", () => {
    const statusMappings = [
      { jiraStatusId: "doing", workbenchStatus: "in_progress" as const },
      { jiraStatusId: "review", workbenchStatus: "in_progress" as const },
      { jiraStatusId: "closed", workbenchStatus: "done" as const },
    ];
    const target = {
      columnId: "in_progress",
      status: "in_progress" as const,
      statusMappings,
      mirrorColumns: null,
    };
    expect(getWorkbenchBoardDropJiraStatusIds(target)).toEqual(["doing", "review"]);
    expect(
      getWorkbenchBoardDropJiraStatusIds({
        ...target,
        columnId: "jira-0",
        mirrorColumns: [{ name: "Review", statusIds: ["review"], done: false }],
      }),
    ).toEqual(["review"]);
    expect(getWorkbenchBoardDropJiraStatusIds({ ...target, status: "todo" })).toEqual([]);
  });
});

describe("Jira transition resolution after a drop", () => {
  it("automatically selects only one available transition to the destination", () => {
    const start = transition("start");
    expect(
      getWorkbenchJiraDropAction({
        result: result([
          start,
          transition("blocked", "doing", "Not available"),
          transition("close", "closed"),
        ]),
        jiraStatusIds: ["doing"],
      }),
    ).toEqual({ kind: "transition", transition: start });
  });

  it("requires a choice when multiple valid actions reach the destination column", () => {
    const transitions = [transition("start"), transition("review", "review")];
    expect(
      getWorkbenchJiraDropAction({
        result: result(transitions),
        jiraStatusIds: ["doing", "review"],
      }),
    ).toEqual({ kind: "choose", transitions });
  });

  it("reports unavailable transitions and missing revisions instead of updating", () => {
    expect(
      getWorkbenchJiraDropAction({
        result: result([transition("blocked", "doing", "Status is not mapped")]),
        jiraStatusIds: ["doing"],
      }),
    ).toEqual({ kind: "unavailable", reason: "Status is not mapped" });
    expect(
      getWorkbenchJiraDropAction({
        result: result([transition("close", "closed")]),
        jiraStatusIds: ["doing"],
      }).kind,
    ).toBe("unavailable");
    expect(
      getWorkbenchJiraDropAction({
        result: { ...result([transition("start")]), remoteUpdatedAt: null },
        jiraStatusIds: ["doing"],
      }).kind,
    ).toBe("unavailable");
  });
});
