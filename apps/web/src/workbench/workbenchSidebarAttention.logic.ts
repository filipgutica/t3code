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
}): ReadonlyMap<WorkbenchTicketId, ReadonlySet<ThreadId>> => {
  const result = new Map<WorkbenchTicketId, Set<ThreadId>>();
  if (environmentId === null) return result;
  const threadsById = new Map(
    threads
      .filter((thread) => thread.environmentId === environmentId)
      .map((thread) => [thread.id, thread]),
  );
  const sourcesByTicket = new Map(
    [...attentionSignalsByTicket].map(([ticketId, signals]) => [
      ticketId,
      {
        threadIds: new Set(
          signals.flatMap((signal) =>
            signal.source.type === "thread" ? [signal.source.threadId] : [],
          ),
        ),
        pullRequests: new Set(
          signals.flatMap((signal) =>
            signal.source.type === "pull-request"
              ? [workbenchAttentionIdentity(environmentId, signal.source.row.pullRequest)]
              : [],
          ),
        ),
      },
    ]),
  );
  for (const assignment of activeWorkbenchAttentionAssignments({
    assignments,
    threadsById,
    environmentId,
  })) {
    const sources = sourcesByTicket.get(assignment.ticketId);
    if (!sources) continue;
    const references = getWorkbenchTicketPullRequests({
      assignments: [assignment],
      threadsById,
      archivedThreadsById: new Map(),
      includeBranchPullRequest: false,
    });
    if (
      !sources.threadIds.has(assignment.threadId) &&
      !references.some((row) =>
        sources.pullRequests.has(workbenchAttentionIdentity(environmentId, row.pullRequest)),
      )
    )
      continue;
    const ids = result.get(assignment.ticketId) ?? new Set<ThreadId>();
    ids.add(assignment.threadId);
    result.set(assignment.ticketId, ids);
  }
  return result;
};

const attentionFirst = <T>(items: ReadonlyArray<T>, matches: (item: T) => boolean) => {
  const attention: T[] = [];
  const rest: T[] = [];
  for (const item of items) (matches(item) ? attention : rest).push(item);
  return [...attention, ...rest];
};

export const prioritizeWorkbenchSidebarAttention = ({
  ticketGroupsByWorkspace,
  attentionSignalsByTicket,
  actionableThreadIdsByTicket,
  onlyActionable,
}: {
  readonly ticketGroupsByWorkspace: ReadonlyMap<WorkbenchProjectId, WorkbenchSidebarTicketSections>;
  readonly attentionSignalsByTicket: AttentionSignalsByTicket;
  readonly actionableThreadIdsByTicket: ReadonlyMap<WorkbenchTicketId, ReadonlySet<ThreadId>>;
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
    const active = attentionFirst([...sections.active, ...promoted], isActionable).flatMap(
      (group) => {
        if (onlyActionable && !isActionable(group)) return [];
        const ids = actionableThreadIdsByTicket.get(group.ticket.id);
        const threads = attentionFirst(group.threads, (thread) => ids?.has(thread.id) ?? false);
        return [
          {
            ...group,
            threads: onlyActionable ? threads.filter((thread) => ids?.has(thread.id)) : threads,
          },
        ];
      },
    );
    result.set(workspaceId, {
      active,
      done: onlyActionable ? [] : sections.done.filter((group) => !isActionable(group)),
    });
  }
  return result;
};
