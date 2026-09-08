import type {
  ProjectId,
  ThreadId,
  WorkbenchAssignment,
  WorkbenchEpic,
  WorkbenchSnapshot,
  WorkbenchTicket,
  WorkbenchTicketGeneratedSummary,
  WorkbenchTicketId,
  WorkbenchTicketKind,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";
import type { ReviewCommentContext } from "../reviewCommentContext";

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
  "done",
] as const satisfies ReadonlyArray<WorkbenchTicketStatus>;

export const WORKBENCH_TICKET_STATUS_LABELS: Record<WorkbenchTicketStatus, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  done: "Done",
};

export function getWorkbenchTicketSummaryPresentation(
  summary: WorkbenchTicketGeneratedSummary | undefined,
) {
  const text = summary?.text?.trim() ?? "";
  const hasText = text.length > 0;
  if (hasText) {
    return {
      text,
      hasText: true,
      statusLabel:
        summary?.status === "pending"
          ? "Generating summary…"
          : summary?.stale
            ? "Outdated summary"
            : summary?.status === "error"
              ? "Summary generation failed"
              : null,
      error: summary?.error?.trim() || null,
    } as const;
  }
  return {
    text: summary?.status === "pending" ? "Generating summary…" : "Summary unavailable",
    hasText: false,
    statusLabel: null,
    error: summary?.error?.trim() || null,
  } as const;
}

export function getWorkbenchTicketSummaryActionLabel(
  summary: WorkbenchTicketGeneratedSummary | undefined,
): string {
  return summary?.text?.trim() ? "Regenerate summary" : "Generate summary";
}

export function isWorkbenchTicketStatus(value: unknown): value is WorkbenchTicketStatus {
  return WORKBENCH_TICKET_STATUSES.some((status) => status === value);
}

export function getWorkbenchTicketStatusMoves(
  currentStatus: WorkbenchTicketStatus,
): ReadonlyArray<WorkbenchTicketStatus> {
  return WORKBENCH_TICKET_STATUSES.filter((status) => status !== currentStatus);
}

export function getWorkbenchEpicProgress(tickets: ReadonlyArray<Pick<WorkbenchTicket, "status">>) {
  const total = tickets.length;
  const completed = tickets.reduce(
    (count, ticket) => count + (ticket.status === "done" ? 1 : 0),
    0,
  );
  return {
    completed,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    total,
  };
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
      actionLabel: "Create Thread",
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
      stateLabel: nativeStateLabel ?? "Idle",
      state: "linked",
    } as const;
  }
  return {
    actionLabel: "Create replacement thread",
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
  liveThreadIds?: ReadonlySet<ThreadId>,
  archivedThreadIds?: ReadonlySet<ThreadId>,
): ReadonlyMap<WorkbenchTicketId, WorkbenchAssignment> {
  const activeAssignments = new Map<WorkbenchTicketId, WorkbenchAssignment>();
  for (const assignment of assignments.toSorted(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  )) {
    if (assignment.supersededAt !== null) continue;
    const current = activeAssignments.get(assignment.ticketId);
    const assignmentAvailability = liveThreadIds?.has(assignment.threadId)
      ? 2
      : archivedThreadIds?.has(assignment.threadId)
        ? 1
        : 0;
    const currentAvailability = current
      ? liveThreadIds?.has(current.threadId)
        ? 2
        : archivedThreadIds?.has(current.threadId)
          ? 1
          : 0
      : -1;
    if (!current || assignmentAvailability > currentAvailability) {
      activeAssignments.set(assignment.ticketId, assignment);
    }
  }
  return activeAssignments;
}

export function getVisibleWorkbenchAssignments(
  assignments: ReadonlyArray<WorkbenchAssignment>,
  liveThreadIds: ReadonlySet<ThreadId>,
  archivedThreadIds: ReadonlySet<ThreadId>,
  threadLookupReady: boolean,
): ReadonlyArray<WorkbenchAssignment> {
  if (!threadLookupReady) return assignments;
  return assignments.filter(
    (assignment) =>
      liveThreadIds.has(assignment.threadId) || archivedThreadIds.has(assignment.threadId),
  );
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

function neutralizeTicketContextTags(value: string): string {
  return value.replace(/<(?=\/?review_comment\b)/giu, "&lt;");
}

export function buildTicketThreadContext(
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
    `# ${ticket.title}`,
    "",
    `Ticket type: ${WORKBENCH_TICKET_KIND_LABELS[ticket.kind]}`,
    "",
    "## Repository scope",
    "",
    ...repositoryLines,
    ...(body.length > 0 ? ["", body] : []),
  ].join("\n");
}

export function buildTicketReviewComment(
  ticket: Pick<
    WorkbenchTicket,
    "id" | "title" | "markdown" | "kind" | "repositoryProjectIds" | "primaryT3ProjectId"
  >,
  repositories: ReadonlyArray<{
    readonly id: ProjectId;
    readonly title: string;
    readonly workspaceRoot: string;
  }>,
): ReviewCommentContext {
  const context = buildTicketThreadContext(ticket, repositories);
  return {
    id: `workbench-ticket:${ticket.id}`,
    sectionId: `workbench-ticket:${ticket.id}`,
    sectionTitle: "Agent Workbench ticket",
    filePath: ticket.title,
    startIndex: 0,
    endIndex: Math.max(0, context.split("\n").length - 1),
    rangeLabel: "Ticket context",
    text: ticket.title,
    diff: neutralizeTicketContextTags(context),
    fenceLanguage: "markdown",
  };
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

  const lanes = epics.map((epic) => ({ epic, tickets: ticketsByEpicId.get(epic.id) ?? [] }));
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
    done: [],
  };
  for (const ticket of tickets) grouped[ticket.status].push(ticket);
  return grouped;
}

/** Normalize native Thread presentation without maintaining another agent lifecycle. */
export function getWorkbenchAgentPresentation({
  nativeLabel,
  sessionStatus,
  turnState,
}: {
  readonly nativeLabel: string | null | undefined;
  readonly sessionStatus: string | null | undefined;
  readonly turnState: string | null | undefined;
}) {
  const needsInput = {
    label: "Blocked / needs input",
    dotClass: "bg-warning",
    colorClass: "text-warning-foreground",
  } as const;
  if (
    nativeLabel === "Pending Approval" ||
    nativeLabel === "Awaiting Input" ||
    nativeLabel === "Plan Ready"
  )
    return needsInput;
  if (nativeLabel === "Working" || nativeLabel === "Connecting" || nativeLabel === "Monitoring") {
    return { label: "Working", dotClass: "bg-info", colorClass: "text-info-foreground" } as const;
  }
  if (sessionStatus === "error" || turnState === "error" || turnState === "interrupted")
    return needsInput;
  if (turnState === "completed")
    return {
      label: "Ready for review",
      dotClass: "bg-success",
      colorClass: "text-success-foreground",
    } as const;
  return null;
}

export function getWorkbenchTicketAgentPresentation(
  threads: ReadonlyArray<Parameters<typeof getWorkbenchAgentPresentation>[0]>,
) {
  const states = threads.map(getWorkbenchAgentPresentation);
  return (
    states.find((state) => state?.label === "Blocked / needs input") ??
    states.find((state) => state?.label === "Working") ??
    states.find((state) => state?.label === "Ready for review") ??
    null
  );
}
