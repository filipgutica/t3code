import type {
  ProjectId,
  ThreadId,
  WorkbenchAssignment,
  WorkbenchEpic,
  WorkbenchSnapshot,
  WorkbenchTicket,
  WorkbenchTicketId,
  WorkbenchTicketKind,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";

export const WORKBENCH_TICKET_KINDS = [
  "story",
  "bug",
] as const satisfies ReadonlyArray<WorkbenchTicketKind>;

export const WORKBENCH_TICKET_KIND_LABELS: Record<WorkbenchTicketKind, string> = {
  story: "Story",
  bug: "Bug",
};

const WORKBENCH_TICKET_TEMPLATES: Record<WorkbenchTicketKind, string> = {
  story: [
    "## Goal",
    "",
    "## Work",
    "",
    "## Acceptance criteria",
    "",
    "## Non-goals",
    "",
    "## Testing",
  ].join("\n"),
  bug: [
    "## Observed behavior",
    "",
    "## Environment",
    "",
    "## Root-cause evidence",
    "",
    "## Proposed fix",
    "",
    "## Testing",
  ].join("\n"),
};

export function getWorkbenchTicketTemplate(kind: WorkbenchTicketKind): string {
  return WORKBENCH_TICKET_TEMPLATES[kind];
}

export function isWorkbenchTicketKind(value: unknown): value is WorkbenchTicketKind {
  return WORKBENCH_TICKET_KINDS.some((kind) => kind === value);
}

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
  archived = false,
  threadLookupReady = true,
) {
  if (!hasAssignment) {
    return {
      actionLabel: "Start work",
      pendingActionLabel: "Creating Thread…",
      stateLabel: "Unassigned",
      state: "unassigned",
    } as const;
  }
  if (archived) {
    return {
      actionLabel: "Restore Thread",
      pendingActionLabel: "Restoring Thread…",
      stateLabel: "Archived",
      state: "archived",
    } as const;
  }
  if (!threadExists && !threadLookupReady) {
    return {
      actionLabel: "Check Thread",
      pendingActionLabel: "Checking Thread…",
      stateLabel: "Checking archived Threads",
      state: "checking",
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

export function getActiveAssignmentsByTicket(
  assignments: ReadonlyArray<WorkbenchAssignment>,
): ReadonlyMap<WorkbenchTicketId, WorkbenchAssignment> {
  const activeAssignments = new Map<WorkbenchTicketId, WorkbenchAssignment>();
  for (const assignment of assignments) {
    if (assignment.supersededAt === null) activeAssignments.set(assignment.ticketId, assignment);
  }
  return activeAssignments;
}

export function getAssignmentsForTicket(
  assignments: ReadonlyArray<WorkbenchAssignment>,
  ticketId: WorkbenchTicketId,
): ReadonlyArray<WorkbenchAssignment> {
  return assignments
    .filter((assignment) => assignment.ticketId === ticketId)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function resolveWorkbenchTicketThreadTarget<Project extends { readonly id: ProjectId }>(
  ticket: Pick<WorkbenchTicket, "primaryT3ProjectId">,
  projects: ReadonlyArray<Project>,
  assignment: Pick<WorkbenchAssignment, "threadId"> | undefined,
  existingThreadIds: ReadonlySet<ThreadId>,
  threadLookupReady = true,
) {
  if (assignment && existingThreadIds.has(assignment.threadId)) {
    return { state: "open", threadId: assignment.threadId } as const;
  }
  if (assignment && !threadLookupReady) return { state: "thread-status-unavailable" } as const;
  const project = projects.find((candidate) => candidate.id === ticket.primaryT3ProjectId);
  return project
    ? ({ state: "start", project } as const)
    : ({ state: "project-unavailable" } as const);
}

export function getWorkbenchTicketRepositoryProjectIds(
  ticket: Pick<WorkbenchTicket, "repositoryProjectIds" | "primaryT3ProjectId">,
): ReadonlyArray<ProjectId> {
  return ticket.repositoryProjectIds.length > 0
    ? ticket.repositoryProjectIds
    : [ticket.primaryT3ProjectId];
}

export function resolveWorkbenchRepositoryOpenCwd({
  repositoryId,
  primaryProjectId,
  repositoryWorkspaceRoot,
  activeThreadWorktreePath,
}: {
  readonly repositoryId: ProjectId;
  readonly primaryProjectId: ProjectId;
  readonly repositoryWorkspaceRoot: string;
  readonly activeThreadWorktreePath: string | null | undefined;
}): string {
  return repositoryId === primaryProjectId
    ? (activeThreadWorktreePath ?? repositoryWorkspaceRoot)
    : repositoryWorkspaceRoot;
}

export function isWorkbenchThreadArchived(
  threadId: ThreadId,
  liveThreads: ReadonlyMap<ThreadId, unknown>,
  archivedThreads: ReadonlyMap<ThreadId, unknown>,
): boolean {
  return !liveThreads.has(threadId) && archivedThreads.has(threadId);
}

export function buildTicketThreadPrompt(
  ticket: Pick<
    WorkbenchTicket,
    "title" | "markdown" | "kind" | "repositoryProjectIds" | "primaryT3ProjectId"
  >,
  repositories: ReadonlyArray<{
    readonly id: ProjectId;
    readonly title: string;
    readonly workspaceRoot: string;
  }>,
): string {
  const body = ticket.markdown.trim();
  const repositoriesById = new Map(repositories.map((repository) => [repository.id, repository]));
  const repositoryLines = getWorkbenchTicketRepositoryProjectIds(ticket).map((repositoryId) => {
    const repository = repositoriesById.get(repositoryId);
    const title = repository?.title ?? repositoryId;
    const workspaceRoot = repository?.workspaceRoot ?? "Repository unavailable";
    return `- ${title}${repositoryId === ticket.primaryT3ProjectId ? " (primary)" : ""} — ${workspaceRoot}`;
  });
  return [
    `Work on this Agent Workbench ${WORKBENCH_TICKET_KIND_LABELS[ticket.kind]} ticket.`,
    "",
    `# ${ticket.title}`,
    "",
    "## Repository scope",
    "",
    ...repositoryLines,
    ...(body.length > 0 ? ["", body] : []),
  ].join("\n");
}

export function groupWorkbenchTicketsByEpic<
  Ticket extends Pick<WorkbenchTicket, "epicId">,
  Epic extends Pick<WorkbenchEpic, "id">,
>(
  tickets: ReadonlyArray<Ticket>,
  epics: ReadonlyArray<Epic>,
): ReadonlyArray<{ readonly epic: Epic | null; readonly tickets: ReadonlyArray<Ticket> }> {
  const epicsById = new Map(epics.map((epic) => [epic.id, epic]));
  const ticketsByEpicId = new Map<string, Array<Ticket>>();
  const unassignedTickets: Array<Ticket> = [];

  for (const ticket of tickets) {
    if (ticket.epicId === null || !epicsById.has(ticket.epicId)) {
      unassignedTickets.push(ticket);
      continue;
    }
    const epicTickets = ticketsByEpicId.get(ticket.epicId) ?? [];
    epicTickets.push(ticket);
    ticketsByEpicId.set(ticket.epicId, epicTickets);
  }

  const lanes = epics.flatMap((epic) => {
    const epicTickets = ticketsByEpicId.get(epic.id);
    return epicTickets && epicTickets.length > 0 ? [{ epic, tickets: epicTickets }] : [];
  });
  return unassignedTickets.length > 0
    ? [...lanes, { epic: null, tickets: unassignedTickets }]
    : lanes;
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
