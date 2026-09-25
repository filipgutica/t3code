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

/** Reveals a newly selected route without replacing disclosure choices elsewhere. */
export function revealWorkbenchSidebarSelection(
  state: WorkbenchSidebarExpansion,
  {
    workspaceId,
    ticketId,
    ticketIsDone,
  }: {
    readonly workspaceId: WorkbenchProjectId | undefined;
    readonly ticketId: WorkbenchTicketId | undefined;
    readonly ticketIsDone: boolean;
  },
): WorkbenchSidebarExpansion {
  if (workspaceId === undefined) return state;
  if (state.workspaceId !== workspaceId) {
    return getWorkbenchSidebarExpansionDefaults({ workspaceId, ticketId, ticketIsDone });
  }
  if (ticketId && (state.ticketId !== ticketId || state.done !== ticketIsDone)) {
    return { ...state, ticketId, done: ticketIsDone, archived: false };
  }
  return state;
}

export function reduceWorkbenchSidebarExpansion(
  state: WorkbenchSidebarExpansion,
  action: WorkbenchSidebarExpansionAction,
): WorkbenchSidebarExpansion {
  switch (action.type) {
    case "toggleWorkspace":
      return action.workspaceId === state.workspaceId
        ? { workspaceId: null, ticketId: null, done: false, archived: false }
        : {
            workspaceId: action.workspaceId,
            ticketId: null,
            done: false,
            archived: false,
          };
    case "toggleTicket":
      return {
        workspaceId: action.workspaceId,
        ticketId:
          action.workspaceId === state.workspaceId &&
          action.ticketId === state.ticketId &&
          action.done === state.done
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

/** Groups native Threads under one Ticket, retaining its settled history. */
export function getWorkbenchSidebarTicketGroups({
  environmentId,
  tickets,
  assignments,
  threads,
  selectedTicketId,
  selectedThreadId,
  includeUnassignedTickets = false,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly tickets: ReadonlyArray<WorkbenchSidebarTicket>;
  readonly assignments: ReadonlyArray<WorkbenchSidebarAssignment>;
  readonly threads: ReadonlyArray<WorkbenchSidebarThread>;
  readonly selectedTicketId: WorkbenchTicketId | undefined;
  readonly selectedThreadId?: ThreadId | undefined;
  readonly includeUnassignedTickets?: boolean;
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

  const assignmentsByTicket = new Map<WorkbenchTicketId, WorkbenchAssignment[]>();
  for (const assignment of assignments) {
    const thread = liveThreadsById.get(assignment.threadId);
    if (thread === undefined) continue;
    const ticketAssignments = assignmentsByTicket.get(assignment.ticketId) ?? [];
    ticketAssignments.push(assignment);
    assignmentsByTicket.set(assignment.ticketId, ticketAssignments);
  }

  const groups = new Map<
    WorkbenchProjectId,
    {
      active: WorkbenchSidebarTicketGroup[];
      done: WorkbenchSidebarTicketGroup[];
    }
  >();
  for (const ticket of tickets) {
    if (ticket.archivedAt != null && ticket.id !== selectedTicketId) continue;

    const ticketAssignments = assignmentsByTicket.get(ticket.id) ?? [];
    const seenThreadIds = new Set<ThreadId>();
    const ticketThreads = ticketAssignments
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

/** Keeps matching rows and the ancestors needed to reach them in the sidebar. */
export function filterWorkbenchSidebarNavigation({
  query,
  projects,
  ticketGroupsByWorkspace,
  archivedTicketsByWorkspace,
  jiraKeysByTicketId,
}: {
  readonly query: string;
  readonly projects: ReadonlyArray<{ readonly id: WorkbenchProjectId; readonly title: string }>;
  readonly ticketGroupsByWorkspace: ReadonlyMap<WorkbenchProjectId, WorkbenchSidebarTicketSections>;
  readonly archivedTicketsByWorkspace: ReadonlyMap<
    WorkbenchProjectId,
    ReadonlyArray<WorkbenchSidebarTicket>
  >;
  readonly jiraKeysByTicketId: ReadonlyMap<WorkbenchTicketId, string>;
}) {
  const needle = query.trim().toLocaleLowerCase();
  const matches = (value: string | undefined) => value?.toLowerCase().includes(needle) ?? false;
  const visibleProjects: Array<(typeof projects)[number]> = [];
  const visibleGroups = new Map<WorkbenchProjectId, WorkbenchSidebarTicketSections>();
  const visibleArchived = new Map<WorkbenchProjectId, ReadonlyArray<WorkbenchSidebarTicket>>();
  let resultCount = 0;

  for (const project of projects) {
    const workspaceMatches = matches(project.title);
    const sections = ticketGroupsByWorkspace.get(project.id) ?? { active: [], done: [] };
    const filterGroups = (groups: ReadonlyArray<WorkbenchSidebarTicketGroup>) =>
      groups.flatMap((group) => {
        const ticketMatches =
          matches(group.ticket.title) || matches(jiraKeysByTicketId.get(group.ticket.id));
        const threads = group.threads.filter((thread) => matches(thread.title));
        if (!ticketMatches && threads.length === 0) return [];
        resultCount += (ticketMatches ? 1 : 0) + threads.length;
        return [{ ...group, threads }];
      });
    const active = filterGroups(sections.active);
    const done = filterGroups(sections.done);
    const archived = (archivedTicketsByWorkspace.get(project.id) ?? []).filter(
      (ticket) => matches(ticket.title) || matches(jiraKeysByTicketId.get(ticket.id)),
    );
    resultCount += archived.length;
    if (!workspaceMatches && active.length === 0 && done.length === 0 && archived.length === 0)
      continue;
    if (workspaceMatches) resultCount += 1;
    visibleProjects.push(project);
    visibleGroups.set(project.id, { active, done });
    if (archived.length > 0) visibleArchived.set(project.id, archived);
  }

  return {
    projects: visibleProjects,
    ticketGroupsByWorkspace: visibleGroups,
    archivedTicketsByWorkspace: visibleArchived,
    resultCount,
  };
}
