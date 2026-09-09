import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ThreadId, ThreadLinkedPullRequest, WorkbenchAssignment } from "@t3tools/contracts";

export type WorkbenchPullRequestThread = Pick<
  EnvironmentThreadShell,
  "id" | "title" | "linkedPullRequest" | "branchPullRequest"
>;

export interface WorkbenchTicketPullRequest {
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly pullRequest: ThreadLinkedPullRequest;
}

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
    for (const pullRequest of [thread.linkedPullRequest, thread.branchPullRequest]) {
      if (pullRequest == null) continue;
      const identity = `${pullRequest.projectId}:${pullRequest.repository.toLowerCase()}:${pullRequest.number}`;
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
