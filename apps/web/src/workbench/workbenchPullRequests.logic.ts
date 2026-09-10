import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  PullRequestListEntry,
  ThreadId,
  ThreadLinkedPullRequest,
  WorkbenchAssignment,
} from "@t3tools/contracts";
import {
  legacyThreadPullRequestKey,
  threadPullRequestKeyOf,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";

export type WorkbenchPullRequestThread = Pick<
  EnvironmentThreadShell,
  "id" | "projectId" | "title" | "pullRequests" | "linkedPullRequest" | "branchPullRequest"
>;

export interface WorkbenchTicketPullRequest {
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly pullRequest: ThreadLinkedPullRequest;
}

export type TicketPullRequestReference = ThreadLinkedPullRequest &
  Partial<Pick<PullRequestListEntry, "title" | "state">>;

interface TicketPullRequestRow {
  readonly pullRequest: TicketPullRequestReference;
  readonly threadTitle: string | null;
  readonly matchesTicket: boolean;
}

/** Search can add PRs from another branch and supply fresh titles/states for Thread references. */
export const mergeWorkbenchTicketPullRequests = ({
  threadPullRequests,
  matches,
  checkoutPullRequests = [],
}: {
  readonly threadPullRequests: ReadonlyArray<WorkbenchTicketPullRequest>;
  readonly matches: ReadonlyArray<TicketPullRequestReference>;
  readonly checkoutPullRequests?: ReadonlyArray<TicketPullRequestReference>;
}): ReadonlyArray<TicketPullRequestRow> => {
  const rows = new Map<string, TicketPullRequestRow>();
  const identity = (reference: TicketPullRequestReference) =>
    reference.url.toLowerCase().replace(/\/$/, "");
  for (const { pullRequest, threadTitle } of threadPullRequests) {
    rows.set(identity(pullRequest), { pullRequest, threadTitle, matchesTicket: false });
  }
  for (const pullRequest of checkoutPullRequests) {
    const key = identity(pullRequest);
    rows.set(key, {
      pullRequest,
      threadTitle: rows.get(key)?.threadTitle ?? null,
      matchesTicket: false,
    });
  }
  for (const pullRequest of matches) {
    const key = identity(pullRequest);
    rows.set(key, {
      pullRequest,
      threadTitle: rows.get(key)?.threadTitle ?? null,
      matchesTicket: true,
    });
  }
  return [...rows.values()];
};

/** Collect the distinct PR references carried by the Ticket's visible Threads. */
export function getWorkbenchTicketPullRequests({
  assignments,
  threadsById,
  archivedThreadsById,
}: {
  readonly assignments: ReadonlyArray<Pick<WorkbenchAssignment, "threadId">>;
  readonly threadsById: ReadonlyMap<ThreadId, WorkbenchPullRequestThread>;
  readonly archivedThreadsById: ReadonlyMap<ThreadId, WorkbenchPullRequestThread>;
}): ReadonlyArray<WorkbenchTicketPullRequest> {
  const seen = new Set<string>();
  const pullRequests: WorkbenchTicketPullRequest[] = [];
  for (const assignment of assignments) {
    const thread =
      threadsById.get(assignment.threadId) ?? archivedThreadsById.get(assignment.threadId);
    if (thread === undefined) continue;
    const references =
      thread.pullRequests.length > 0
        ? visibleThreadPullRequests(thread.pullRequests).map(({ repository, number, url }) => ({
            projectId: thread.projectId,
            repository,
            number,
            url,
          }))
        : [thread.linkedPullRequest, thread.branchPullRequest];
    for (const pullRequest of references) {
      if (pullRequest == null) continue;
      const identity = threadPullRequestKeyOf(legacyThreadPullRequestKey(pullRequest));
      if (seen.has(identity)) continue;
      seen.add(identity);
      pullRequests.push({
        threadId: thread.id,
        threadTitle: thread.title,
        pullRequest,
      });
    }
  }
  return pullRequests;
}
