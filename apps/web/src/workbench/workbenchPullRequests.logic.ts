import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  PullRequestListEntry,
  ProjectId,
  WorkbenchTicketWorkspace,
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
  readonly pullRequest: TicketPullRequestReference;
}

export type TicketPullRequestReference = ThreadLinkedPullRequest &
  Partial<Pick<PullRequestListEntry, "title" | "state">> & {
    readonly isDraft?: boolean | undefined;
  };

interface TicketPullRequestRow {
  readonly pullRequest: TicketPullRequestReference;
  readonly threadId: ThreadId | null;
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
  for (const { pullRequest, threadId, threadTitle } of threadPullRequests) {
    rows.set(identity(pullRequest), { pullRequest, threadId, threadTitle, matchesTicket: false });
  }
  for (const pullRequest of checkoutPullRequests) {
    const key = identity(pullRequest);
    rows.set(key, {
      pullRequest,
      threadId: rows.get(key)?.threadId ?? null,
      threadTitle: rows.get(key)?.threadTitle ?? null,
      matchesTicket: false,
    });
  }
  for (const pullRequest of matches) {
    const key = identity(pullRequest);
    rows.set(key, {
      pullRequest,
      threadId: rows.get(key)?.threadId ?? null,
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
        ? visibleThreadPullRequests(thread.pullRequests).map(
            ({ repository, number, url, snapshot }) => ({
              projectId: thread.projectId,
              repository,
              number,
              url,
              ...(snapshot
                ? { title: snapshot.title, state: snapshot.state, isDraft: snapshot.isDraft }
                : {}),
            }),
          )
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

/** Shared repository roots are navigation targets, not evidence of a Ticket's PR ownership. */
export const getWorkbenchTicketPullRequestCheckouts = ({
  workspace,
  repositories,
}: {
  readonly workspace: WorkbenchTicketWorkspace | undefined;
  readonly repositories: ReadonlyArray<{ readonly projectId: ProjectId; readonly title: string }>;
}) => {
  if (workspace?.status !== "ready") return [];
  return repositories.flatMap(({ projectId, title }) => {
    const prepared = workspace.repositories.find(
      (repository) => repository.projectId === projectId && repository.status === "ready",
    );
    return prepared ? [{ projectId, title, cwd: prepared.worktreePath }] : [];
  });
};
