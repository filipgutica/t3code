import {
  type EnvironmentId,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ThreadFamily,
  type OrchestrationV2ThreadShell,
  type ScopedThreadRef,
  type ThreadId,
  type WorkbenchAssignment,
  type WorkbenchSnapshot,
  type WorkbenchTicket,
  type WorkbenchTicketGeneratedSummary,
  type WorkbenchTicketId,
  type WorkbenchTicketStatus,
} from "@t3tools/contracts";

export const WORKBENCH_TICKET_TEMPLATE = [
  "## Goal",
  "",
  "## Work",
  "",
  "## Acceptance criteria",
  "",
  "## Non-goals",
  "",
  "## Testing",
].join("\n");

const WORKBENCH_TICKET_STATUSES = [
  "todo",
  "in_progress",
  "done",
] as const satisfies ReadonlyArray<WorkbenchTicketStatus>;

export const WORKBENCH_TICKET_STATUS_LABELS: Record<WorkbenchTicketStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

export function getWorkbenchBoardColumns<Ticket extends Pick<WorkbenchTicket, "status">>(
  tickets: ReadonlyArray<Ticket>,
) {
  return WORKBENCH_TICKET_STATUSES.map((status) => ({
    id: status,
    title: WORKBENCH_TICKET_STATUS_LABELS[status],
    status,
    tickets: tickets.filter((ticket) => ticket.status === status),
  }));
}

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

export function getWorkbenchTicketStatusMoves(
  currentStatus: WorkbenchTicketStatus,
): ReadonlyArray<WorkbenchTicketStatus> {
  return WORKBENCH_TICKET_STATUSES.filter((status) => status !== currentStatus);
}

/**
 * Whether a Thread ref's lookup can tell a missing Thread from one not yet read. A remote ref is
 * `offline` while its environment is not connected on this client.
 */
export type WorkbenchThreadLookupState = "ready" | "checking" | "offline";

/** The environment that owns an Assignment's Thread: its own when remote, else the Board host. */
export const getWorkbenchAssignmentEnvironmentId = (
  assignment: Pick<WorkbenchAssignment, "environmentId">,
  hostEnvironmentId: EnvironmentId,
): EnvironmentId => assignment.environmentId ?? hostEnvironmentId;

/** The floating chat talks to the Board host; a Thread on another machine opens on its own page. */
export const isWorkbenchHostAssignment = (assignment: Pick<WorkbenchAssignment, "environmentId">) =>
  assignment.environmentId === undefined;

export function getWorkbenchThreadLookupState({
  assignment,
  threadLookupReady,
  remoteEnvironmentStates,
}: {
  readonly assignment: Pick<WorkbenchAssignment, "environmentId">;
  /** The host's lookup. */
  readonly threadLookupReady: boolean;
  /** Each remote ref environment's lookup; an absent environment is offline. */
  readonly remoteEnvironmentStates: ReadonlyMap<EnvironmentId, WorkbenchThreadLookupState>;
}): WorkbenchThreadLookupState {
  if (assignment.environmentId === undefined) return threadLookupReady ? "ready" : "checking";
  return remoteEnvironmentStates.get(assignment.environmentId) ?? "offline";
}

/**
 * The Threads a Board's refs point to, by id: each remote Assignment's Thread from its own
 * environment, and every other Thread in the host environment. A host Thread that shares a remote
 * Assignment's id (copied data) is left out, as the host does.
 */
export function getWorkbenchThreadsById<
  Thread extends { readonly id: ThreadId; readonly environmentId: EnvironmentId },
>({
  hostEnvironmentId,
  assignments,
  threads,
}: {
  readonly hostEnvironmentId: EnvironmentId | null;
  readonly assignments: ReadonlyArray<Pick<WorkbenchAssignment, "threadId" | "environmentId">>;
  readonly threads: ReadonlyArray<Thread>;
}): ReadonlyMap<ThreadId, Thread> {
  const remoteEnvironmentByThread = new Map(
    assignments.flatMap((assignment) =>
      assignment.environmentId === undefined
        ? []
        : [[assignment.threadId, assignment.environmentId] as const],
    ),
  );
  return new Map(
    threads
      .filter(
        (thread) =>
          thread.environmentId === (remoteEnvironmentByThread.get(thread.id) ?? hostEnvironmentId),
      )
      .map((thread) => [thread.id, thread]),
  );
}

/**
 * Threads whose shells reflect their server: every host Thread, and one on another machine only
 * while that machine's shells are live. A disconnected machine's cached shell keeps a stale status.
 */
export const getWorkbenchReachableThreads = <
  Thread extends { readonly environmentId: EnvironmentId },
>({
  hostEnvironmentId,
  liveEnvironmentIds,
  threads,
}: {
  readonly hostEnvironmentId: EnvironmentId | null;
  readonly liveEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly threads: ReadonlyArray<Thread>;
}): ReadonlyArray<Thread> =>
  threads.filter(
    (thread) =>
      thread.environmentId === hostEnvironmentId || liveEnvironmentIds.has(thread.environmentId),
  );

export function getWorkbenchThreadPresentation(
  hasAssignment: boolean,
  threadExists: boolean,
  nativeStateLabel?: string | null,
  archived = false,
  threadLookupState: WorkbenchThreadLookupState = "ready",
) {
  if (!hasAssignment) {
    return {
      actionLabel: "Create Thread",
      pendingActionLabel: "Creating Thread…",
      stateLabel: "No Thread",
      state: "unassigned",
    } as const;
  }
  // A Thread on a machine this client cannot reach shows no cached status.
  if (threadLookupState === "offline") {
    return {
      actionLabel: "Check Thread",
      pendingActionLabel: "Checking Thread…",
      stateLabel: "Offline",
      state: "offline",
    } as const;
  }
  if (archived) {
    return {
      actionLabel: "Restore and open",
      pendingActionLabel: "Restoring Thread…",
      stateLabel: "Archived",
      state: "archived",
    } as const;
  }
  if (!threadExists && threadLookupState === "checking") {
    return {
      actionLabel: "Check Thread",
      pendingActionLabel: "Checking Thread…",
      stateLabel: "Checking Threads…",
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
    actionLabel: "Create replacement Thread",
    pendingActionLabel: "Creating replacement Thread…",
    stateLabel: "Thread deleted",
    state: "missing",
  } as const;
}

/** The Ticket that assigns a Thread, from the snapshot of the Board host `hostEnvironmentId`. */
export function getWorkbenchContextForThread(
  snapshot: WorkbenchSnapshot | null,
  hostEnvironmentId: EnvironmentId,
  threadRef: ScopedThreadRef,
) {
  if (!snapshot) return null;
  const assignment = snapshot.assignments.find(
    (candidate) =>
      candidate.threadId === threadRef.threadId &&
      getWorkbenchAssignmentEnvironmentId(candidate, hostEnvironmentId) === threadRef.environmentId,
  );
  if (!assignment) return null;
  const ticket = snapshot.tickets.find((candidate) => candidate.id === assignment.ticketId);
  if (!ticket) return null;
  const workspace = snapshot.projects.find((candidate) => candidate.id === ticket.projectId);
  return workspace ? { assignment, ticket, workspace } : null;
}

export function getActiveAssignmentsByTicket({
  assignments,
  liveThreadIds,
  archivedThreadIds,
  workingThreadIds,
}: {
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly liveThreadIds?: ReadonlySet<ThreadId>;
  readonly archivedThreadIds?: ReadonlySet<ThreadId>;
  readonly workingThreadIds?: ReadonlySet<ThreadId>;
}): ReadonlyMap<WorkbenchTicketId, WorkbenchAssignment> {
  const getThreadAvailabilityRank = (threadId: ThreadId) => {
    if (liveThreadIds?.has(threadId)) return workingThreadIds?.has(threadId) ? 3 : 2;
    return archivedThreadIds?.has(threadId) ? 1 : 0;
  };
  const activeAssignments = new Map<WorkbenchTicketId, WorkbenchAssignment>();
  for (const assignment of assignments.toSorted(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  )) {
    if (assignment.supersededAt !== null) continue;
    const current = activeAssignments.get(assignment.ticketId);
    if (
      !current ||
      getThreadAvailabilityRank(assignment.threadId) > getThreadAvailabilityRank(current.threadId)
    ) {
      activeAssignments.set(assignment.ticketId, assignment);
    }
  }
  return activeAssignments;
}

export interface WorkbenchTicketThreadSections {
  readonly active: ReadonlyArray<WorkbenchAssignment>;
  readonly history: ReadonlyArray<WorkbenchAssignment>;
  readonly settled: ReadonlyArray<WorkbenchAssignment>;
}

/**
 * Keeps native settled Threads out of a Ticket's active and historical lists.
 * Missing Threads stay visible in their original section while the lookup is
 * incomplete, so an assignment cannot disappear just because its shell is
 * still loading.
 */
export function getWorkbenchTicketThreadSections({
  assignments,
  threadsById,
  archivedThreadsById,
}: {
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly threadsById: ReadonlyMap<ThreadId, Pick<OrchestrationV2ThreadShell, "settledOverride">>;
  readonly archivedThreadsById: ReadonlyMap<
    ThreadId,
    Pick<OrchestrationV2ThreadShell, "settledOverride">
  >;
}): WorkbenchTicketThreadSections {
  const active: WorkbenchAssignment[] = [];
  const history: WorkbenchAssignment[] = [];
  const settled: WorkbenchAssignment[] = [];

  for (const assignment of assignments) {
    const thread =
      threadsById.get(assignment.threadId) ?? archivedThreadsById.get(assignment.threadId);
    if (thread?.settledOverride === "settled") {
      settled.push(assignment);
    } else if (assignment.supersededAt === null) {
      active.push(assignment);
    } else {
      history.push(assignment);
    }
  }

  return { active, history, settled };
}

/**
 * Assigned Threads a shell left out as older settled. Those shells keep only the newest settled
 * Threads, so Workbench must read the rest before it can treat a missing Thread as deleted.
 */
export function getWorkbenchOmittedThreadIds({
  threadIds,
  shell,
}: {
  readonly threadIds: ReadonlyArray<ThreadId>;
  readonly shell:
    | (Pick<OrchestrationV2ShellSnapshot, "olderSettled"> & {
        readonly threads: ReadonlyArray<Pick<OrchestrationV2ThreadShell, "id">>;
      })
    | null;
}): ReadonlyArray<ThreadId> {
  if (shell?.olderSettled === undefined) return [];
  const shellThreadIds = new Set(shell.threads.map((thread) => thread.id));
  return [...new Set(threadIds)].filter((threadId) => !shellThreadIds.has(threadId)).toSorted();
}

/**
 * Ready once every omitted Thread has been read and its row merged back in. A cached read settles
 * before its rows merge; a Thread its read lacks, or that was removed after it, is gone.
 */
export function getWorkbenchOmittedThreadsStatus({
  threadIds,
  reads,
  mergedThreadIds,
  removedAt,
}: {
  readonly threadIds: ReadonlyArray<ThreadId>;
  /** Each Thread's settled family read, or "failed"; absent while it is pending. */
  readonly reads: ReadonlyMap<
    ThreadId,
    | "failed"
    | (Pick<OrchestrationV2ThreadFamily, "snapshotSequence"> & {
        readonly threads: ReadonlyArray<Pick<OrchestrationV2ThreadShell, "id">>;
      })
  >;
  readonly mergedThreadIds: ReadonlySet<ThreadId>;
  readonly removedAt: ReadonlyMap<ThreadId, number>;
}): "ready" | "pending" | "failed" {
  if (threadIds.some((threadId) => reads.get(threadId) === "failed")) return "failed";
  const ready = threadIds.every((threadId) => {
    const read = reads.get(threadId);
    if (read === undefined || read === "failed") return false;
    return (
      mergedThreadIds.has(threadId) ||
      !read.threads.some((thread) => thread.id === threadId) ||
      (removedAt.get(threadId) ?? -1) > read.snapshotSequence
    );
  });
  return ready ? "ready" : "pending";
}

/** Hides Assignments whose Thread is known to be gone; one that cannot be checked stays. */
export function getVisibleWorkbenchAssignments(
  assignments: ReadonlyArray<WorkbenchAssignment>,
  liveThreadIds: ReadonlySet<ThreadId>,
  archivedThreadIds: ReadonlySet<ThreadId>,
  threadLookupReady: boolean,
  remoteEnvironmentStates: ReadonlyMap<EnvironmentId, WorkbenchThreadLookupState> = new Map(),
): ReadonlyArray<WorkbenchAssignment> {
  return assignments.filter(
    (assignment) =>
      getWorkbenchThreadLookupState({ assignment, threadLookupReady, remoteEnvironmentStates }) !==
        "ready" ||
      liveThreadIds.has(assignment.threadId) ||
      archivedThreadIds.has(assignment.threadId),
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

/** Start replaces an assigned Thread only once its own environment confirms it is gone. */
export function resolveWorkbenchTicketThreadTarget(
  assignment: Pick<WorkbenchAssignment, "threadId"> | undefined,
  existingThreadIds: ReadonlySet<ThreadId>,
  threadLookupState: WorkbenchThreadLookupState = "ready",
) {
  if (assignment && existingThreadIds.has(assignment.threadId)) {
    return { state: "open", threadId: assignment.threadId } as const;
  }
  if (assignment && threadLookupState !== "ready") {
    return { state: "thread-status-unavailable" } as const;
  }
  return { state: "start" } as const;
}

export function isWorkbenchThreadArchived(
  threadId: ThreadId,
  liveThreads: ReadonlyMap<ThreadId, unknown>,
  archivedThreads: ReadonlyMap<ThreadId, unknown>,
): boolean {
  return !liveThreads.has(threadId) && archivedThreads.has(threadId);
}
