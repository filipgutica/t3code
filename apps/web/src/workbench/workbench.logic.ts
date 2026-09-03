import type { WorkbenchTicket, WorkbenchTicketStatus } from "@t3tools/contracts";

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

export function getWorkbenchThreadPresentation(hasAssignment: boolean, threadExists: boolean) {
  if (!hasAssignment) {
    return {
      actionLabel: "Start work",
      stateLabel: "Unassigned",
      state: "unassigned",
    } as const;
  }
  if (threadExists) {
    return {
      actionLabel: "Open Thread",
      stateLabel: "Thread linked",
      state: "linked",
    } as const;
  }
  return {
    actionLabel: "Start replacement",
    stateLabel: "Thread unavailable",
    state: "missing",
  } as const;
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
