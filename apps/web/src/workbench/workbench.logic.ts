import type {
  ThreadId,
  WorkbenchSnapshot,
  WorkbenchTicket,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";

export const WORKBENCH_TICKET_STATUSES = [
  "todo",
  "in_progress",
  "ready_for_review",
  "done",
] as const satisfies ReadonlyArray<WorkbenchTicketStatus>;

export const WORKBENCH_TICKET_STATUS_LABELS: Record<WorkbenchTicketStatus, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  ready_for_review: "Ready for Review",
  done: "Done",
};

export function isWorkbenchTicketStatus(value: unknown): value is WorkbenchTicketStatus {
  return WORKBENCH_TICKET_STATUSES.some((status) => status === value);
}

export function getWorkbenchTicketStatusMoves(
  currentStatus: WorkbenchTicketStatus,
): ReadonlyArray<WorkbenchTicketStatus> {
  return WORKBENCH_TICKET_STATUSES.filter((status) => status !== currentStatus);
}

export function getWorkbenchThreadPresentation(
  hasAssignment: boolean,
  threadExists: boolean,
  nativeStateLabel?: string | null,
) {
  if (!hasAssignment) {
    return {
      actionLabel: "Start work",
      pendingActionLabel: "Creating Thread…",
      stateLabel: "Unassigned",
      state: "unassigned",
    } as const;
  }
  if (threadExists) {
    return {
      actionLabel: "Open Thread",
      pendingActionLabel: "Opening Thread…",
      stateLabel: nativeStateLabel ?? "Ready",
      state: "linked",
    } as const;
  }
  return {
    actionLabel: "Start replacement",
    pendingActionLabel: "Creating Thread…",
    stateLabel: "Thread unavailable",
    state: "missing",
  } as const;
}

export function getWorkbenchContextForThread(
  snapshot: WorkbenchSnapshot | null,
  threadId: ThreadId,
) {
  if (!snapshot) return null;
  const assignment = snapshot.assignments.find((candidate) => candidate.threadId === threadId);
  if (!assignment) return null;
  const ticket = snapshot.tickets.find((candidate) => candidate.id === assignment.ticketId);
  if (!ticket) return null;
  const workspace = snapshot.projects.find((candidate) => candidate.id === ticket.projectId);
  return workspace ? { assignment, ticket, workspace } : null;
}

export function buildTicketThreadPrompt(
  ticket: Pick<WorkbenchTicket, "title" | "markdown">,
): string {
  const body = ticket.markdown.trim();
  return [
    "Work on this Agent Workbench ticket.",
    "",
    `# ${ticket.title}`,
    ...(body.length > 0 ? ["", body] : []),
  ].join("\n");
}

export function ticketsByStatus<Ticket extends Pick<WorkbenchTicket, "status">>(
  tickets: ReadonlyArray<Ticket>,
): Record<WorkbenchTicketStatus, ReadonlyArray<Ticket>> {
  const grouped: Record<WorkbenchTicketStatus, Array<Ticket>> = {
    todo: [],
    in_progress: [],
    ready_for_review: [],
    done: [],
  };
  for (const ticket of tickets) grouped[ticket.status].push(ticket);
  return grouped;
}
