import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  PullRequestListEntry,
  ProjectId,
  WorkbenchReference,
  WorkbenchTicketWorkspace,
  ThreadId,
  ThreadLinkedPullRequest,
  WorkbenchAssignment,
} from "@t3tools/contracts";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import {
  legacyThreadPullRequestKey,
  threadPullRequestKeyOf,
  visibleThreadPullRequests,
} from "@t3tools/client-runtime/thread-pull-requests";

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
  Partial<Pick<PullRequestListEntry, "title" | "state" | "checksState" | "reviewDecision">> & {
    readonly isDraft?: boolean | undefined;
  };

/** A Reference-only row has no native Project, so it shows no looked-up status. */
type TicketPullRequestRowReference = Omit<TicketPullRequestReference, "projectId"> & {
  readonly projectId?: ProjectId;
};

interface TicketPullRequestRow {
  readonly pullRequest: TicketPullRequestRowReference;
  readonly threadId: ThreadId | null;
  readonly threadTitle: string | null;
  /** The `github_pull_request` Reference that also lists this PR; Unlink removes only it. */
  readonly reference: WorkbenchReference | null;
}

// One PR can arrive as `/pull/12`, `/pull/12/files`, or with different repository casing.
const pullRequestIdentity = (url: string) => {
  const link = sourceControlClients.parseChangeRequestUrl(url)?.link;
  return link
    ? `${link.host}/${link.repository}#${link.number}`.toLowerCase()
    : url.toLowerCase().replace(/\/$/, "");
};

/** Thread links, prepared checkouts, and PR References, one row per PR. */
export const mergeWorkbenchTicketPullRequests = ({
  threadPullRequests,
  checkoutPullRequests = [],
  references = [],
}: {
  readonly threadPullRequests: ReadonlyArray<WorkbenchTicketPullRequest>;
  readonly checkoutPullRequests?: ReadonlyArray<TicketPullRequestReference>;
  /** `github_pull_request` References, in list order. */
  readonly references?: ReadonlyArray<WorkbenchReference>;
}): ReadonlyArray<TicketPullRequestRow> => {
  const rows = new Map<string, TicketPullRequestRow>();
  for (const { pullRequest, threadId, threadTitle } of threadPullRequests) {
    rows.set(pullRequestIdentity(pullRequest.url), {
      pullRequest,
      threadId,
      threadTitle,
      reference: null,
    });
  }
  // Checkout status is fresher than a Thread's stored snapshot.
  for (const pullRequest of checkoutPullRequests) {
    const key = pullRequestIdentity(pullRequest.url);
    const existing = rows.get(key);
    rows.set(key, {
      pullRequest,
      threadId: existing?.threadId ?? null,
      threadTitle: existing?.threadTitle ?? null,
      reference: null,
    });
  }
  for (const reference of references) {
    const link = sourceControlClients.parseChangeRequestUrl(reference.url)?.link;
    if (!link) continue;
    const key = pullRequestIdentity(reference.url);
    const existing = rows.get(key);
    rows.set(
      key,
      existing
        ? { ...existing, reference }
        : {
            pullRequest: {
              repository: link.repository,
              number: link.number,
              url: reference.url,
              ...(reference.title === null ? {} : { title: reference.title }),
            },
            threadId: null,
            threadTitle: null,
            reference,
          },
    );
  }
  return [...rows.values()];
};

const getThreadPullRequestReferences = (
  thread: WorkbenchPullRequestThread,
  includeBranchPullRequest: boolean,
) => {
  return thread.pullRequests.length > 0
    ? visibleThreadPullRequests(thread.pullRequests).map(
        ({ repository, number, url, snapshot }) => ({
          projectId: thread.projectId,
          repository,
          number,
          url,
          ...(snapshot
            ? {
                title: snapshot.title,
                state: snapshot.state,
                isDraft: snapshot.isDraft,
                checksState: snapshot.checksState,
                reviewDecision: snapshot.reviewDecision,
              }
            : {}),
        }),
      )
    : [thread.linkedPullRequest, ...(includeBranchPullRequest ? [thread.branchPullRequest] : [])];
};

/** Collect the distinct PR references carried by the Ticket's visible Threads. */
export function getWorkbenchTicketPullRequests({
  assignments,
  threadsById,
  archivedThreadsById,
  includeBranchPullRequest = true,
}: {
  readonly includeBranchPullRequest?: boolean;
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
    const references = getThreadPullRequestReferences(thread, includeBranchPullRequest);
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
