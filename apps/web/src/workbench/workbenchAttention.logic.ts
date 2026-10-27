import type {
  EnvironmentId,
  PullRequestActivity,
  PullRequestSummary,
  PullRequestReviewThread,
  ThreadId,
  WorkbenchAssignment,
} from "@t3tools/contracts";
import type {
  ThreadPendingApproval,
  ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  legacyThreadPullRequestKey,
  threadPullRequestKeyOf,
} from "@t3tools/client-runtime/thread-pull-requests";
import type {
  TicketPullRequestReference,
  WorkbenchTicketPullRequest,
} from "./workbenchPullRequests.logic";

export type WorkbenchAttentionMode = "all" | "attention" | "replies";
export type WorkbenchAttentionReasonKind =
  | "approval"
  | "input"
  | "failed"
  | "checks"
  | "feedback"
  | "plan"
  | "done"
  | "approved";
export type WorkbenchPullRequestAttentionKind =
  | "failed-checks"
  | "changes-requested"
  | "unresolved-feedback"
  | "approved";
const pullRequestReasonLabels = {
  "failed-checks": "Failed PR checks",
  "changes-requested": "PR changes requested",
  "unresolved-feedback": "Unresolved PR feedback",
  approved: "PR approved",
} as const;
export type WorkbenchInspectionStatus = "loading" | "unavailable" | "incomplete" | "complete";
type WorkbenchThreadWaitingCause = "approval" | "plan" | "failed";
type WorkbenchThreadNotification =
  | { readonly kind: "waiting"; readonly cause: WorkbenchThreadWaitingCause }
  | { readonly kind: "question" | "reply" };
export type WorkbenchAttentionSignal =
  | (WorkbenchThreadNotification & {
      readonly source: {
        readonly type: "thread";
        readonly threadId: ThreadId;
        readonly threadTitle: string;
      };
    })
  | {
      readonly kind: WorkbenchPullRequestAttentionKind;
      readonly source: { readonly type: "pull-request"; readonly row: WorkbenchTicketPullRequest };
      readonly unresolvedReviewThreads: ReadonlyArray<PullRequestReviewThread>;
    };

/** Groups keep the source's related actions together. */
export const groupWorkbenchAttentionSignals = (
  signals: ReadonlyArray<WorkbenchAttentionSignal>,
) => {
  const groups = new Map<string, WorkbenchAttentionSignal[]>();
  for (const signal of signals.toSorted(compareWorkbenchAttentionSignals)) {
    const key =
      signal.source.type === "thread"
        ? `thread:${signal.source.threadId}`
        : signal.source.row.pullRequest.url;
    const group = groups.get(key) ?? [];
    group.push(signal);
    groups.set(key, group);
  }
  return [...groups].map(([key, group]) => ({ key, signals: group }));
};

export const getWorkbenchAttentionReasonKind = (
  signal: WorkbenchAttentionSignal,
): WorkbenchAttentionReasonKind => {
  if (signal.kind === "waiting") return signal.cause;
  return (
    {
      question: "input",
      "failed-checks": "checks",
      "changes-requested": "feedback",
      "unresolved-feedback": "feedback",
      reply: "done",
      approved: "approved",
    } as const
  )[signal.kind];
};

const reasonPriority = {
  approval: 0,
  input: 0,
  failed: 1,
  checks: 2,
  feedback: 3,
  plan: 4,
  done: 5,
  approved: 6,
};

/** Approval wins input ties; other equal priorities preserve source order. Missing signals sort last. */
export const compareWorkbenchAttentionSignals = (
  left: WorkbenchAttentionSignal | undefined,
  right: WorkbenchAttentionSignal | undefined,
) => {
  if (!left) return right ? 1 : 0;
  if (!right) return -1;
  const leftKind = getWorkbenchAttentionReasonKind(left);
  const rightKind = getWorkbenchAttentionReasonKind(right);
  return (
    reasonPriority[leftKind] - reasonPriority[rightKind] ||
    Number(rightKind === "approval") - Number(leftKind === "approval")
  );
};

const reasonLabels = {
  approval: "Approval",
  input: "Input",
  failed: "Failed",
  checks: "Checks failed",
  feedback: "Feedback",
  plan: "Plan ready",
  done: "Done",
  approved: "Approved",
} as const;

export const getWorkbenchAttentionReasonLabel = (kind: WorkbenchAttentionReasonKind) =>
  reasonLabels[kind];

const waitingLabels = {
  approval: "Approval needed",
  plan: "Plan ready for review",
  failed: "Agent run failed",
} as const;
const signalLabels = {
  question: "Input needed",
  reply: "Agent replied",
  "failed-checks": "Checks failed",
  "changes-requested": "Changes requested",
  approved: "Approved",
} as const;

export const getWorkbenchAttentionSignalLabel = (signal: WorkbenchAttentionSignal) => {
  if (signal.kind === "waiting") return waitingLabels[signal.cause];
  if (signal.kind === "unresolved-feedback") {
    const count = signal.unresolvedReviewThreads.length;
    return `${count} unresolved ${count === 1 ? "thread" : "threads"}`;
  }
  return signalLabels[signal.kind];
};

export const getWorkbenchAttentionSourceParts = (source: WorkbenchAttentionSignal["source"]) => {
  if (source.type === "thread")
    return { prefix: "Thread", title: source.threadTitle, repository: null };
  const reference = source.row.pullRequest;
  const title = reference.title === reference.repository ? undefined : reference.title;
  return { prefix: `PR #${reference.number}`, title, repository: reference.repository };
};

export const getWorkbenchAttentionSourceLabel = (source: WorkbenchAttentionSignal["source"]) => {
  const { prefix, title, repository } = getWorkbenchAttentionSourceParts(source);
  if (source.type === "thread") return `${prefix} · ${title}`;
  return [prefix, title, repository].filter(Boolean).join(" · ");
};
export interface WorkbenchAttentionInspection {
  readonly row: WorkbenchTicketPullRequest;
  readonly status: WorkbenchInspectionStatus;
  readonly displayStatus: WorkbenchInspectionStatus;
  readonly inspected: boolean;
}
export interface WorkbenchPullRequestAttention {
  readonly pullRequestTitle?: string | undefined;
  readonly reasons: ReadonlyArray<string>;
  readonly signalKinds: ReadonlyArray<WorkbenchPullRequestAttentionKind>;
  readonly unresolvedReviewThreads: ReadonlyArray<PullRequestReviewThread>;
  /** Discussions that no longer need you: resolved, or your reply is the latest comment. */
  readonly resolvedReviewThreadIds: ReadonlyArray<string>;
  readonly activityComplete: boolean;
  readonly checksKnown: boolean;
  readonly reviewDecisionKnown: boolean;
  readonly inspectionStatus: WorkbenchInspectionStatus;
  readonly displayInspectionStatus: WorkbenchInspectionStatus;
  readonly inspected: boolean;
  readonly terminal: boolean;
}

export const workbenchAttentionIdentity = (
  environmentId: EnvironmentId,
  reference: TicketPullRequestReference,
) => JSON.stringify([environmentId, threadPullRequestKeyOf(legacyThreadPullRequestKey(reference))]);

export const activeWorkbenchAttentionAssignments = ({
  assignments,
  threadsById,
  environmentId,
}: {
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly threadsById: ReadonlyMap<
    WorkbenchAssignment["threadId"],
    Pick<EnvironmentThreadShell, "environmentId" | "archivedAt" | "settledOverride">
  >;
  readonly environmentId: EnvironmentId | null;
}) =>
  assignments.filter((assignment) => {
    const thread = threadsById.get(assignment.threadId);
    return (
      assignment.supersededAt === null &&
      thread !== undefined &&
      thread.environmentId === environmentId &&
      thread.archivedAt === null &&
      thread.settledOverride !== "settled"
    );
  });

/** Native activity reports resolution, including outdated discussions; unread is unrelated. */
type AttentionInput = {
  readonly reference: TicketPullRequestReference;
  readonly summary:
    | (Pick<PullRequestSummary, "state" | "checksState" | "reviewDecision"> &
        Partial<Pick<PullRequestSummary, "title" | "mergeability" | "isDraft">>)
    | null;
  readonly activity: Pick<
    PullRequestActivity,
    "reviewThreads" | "commentsTruncated" | "reviewThreadsTruncated"
  > | null;
  /** The signed-in host login; unknown keeps every unresolved discussion. */
  readonly viewer?: string | undefined;
  readonly loading: boolean;
  readonly error: boolean;
};
const isTerminalPullRequest = ({
  reference,
  summary,
  loading,
}: Pick<AttentionInput, "reference" | "summary" | "loading">) =>
  reference.state === "merged" ||
  reference.state === "closed" ||
  summary?.state === "merged" ||
  (summary?.state === "closed" && !loading);
const hasUnknownCoverage = ({ summary, activity }: Pick<AttentionInput, "summary" | "activity">) =>
  summary === null ||
  summary.checksState === undefined ||
  summary.reviewDecision === undefined ||
  activity === null ||
  activity.commentsTruncated ||
  activity.reviewThreadsTruncated === true;
const coverageReason = ({
  loading,
  error,
  unknown,
}: {
  loading: boolean;
  error: boolean;
  unknown: boolean;
}) =>
  loading
    ? "PR attention loading"
    : error
      ? "PR attention unavailable"
      : unknown
        ? "PR attention unknown"
        : null;

const pullRequestSummarySignals = ({
  reference,
  summary,
}: Pick<AttentionInput, "reference" | "summary">) => {
  const signals: WorkbenchPullRequestAttentionKind[] = [];
  if (
    (summary?.checksState === undefined ? reference.checksState : summary.checksState) === "failing"
  )
    signals.push("failed-checks");
  if (
    (summary?.reviewDecision === undefined ? reference.reviewDecision : summary.reviewDecision) ===
    "changes-requested"
  )
    signals.push("changes-requested");
  // Only what the summary reports: GitHub can still block the merge on rules it does not expose.
  if (
    summary?.reviewDecision === "approved" &&
    summary.checksState !== undefined &&
    summary.checksState !== "failing" &&
    summary.checksState !== "pending" &&
    summary.mergeability === "mergeable" &&
    summary.isDraft !== true
  )
    signals.push("approved");
  return signals;
};

const pullRequestInspection = ({
  summary,
  activity,
  loading,
  error,
}: Pick<AttentionInput, "summary" | "activity" | "loading" | "error">) => {
  const unknown = hasUnknownCoverage({ summary, activity });
  const inspectionStatus: WorkbenchInspectionStatus = loading
    ? "loading"
    : error
      ? "unavailable"
      : unknown
        ? "incomplete"
        : "complete";
  return {
    statusReason: coverageReason({ loading, error, unknown }),
    activityComplete:
      !loading &&
      !error &&
      activity !== null &&
      !activity.commentsTruncated &&
      !activity.reviewThreadsTruncated,
    checksKnown: !loading && summary !== null && summary.checksState !== undefined,
    reviewDecisionKnown: !loading && summary !== null && summary.reviewDecision !== undefined,
    inspectionStatus,
    inspected: !error && !loading && !unknown,
    terminal: !loading && (error || (summary !== null && activity !== null)),
  };
};

/** The last commenter is only known when the host returned every comment in the discussion. */
const lastReviewCommentAuthor = (thread: PullRequestReviewThread) => {
  const commentCount = thread.commentCount ?? thread.comments.length;
  const complete =
    thread.nextCommentsCursor === undefined && commentCount === thread.comments.length;
  return complete ? (thread.comments.at(-1)?.author?.login ?? null) : null;
};

export const getWorkbenchPullRequestAttention = ({
  reference,
  summary,
  activity,
  viewer,
  loading,
  error,
}: AttentionInput): WorkbenchPullRequestAttention => {
  if (isTerminalPullRequest({ reference, summary, loading }))
    return {
      pullRequestTitle: summary?.title,
      reasons: [],
      signalKinds: [],
      unresolvedReviewThreads: [],
      resolvedReviewThreadIds: [],
      activityComplete: true,
      checksKnown: true,
      reviewDecisionKnown: true,
      inspectionStatus: "complete",
      displayInspectionStatus: "complete",
      inspected: true,
      terminal: true,
    };
  const signalKinds = pullRequestSummarySignals({ reference, summary });
  // Your reply hands a discussion back to the others until someone comments after it.
  const login = viewer?.toLowerCase();
  const needsViewer = (thread: PullRequestReviewThread) =>
    !thread.isResolved &&
    (login === undefined || lastReviewCommentAuthor(thread)?.toLowerCase() !== login);
  const reviewThreads = activity?.reviewThreads ?? [];
  const unresolvedReviewThreads = reviewThreads.filter(needsViewer);
  if (unresolvedReviewThreads.length > 0) signalKinds.push("unresolved-feedback");
  const reasons: string[] = signalKinds.map((kind) => pullRequestReasonLabels[kind]);
  const { statusReason, ...inspection } = pullRequestInspection({
    summary,
    activity,
    loading,
    error,
  });
  if (statusReason) reasons.push(statusReason);
  return {
    pullRequestTitle: summary?.title,
    reasons,
    signalKinds,
    unresolvedReviewThreads,
    resolvedReviewThreadIds: reviewThreads
      .filter((thread) => !needsViewer(thread))
      .map((thread) => thread.id),
    displayInspectionStatus: inspection.inspectionStatus,
    ...inspection,
  };
};

/** An incomplete page can resolve returned discussions, but cannot resolve omitted ones. */
export const mergeWorkbenchPullRequestAttention = ({
  previous,
  next,
}: {
  readonly previous: WorkbenchPullRequestAttention | undefined;
  readonly next: WorkbenchPullRequestAttention;
}): WorkbenchPullRequestAttention => {
  if (!previous) return next;
  const discussions = new Map(
    (next.activityComplete ? [] : previous.unresolvedReviewThreads).map((thread) => [
      thread.id,
      thread,
    ]),
  );
  for (const thread of next.unresolvedReviewThreads) discussions.set(thread.id, thread);
  for (const id of next.resolvedReviewThreadIds) discussions.delete(id);
  const unresolvedReviewThreads = [...discussions.values()];
  // A summary signal survives a read that could not observe its source.
  const summarySignals = [
    ["failed-checks", next.checksKnown],
    ["changes-requested", next.reviewDecisionKnown],
    ["approved", next.reviewDecisionKnown],
  ] as const;
  const signalKinds: WorkbenchPullRequestAttentionKind[] = summarySignals
    .filter(
      ([kind, known]) =>
        next.signalKinds.includes(kind) || (!known && previous.signalKinds.includes(kind)),
    )
    .map(([kind]) => kind);
  if (unresolvedReviewThreads.length > 0) signalKinds.push("unresolved-feedback");
  return {
    ...next,
    displayInspectionStatus:
      next.inspectionStatus === "loading"
        ? previous.displayInspectionStatus
        : next.displayInspectionStatus,
    pullRequestTitle: next.pullRequestTitle ?? previous.pullRequestTitle,
    signalKinds,
    unresolvedReviewThreads,
    reasons: [
      ...signalKinds.map((kind) => pullRequestReasonLabels[kind]),
      ...next.reasons.filter((reason) => reason.startsWith("PR attention ")),
    ],
  };
};

/** Review bodies are markdown, and bots append hidden metadata; the preview keeps the prose. */
const reviewCommentExcerpt = (body: string) =>
  body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/^\s*(?:#+|>+)\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();

export const getWorkbenchReviewThreadPreview = (thread: PullRequestReviewThread) => {
  const first = thread.comments[0];
  const commentCount = thread.commentCount ?? thread.comments.length;
  return {
    location: thread.line === null ? thread.path : `${thread.path}:${thread.line}`,
    author: first?.author?.login ?? null,
    excerpt: first ? reviewCommentExcerpt(first.body) : "",
    replyCount: Math.max(commentCount - 1, 0),
    lastReplyAuthor: thread.comments.length > 1 ? lastReviewCommentAuthor(thread) : null,
  };
};

export const matchesWorkbenchAttention = (
  mode: WorkbenchAttentionMode,
  signals: ReadonlyArray<Pick<WorkbenchAttentionSignal, "kind">>,
) =>
  mode === "all" ||
  (mode === "replies" ? signals.some((signal) => signal.kind === "reply") : signals.length > 0);

/** A visit acknowledges a reply or request, without resolving the native request itself. */
export const getWorkbenchThreadNotification = ({
  nativeLabel,
  runStatus,
  completedAt,
  pendingRequests,
  lastVisitedAt,
}: {
  readonly nativeLabel: string | null | undefined;
  readonly runStatus: string | null | undefined;
  readonly completedAt: string | null | undefined;
  readonly pendingRequests?:
    | {
        readonly approvals: ReadonlyArray<Pick<ThreadPendingApproval, "createdAt">>;
        readonly userInputs: ReadonlyArray<Pick<ThreadPendingUserInput, "createdAt">>;
      }
    | undefined;
  readonly lastVisitedAt?: string | undefined;
}) => {
  if (runStatus === "interrupted") return null;
  let notification: WorkbenchThreadNotification;
  let occurredAt: string | null | undefined;
  if (nativeLabel === "Awaiting Input") {
    notification = { kind: "question" };
    occurredAt = pendingRequests?.userInputs.at(-1)?.createdAt;
  } else if (nativeLabel === "Pending Approval") {
    notification = { kind: "waiting", cause: "approval" };
    occurredAt = pendingRequests?.approvals.at(-1)?.createdAt;
  } else if (
    nativeLabel === "Working" ||
    nativeLabel === "Connecting" ||
    nativeLabel === "Monitoring"
  ) {
    return null;
  } else if (nativeLabel === "Plan Ready") {
    notification = { kind: "waiting", cause: "plan" };
    occurredAt = completedAt;
  } else if (runStatus === "failed") {
    notification = { kind: "waiting", cause: "failed" };
    occurredAt = completedAt;
  } else if (runStatus === "completed") {
    notification = { kind: "reply" };
    occurredAt = completedAt;
  } else return null;
  if (!occurredAt || !Number.isFinite(Date.parse(occurredAt))) return null;
  if (lastVisitedAt && Date.parse(lastVisitedAt) >= Date.parse(occurredAt)) return null;
  return { ...notification, occurredAt };
};
