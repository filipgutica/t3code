import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ThreadId,
  WorkbenchAssignment,
  WorkbenchProjectId,
  WorkbenchTicket,
  WorkbenchTicketId,
} from "@t3tools/contracts";

export type WorkbenchSidebarTicket = Pick<
  WorkbenchTicket,
  "id" | "projectId" | "title" | "status" | "archivedAt"
>;

export type WorkbenchSidebarThread = Pick<
  EnvironmentThreadShell,
  "id" | "environmentId" | "title" | "archivedAt" | "settledOverride"
>;

export type WorkbenchSidebarAssignment = Pick<
  WorkbenchAssignment,
  "id" | "ticketId" | "threadId" | "createdAt" | "supersededAt"
>;

export interface WorkbenchSidebarTicketGroup {
  readonly ticket: WorkbenchSidebarTicket;
  readonly threads: ReadonlyArray<WorkbenchSidebarThread>;
}

export interface WorkbenchSidebarTicketSections {
  readonly active: ReadonlyArray<WorkbenchSidebarTicketGroup>;
  readonly done: ReadonlyArray<WorkbenchSidebarTicketGroup>;
}

export interface WorkbenchSidebarExpansion {
  readonly workspaceId: WorkbenchProjectId | null;
  readonly ticketId: WorkbenchTicketId | null;
  readonly done: boolean;
  readonly archived: boolean;
}

export type WorkbenchSidebarExpansionAction =
  | {
      readonly type: "toggleWorkspace";
      readonly workspaceId: WorkbenchProjectId;
    }
  | {
      readonly type: "toggleTicket";
      readonly workspaceId: WorkbenchProjectId;
      readonly ticketId: WorkbenchTicketId;
      readonly done: boolean;
    }
  | {
      readonly type: "toggleArchived";
      readonly workspaceId: WorkbenchProjectId;
    }
  | {
      readonly type: "toggleDone";
      readonly workspaceId: WorkbenchProjectId;
    };

export function getWorkbenchSidebarExpansionDefaults({
  workspaceId,
  ticketId,
  ticketIsDone,
}: {
  readonly workspaceId: WorkbenchProjectId | undefined;
  readonly ticketId: WorkbenchTicketId | undefined;
  readonly ticketIsDone: boolean;
}): WorkbenchSidebarExpansion {
  return {
    workspaceId: workspaceId ?? null,
    ticketId: ticketId ?? null,
    done: ticketIsDone,
    archived: false,
  };
}

export function reduceWorkbenchSidebarExpansion(
  state: WorkbenchSidebarExpansion,
  action: WorkbenchSidebarExpansionAction,
): WorkbenchSidebarExpansion {
  switch (action.type) {
    case "toggleWorkspace":
      return action.workspaceId === state.workspaceId
        ? { workspaceId: null, ticketId: null, done: false, archived: false }
        : { workspaceId: action.workspaceId, ticketId: null, done: false, archived: false };
    case "toggleTicket":
      return {
        workspaceId: action.workspaceId,
        ticketId:
          action.workspaceId === state.workspaceId && action.ticketId === state.ticketId
            ? null
            : action.ticketId,
        done: action.done,
        archived: false,
      };
    case "toggleArchived":
      return {
        workspaceId: action.workspaceId,
        ticketId: null,
        done: false,
        archived: action.workspaceId === state.workspaceId ? !state.archived : true,
      };
    case "toggleDone":
      return {
        workspaceId: action.workspaceId,
        ticketId: null,
        done: action.workspaceId === state.workspaceId ? !state.done : true,
        archived: false,
      };
  }
}

/**
 * Selects the live native Threads that give a Workbench Ticket a sidebar row.
 * The selected Ticket is retained even when its assignment has no live shell,
 * which keeps the current Ticket discoverable while its Thread lookup catches up.
 */
export function getWorkbenchSidebarTicketGroups({
  environmentId,
  tickets,
  assignments,
  threads,
  selectedTicketId,
  selectedThreadId,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly tickets: ReadonlyArray<WorkbenchSidebarTicket>;
  readonly assignments: ReadonlyArray<WorkbenchSidebarAssignment>;
  readonly threads: ReadonlyArray<WorkbenchSidebarThread>;
  readonly selectedTicketId: WorkbenchTicketId | undefined;
  readonly selectedThreadId?: ThreadId | undefined;
}): ReadonlyMap<WorkbenchProjectId, WorkbenchSidebarTicketSections> {
  const liveThreadsById = new Map<ThreadId, WorkbenchSidebarThread>();
  if (environmentId !== null) {
    for (const thread of threads) {
      if (
        thread.environmentId !== environmentId ||
        (thread.archivedAt !== null && thread.id !== selectedThreadId)
      )
        continue;
      liveThreadsById.set(thread.id, thread);
    }
  }

  const activeAssignmentsByTicket = new Map<WorkbenchTicketId, WorkbenchAssignment[]>();
  for (const assignment of assignments) {
    if (assignment.supersededAt !== null || !liveThreadsById.has(assignment.threadId)) continue;
    const ticketAssignments = activeAssignmentsByTicket.get(assignment.ticketId) ?? [];
    ticketAssignments.push(assignment);
    activeAssignmentsByTicket.set(assignment.ticketId, ticketAssignments);
  }

  const groups = new Map<
    WorkbenchProjectId,
    { active: WorkbenchSidebarTicketGroup[]; done: WorkbenchSidebarTicketGroup[] }
  >();
  for (const ticket of tickets) {
    if (ticket.archivedAt != null && ticket.id !== selectedTicketId) continue;

    const ticketAssignments = activeAssignmentsByTicket.get(ticket.id) ?? [];
    const ticketThreads = ticketAssignments
      .toSorted(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
      )
      .flatMap(({ threadId }) => {
        const thread = liveThreadsById.get(threadId);
        return thread === undefined ? [] : [thread];
      });
    const workspaceTickets = groups.get(ticket.projectId) ?? { active: [], done: [] };
    if (ticket.status === "done" && ticket.archivedAt == null) {
      workspaceTickets.done.push({ ticket, threads: ticketThreads });
    } else if (
      ticketThreads.some((thread) => thread.settledOverride !== "settled") ||
      ticket.id === selectedTicketId
    ) {
      workspaceTickets.active.push({ ticket, threads: ticketThreads });
    } else {
      continue;
    }
    groups.set(ticket.projectId, workspaceTickets);
  }

  return groups;
}
