import type { WorkbenchTicket, WorkbenchTicketStatus } from "@t3tools/contracts";

export const canMoveWorkbenchBoardTicket = ({
  ticket,
  sourceColumnId,
  target,
  pending,
}: {
  ticket: Pick<WorkbenchTicket, "status" | "archivedAt">;
  sourceColumnId: string | undefined;
  target: { columnId: string; status: WorkbenchTicketStatus };
  pending: boolean;
}): boolean =>
  !pending &&
  ticket.archivedAt == null &&
  sourceColumnId !== undefined &&
  sourceColumnId !== target.columnId &&
  ticket.status !== target.status;
