import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { resolveThreadWorkingStartedAt } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, WorkbenchAssignment, WorkbenchTicketId } from "@t3tools/contracts";
import { resolveSidebarThreadStatus } from "../components/Sidebar.logic";
import { resolveThreadExecutionStatusPresentation } from "../components/ThreadExecutionStatus.logic";

type ExecutionThread = Pick<
  EnvironmentThreadShell,
  "hasPendingApprovals" | "hasPendingUserInput" | "runtime" | "latestRun" | "goal"
>;

/** Native execution state stays independent of Workbench planning and notifications. */
export function getWorkbenchThreadExecutionStatus(thread: ExecutionThread) {
  const kind = resolveSidebarThreadStatus(thread);
  if (kind === "ready") return null;
  const presentation = resolveThreadExecutionStatusPresentation({
    kind,
    goalActive: thread.goal?.status === "active",
  });
  if (presentation === null) return null;
  return {
    kind,
    presentation,
    startedAt: kind === "working" ? resolveThreadWorkingStartedAt(thread) : null,
  };
}

export type WorkbenchThreadExecutionStatus = NonNullable<
  ReturnType<typeof getWorkbenchThreadExecutionStatus>
>;

// A Ticket can own concurrent Threads. Surface actionable states before progress;
// the individual rows still show every Thread's own state.
const TICKET_EXECUTION_PRIORITY = {
  approval: 6,
  input: 5,
  failed: 4,
  limited: 3,
  working: 2,
  waiting: 1,
} satisfies Record<WorkbenchThreadExecutionStatus["kind"], number>;

type AssignedExecutionThread = ExecutionThread &
  Pick<EnvironmentThreadShell, "id" | "environmentId" | "archivedAt">;

function executionOrder(status: WorkbenchThreadExecutionStatus) {
  return status.startedAt === null ? Number.POSITIVE_INFINITY : Date.parse(status.startedAt);
}

type SelectedExecution = {
  readonly threadId: EnvironmentThreadShell["id"];
  readonly status: WorkbenchThreadExecutionStatus;
};

function shouldReplaceExecution(previous: SelectedExecution | undefined, next: SelectedExecution) {
  if (previous === undefined) return true;
  const priority = TICKET_EXECUTION_PRIORITY[next.status.kind];
  const previousPriority = TICKET_EXECUTION_PRIORITY[previous.status.kind];
  if (priority !== previousPriority) return priority > previousPriority;
  const startedAt = executionOrder(next.status);
  const previousStartedAt = executionOrder(previous.status);
  if (startedAt !== previousStartedAt) return startedAt < previousStartedAt;
  return next.threadId < previous.threadId;
}

/** Summarize only live, current assignments in the owning environment. */
export function getWorkbenchTicketExecutionStatuses({
  environmentId,
  assignments,
  threadsById,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly assignments: ReadonlyArray<
    Pick<WorkbenchAssignment, "ticketId" | "threadId" | "supersededAt">
  >;
  readonly threadsById: ReadonlyMap<EnvironmentThreadShell["id"], AssignedExecutionThread>;
}): ReadonlyMap<WorkbenchTicketId, WorkbenchThreadExecutionStatus> {
  const selected = new Map<WorkbenchTicketId, SelectedExecution>();
  if (environmentId === null) return new Map();
  for (const assignment of assignments) {
    if (assignment.supersededAt !== null) continue;
    const thread = threadsById.get(assignment.threadId);
    if (!thread || thread.environmentId !== environmentId || thread.archivedAt !== null) continue;
    const status = getWorkbenchThreadExecutionStatus(thread);
    if (status === null) continue;
    const next = { threadId: thread.id, status };
    if (shouldReplaceExecution(selected.get(assignment.ticketId), next)) {
      selected.set(assignment.ticketId, next);
    }
  }
  return new Map([...selected].map(([ticketId, { status }]) => [ticketId, status]));
}
