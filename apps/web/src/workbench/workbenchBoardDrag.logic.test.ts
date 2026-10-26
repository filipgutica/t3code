import { WorkbenchEpicId, type WorkbenchTicketStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { canMoveWorkbenchBoardTicket } from "./workbenchBoardDrag.logic";

const epicId = WorkbenchEpicId.make("epic-1");
const move = {
  ticket: { status: "todo" as const, epicId, archivedAt: null },
  sourceColumnId: "todo",
  target: { columnId: "in_progress", status: "in_progress" as const, epicId },
  groupByEpic: true,
  pending: false,
};
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
});
