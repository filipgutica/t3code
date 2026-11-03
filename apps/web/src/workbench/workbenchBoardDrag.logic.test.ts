import type { WorkbenchTicketStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { canMoveWorkbenchBoardTicket } from "./workbenchBoardDrag.logic";

const move = {
  ticket: { status: "todo" as const, archivedAt: null },
  sourceColumnId: "todo",
  target: { columnId: "in_progress", status: "in_progress" as const },
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
            target: { columnId: destination, status: destination },
          }),
        ).toBe(source !== destination);
      }
    }
  });

  it("rejects pending, archived, and removed moves", () => {
    expect(canMoveWorkbenchBoardTicket({ ...move, ticket: { status: "todo" } })).toBe(true);
    expect(canMoveWorkbenchBoardTicket({ ...move, pending: true })).toBe(false);
    expect(
      canMoveWorkbenchBoardTicket({
        ...move,
        ticket: { ...move.ticket, archivedAt: "2026-09-11T12:00:00.000Z" },
      }),
    ).toBe(false);
    expect(canMoveWorkbenchBoardTicket({ ...move, sourceColumnId: undefined })).toBe(false);
  });
});
