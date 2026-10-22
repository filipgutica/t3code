import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ThreadId,
  WorkbenchAssignment,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import {
  activeWorkbenchAttentionAssignments,
  compareWorkbenchAttentionSignals,
  workbenchAttentionIdentity,
  type WorkbenchAttentionSignal,
} from "./workbenchAttention.logic";
import {
  getWorkbenchTicketPullRequests,
  type WorkbenchPullRequestThread,
} from "./workbenchPullRequests.logic";
import type {
  WorkbenchSidebarTicketGroup,
  WorkbenchSidebarTicketSections,
} from "./workbenchSidebar.logic";

type AttentionSignalsByTicket = ReadonlyMap<
  WorkbenchTicketId,
  ReadonlyArray<WorkbenchAttentionSignal>
>;

/** Each actionable Thread maps to its most urgent signal, including signals from shared PRs. */
export const getWorkbenchSidebarActionableThreadIds = ({
  environmentId,
  assignments,
  threads,
  attentionSignalsByTicket,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly threads: ReadonlyArray<
    WorkbenchPullRequestThread &
      Pick<EnvironmentThreadShell, "environmentId" | "archivedAt" | "settledOverride">
  >;
  readonly attentionSignalsByTicket: AttentionSignalsByTicket;
}): ReadonlyMap<WorkbenchTicketId, ReadonlyMap<ThreadId, WorkbenchAttentionSignal>> => {
  const result = new Map<WorkbenchTicketId, Map<ThreadId, WorkbenchAttentionSignal>>();
  if (environmentId === null) return result;
  const threadsById = new Map(
    threads
      .filter((thread) => thread.environmentId === environmentId)
      .map((thread) => [thread.id, thread]),
  );
  for (const assignment of activeWorkbenchAttentionAssignments({
    assignments,
    threadsById,
    environmentId,
  })) {
    const signals = attentionSignalsByTicket.get(assignment.ticketId);
    if (!signals?.length) continue;
    const pullRequests = new Set(
      getWorkbenchTicketPullRequests({
        assignments: [assignment],
        threadsById,
        archivedThreadsById: new Map(),
        includeBranchPullRequest: false,
      }).map((row) => workbenchAttentionIdentity(environmentId, row.pullRequest)),
    );
    const [signal] = signals
      .filter((candidate) =>
        candidate.source.type === "thread"
          ? candidate.source.threadId === assignment.threadId
          : pullRequests.has(
              workbenchAttentionIdentity(environmentId, candidate.source.row.pullRequest),
            ),
      )
      .toSorted(compareWorkbenchAttentionSignals);
    if (!signal) continue;
    const ticketThreads = result.get(assignment.ticketId) ?? new Map();
    ticketThreads.set(assignment.threadId, signal);
    result.set(assignment.ticketId, ticketThreads);
  }
  return result;
};

export const prioritizeWorkbenchSidebarAttention = ({
  ticketGroupsByWorkspace,
  attentionSignalsByTicket,
  actionableThreadIdsByTicket,
  onlyActionable,
}: {
  readonly ticketGroupsByWorkspace: ReadonlyMap<WorkbenchProjectId, WorkbenchSidebarTicketSections>;
  readonly attentionSignalsByTicket: AttentionSignalsByTicket;
  readonly actionableThreadIdsByTicket: ReadonlyMap<
    WorkbenchTicketId,
    ReadonlyMap<ThreadId, WorkbenchAttentionSignal>
  >;
  readonly onlyActionable: boolean;
}): ReadonlyMap<WorkbenchProjectId, WorkbenchSidebarTicketSections> => {
  const isActionable = (group: WorkbenchSidebarTicketGroup) =>
    group.ticket.archivedAt == null &&
    (attentionSignalsByTicket.get(group.ticket.id)?.length ?? 0) > 0;
  const result = new Map<WorkbenchProjectId, WorkbenchSidebarTicketSections>();
  for (const [workspaceId, sections] of ticketGroupsByWorkspace) {
    const visibleIds = new Set(sections.active.map((group) => group.ticket.id));
    const promoted: WorkbenchSidebarTicketGroup[] = [];
    for (const group of sections.done) {
      if (!isActionable(group) || visibleIds.has(group.ticket.id)) continue;
      promoted.push(group);
      visibleIds.add(group.ticket.id);
    }
    const priorityByTicket = new Map<WorkbenchTicketId, WorkbenchAttentionSignal | undefined>();
    // Only the attention filter reorders rows; equally urgent rows retain source order.
    const active = [...sections.active, ...promoted].flatMap((group) => {
      if (!onlyActionable) return [group];
      if (!isActionable(group)) return [];
      const ids = actionableThreadIdsByTicket.get(group.ticket.id);
      const orderedSignals = (attentionSignalsByTicket.get(group.ticket.id) ?? []).toSorted(
        compareWorkbenchAttentionSignals,
      );
      priorityByTicket.set(group.ticket.id, orderedSignals[0]);
      return [
        {
          ...group,
          threads: group.threads
            .filter((thread) => ids?.has(thread.id))
            .toSorted((left, right) =>
              compareWorkbenchAttentionSignals(ids?.get(left.id), ids?.get(right.id)),
            ),
        },
      ];
    });
    if (onlyActionable)
      active.sort((left, right) =>
        compareWorkbenchAttentionSignals(
          priorityByTicket.get(left.ticket.id),
          priorityByTicket.get(right.ticket.id),
        ),
      );
    result.set(workspaceId, {
      active,
      done: onlyActionable ? [] : sections.done.filter((group) => !isActionable(group)),
    });
  }
  return result;
};
