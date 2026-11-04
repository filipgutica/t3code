import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { resolveThreadWorkingStartedAt } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, WorkbenchAssignment, WorkbenchTicketId } from "@t3tools/contracts";
import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
} from "../components/Sidebar.logic";
import { resolveWorkbenchThreadExecutionStatusPresentation } from "./WorkbenchThreadExecutionStatus.logic";

type ExecutionThread = Pick<
  EnvironmentThreadShell,
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingGuestMessageCount"
  | "runtime"
  | "latestRun"
  | "goal"
>;

/** Native execution state stays independent of Workbench planning and notifications. */
export function getWorkbenchThreadExecutionStatus(thread: ExecutionThread) {
  const kind = resolveSidebarThreadStatus(thread);
  if (kind === "ready") return null;
  const presentation = resolveWorkbenchThreadExecutionStatusPresentation({
    kind,
    goalActive: thread.goal?.status === "active",
  });
  return {
    kind,
    presentation,
    startedAt: kind === "working" ? resolveThreadWorkingStartedAt(thread) : null,
  };
}

export type WorkbenchThreadExecutionStatus = NonNullable<
  ReturnType<typeof getWorkbenchThreadExecutionStatus>
>;

/**
 * A finished reply the user has not opened, by the native sidebar's rule. `localVisits` is the
 * UI store's visit watermarks, which lead the server's until it records the visit.
 */
export function hasWorkbenchUnreadReply(
  thread: EnvironmentThreadShell,
  localVisits: Readonly<Record<string, string>>,
) {
  const localLastVisitedAt =
    localVisits[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))];
  return hasUnseenCompletion({
    ...thread,
    lastVisitedAt: resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt),
  });
}

// A Ticket can own concurrent Threads. Like a closed native sidebar folder
// (`resolveSidebarFolderDot`), states that need the user come before progress, an unread
// reply comes before work in progress, and Waiting stays quiet. Rows show each Thread's state.
const TICKET_THREAD_RANK = {
  approval: 7,
  input: 6,
  request: 5,
  limited: 4,
  failed: 3,
  working: 1,
  waiting: 0,
} satisfies Record<WorkbenchThreadExecutionStatus["kind"], number>;
const UNREAD_REPLY_RANK = 2;
const IDLE_RANK = -1;

type AssignedExecutionThread = ExecutionThread &
  Pick<EnvironmentThreadShell, "id" | "environmentId" | "archivedAt">;

export type WorkbenchTicketThreadStatus = {
  readonly threadId: EnvironmentThreadShell["id"];
  readonly status: WorkbenchThreadExecutionStatus | null;
};

function executionOrder(status: WorkbenchThreadExecutionStatus | null) {
  return status?.startedAt == null ? Number.POSITIVE_INFINITY : Date.parse(status.startedAt);
}

/**
 * Most urgent first, then the oldest work, then a stable id order. A reply counts as unread
 * only on a Thread with no live state, as native rows show Done only for ready Threads.
 */
export function sortWorkbenchTicketThreads<Entry extends WorkbenchTicketThreadStatus>(
  entries: ReadonlyArray<Entry>,
  unreadThreadIds: ReadonlySet<EnvironmentThreadShell["id"]> = new Set(),
): ReadonlyArray<Entry> {
  const rank = ({ threadId, status }: Entry) =>
    status
      ? TICKET_THREAD_RANK[status.kind]
      : unreadThreadIds.has(threadId)
        ? UNREAD_REPLY_RANK
        : IDLE_RANK;
  return entries.toSorted(
    (left, right) =>
      rank(right) - rank(left) ||
      executionOrder(left.status) - executionOrder(right.status) ||
      (left.threadId < right.threadId ? -1 : left.threadId > right.threadId ? 1 : 0),
  );
}

/** Every live, current Thread on each Ticket in the owning environment, most urgent first. */
export function getWorkbenchTicketThreadStatuses({
  environmentId,
  assignments,
  threadsById,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly assignments: ReadonlyArray<
    Pick<WorkbenchAssignment, "ticketId" | "threadId" | "supersededAt">
  >;
  readonly threadsById: ReadonlyMap<EnvironmentThreadShell["id"], AssignedExecutionThread>;
}): ReadonlyMap<WorkbenchTicketId, ReadonlyArray<WorkbenchTicketThreadStatus>> {
  const byTicket = new Map<
    WorkbenchTicketId,
    Map<EnvironmentThreadShell["id"], WorkbenchTicketThreadStatus>
  >();
  if (environmentId === null) return new Map();
  for (const assignment of assignments) {
    if (assignment.supersededAt !== null) continue;
    const thread = threadsById.get(assignment.threadId);
    if (!thread || thread.environmentId !== environmentId || thread.archivedAt !== null) continue;
    const threads = byTicket.get(assignment.ticketId) ?? new Map();
    threads.set(thread.id, {
      threadId: thread.id,
      status: getWorkbenchThreadExecutionStatus(thread),
    });
    byTicket.set(assignment.ticketId, threads);
  }
  return new Map(
    [...byTicket].map(([ticketId, threads]) => [
      ticketId,
      sortWorkbenchTicketThreads([...threads.values()]),
    ]),
  );
}

/** The single live state a Ticket shows; Waiting alone shows nothing. */
export function getWorkbenchTicketExecutionStatuses(
  input: Parameters<typeof getWorkbenchTicketThreadStatuses>[0],
): ReadonlyMap<
  WorkbenchTicketId,
  WorkbenchThreadExecutionStatus & { readonly threadId: EnvironmentThreadShell["id"] }
> {
  const selected = new Map<
    WorkbenchTicketId,
    WorkbenchThreadExecutionStatus & { readonly threadId: EnvironmentThreadShell["id"] }
  >();
  for (const [ticketId, [first]] of getWorkbenchTicketThreadStatuses(input)) {
    if (first?.status && TICKET_THREAD_RANK[first.status.kind] > 0) {
      selected.set(ticketId, { ...first.status, threadId: first.threadId });
    }
  }
  return selected;
}
