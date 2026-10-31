import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { sortPinnedThreadsByOrderKey } from "@t3tools/client-runtime/state/thread-sort";
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
  | "id"
  | "environmentId"
  | "title"
  | "archivedAt"
  | "settledOverride"
  | "createdAt"
  | "pinnedAt"
  | "pinOrderKey"
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
  readonly done: boolean;
  readonly archived: boolean;
}

export type WorkbenchSidebarExpansionAction =
  | {
      readonly type: "toggleWorkspace";
      readonly workspaceId: WorkbenchProjectId;
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
  ticketIsDone,
}: {
  readonly workspaceId: WorkbenchProjectId | undefined;
  readonly ticketIsDone: boolean;
}): WorkbenchSidebarExpansion {
  return { workspaceId: workspaceId ?? null, done: ticketIsDone, archived: false };
}

/** Reveals a newly selected route, opening Done for a done Ticket, and keeps other choices. */
export function revealWorkbenchSidebarSelection(
  state: WorkbenchSidebarExpansion,
  {
    workspaceId,
    ticketIsDone,
  }: {
    readonly workspaceId: WorkbenchProjectId | undefined;
    readonly ticketIsDone: boolean;
  },
): WorkbenchSidebarExpansion {
  if (workspaceId === undefined) return state;
  if (state.workspaceId !== workspaceId) {
    return getWorkbenchSidebarExpansionDefaults({ workspaceId, ticketIsDone });
  }
  if (ticketIsDone && !state.done) return { ...state, done: true, archived: false };
  return state;
}

export function reduceWorkbenchSidebarExpansion(
  state: WorkbenchSidebarExpansion,
  action: WorkbenchSidebarExpansionAction,
): WorkbenchSidebarExpansion {
  switch (action.type) {
    case "toggleWorkspace":
      return {
        workspaceId: action.workspaceId === state.workspaceId ? null : action.workspaceId,
        done: false,
        archived: false,
      };
    case "toggleArchived":
      return {
        workspaceId: action.workspaceId,
        done: false,
        archived: action.workspaceId === state.workspaceId ? !state.archived : true,
      };
    case "toggleDone":
      return {
        workspaceId: action.workspaceId,
        done: action.workspaceId === state.workspaceId ? !state.done : true,
        archived: false,
      };
  }
}

type SidebarGroupInputs = {
  readonly environmentId: EnvironmentId | null;
  readonly tickets: ReadonlyArray<WorkbenchSidebarTicket>;
  readonly assignments: ReadonlyArray<WorkbenchSidebarAssignment>;
  readonly threads: ReadonlyArray<WorkbenchSidebarThread>;
  readonly selectedTicketId: WorkbenchTicketId | undefined;
  readonly selectedThreadId?: ThreadId | undefined;
  readonly includeUnassignedTickets?: boolean;
};

const getVisibleThreadsById = ({
  environmentId,
  threads,
  selectedThreadId,
}: Pick<SidebarGroupInputs, "environmentId" | "threads" | "selectedThreadId">) => {
  const liveThreadsById = new Map<ThreadId, WorkbenchSidebarThread>();
  if (environmentId === null) return liveThreadsById;
  for (const thread of threads) {
    if (
      thread.environmentId !== environmentId ||
      (thread.archivedAt !== null && thread.id !== selectedThreadId)
    )
      continue;
    liveThreadsById.set(thread.id, thread);
  }
  return liveThreadsById;
};

const getAssignmentsByTicket = ({
  assignments,
  liveThreadsById,
}: {
  readonly assignments: SidebarGroupInputs["assignments"];
  readonly liveThreadsById: ReadonlyMap<ThreadId, WorkbenchSidebarThread>;
}) => {
  const assignmentsByTicket = new Map<WorkbenchTicketId, WorkbenchAssignment[]>();
  for (const assignment of assignments) {
    if (!liveThreadsById.has(assignment.threadId)) continue;
    const ticketAssignments = assignmentsByTicket.get(assignment.ticketId) ?? [];
    ticketAssignments.push(assignment);
    assignmentsByTicket.set(assignment.ticketId, ticketAssignments);
  }
  return assignmentsByTicket;
};

const getTicketThreads = ({
  ticketAssignments,
  liveThreadsById,
}: {
  readonly ticketAssignments: ReadonlyArray<WorkbenchSidebarAssignment>;
  readonly liveThreadsById: ReadonlyMap<ThreadId, WorkbenchSidebarThread>;
}) => {
  const seenThreadIds = new Set<ThreadId>();
  const threads = ticketAssignments
    .toSorted(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    )
    .flatMap(({ threadId }) => {
      const thread = liveThreadsById.get(threadId);
      if (thread === undefined || seenThreadIds.has(thread.id)) return [];
      seenThreadIds.add(thread.id);
      return [thread];
    });
  // Pinning keeps a Thread at the top, in native's pinned order; the rest stay newest-first.
  const pinned = threads.filter((thread) => thread.pinnedAt != null);
  if (pinned.length === 0) return threads;
  return [
    ...sortPinnedThreadsByOrderKey(pinned),
    ...threads.filter((thread) => thread.pinnedAt == null),
  ];
};

/** Groups native Threads under one Ticket, retaining its settled history. */
export function getWorkbenchSidebarTicketGroups({
  environmentId,
  tickets,
  assignments,
  threads,
  selectedTicketId,
  selectedThreadId,
  includeUnassignedTickets = false,
}: SidebarGroupInputs): ReadonlyMap<WorkbenchProjectId, WorkbenchSidebarTicketSections> {
  const liveThreadsById = getVisibleThreadsById({ environmentId, threads, selectedThreadId });
  const assignmentsByTicket = getAssignmentsByTicket({ assignments, liveThreadsById });
  const groups = new Map<
    WorkbenchProjectId,
    {
      active: WorkbenchSidebarTicketGroup[];
      done: WorkbenchSidebarTicketGroup[];
    }
  >();
  for (const ticket of tickets) {
    if (ticket.archivedAt != null && ticket.id !== selectedTicketId) continue;

    const ticketThreads = getTicketThreads({
      ticketAssignments: assignmentsByTicket.get(ticket.id) ?? [],
      liveThreadsById,
    });
    const workspaceTickets = groups.get(ticket.projectId) ?? {
      active: [],
      done: [],
    };
    if (ticket.status === "done" && ticket.archivedAt == null) {
      workspaceTickets.done.push({ ticket, threads: ticketThreads });
    } else if (
      ticketThreads.length > 0 ||
      ticket.id === selectedTicketId ||
      includeUnassignedTickets
    ) {
      workspaceTickets.active.push({ ticket, threads: ticketThreads });
    }
    if (workspaceTickets.active.length === 0 && workspaceTickets.done.length === 0) continue;
    groups.set(ticket.projectId, workspaceTickets);
  }

  return groups;
}
