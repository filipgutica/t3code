import type { WorkbenchEpicId, WorkbenchTicket, WorkbenchTicketStatus } from "@t3tools/contracts";

export const canMoveWorkbenchBoardTicket = ({
  ticket,
  sourceColumnId,
  target,
  groupByEpic,
  pending,
}: {
  ticket: Pick<WorkbenchTicket, "status" | "epicId" | "archivedAt">;
  sourceColumnId: string | undefined;
  target: { columnId: string; status: WorkbenchTicketStatus; epicId: WorkbenchEpicId | null };
  groupByEpic: boolean;
  pending: boolean;
}): boolean =>
  !pending &&
  ticket.archivedAt == null &&
  sourceColumnId !== undefined &&
  sourceColumnId !== target.columnId &&
  ticket.status !== target.status &&
  (!groupByEpic || ticket.epicId === target.epicId);
