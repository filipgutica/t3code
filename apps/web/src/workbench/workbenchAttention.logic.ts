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
} from "@t3tools/shared/threadPullRequests";
import type {
  TicketPullRequestReference,
  WorkbenchTicketPullRequest,
} from "./workbenchPullRequests.logic";

export type WorkbenchAttentionMode = "all" | "attention" | "replies";
export type WorkbenchPullRequestAttentionKind =
  | "failed-checks"
  | "changes-requested"
  | "unresolved-feedback";
const pullRequestReasonLabels = {
  "failed-checks": "Failed PR checks",
  "changes-requested": "PR changes requested",
  "unresolved-feedback": "Unresolved PR feedback",
} as const;
export type WorkbenchInspectionStatus = "loading" | "unavailable" | "incomplete" | "complete";
type WorkbenchThreadWaitingCause = "approval" | "plan" | "failed" | "interrupted";
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
  for (const signal of signals.toSorted(
    (left, right) => attentionPriority(left) - attentionPriority(right),
  )) {
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

const attentionPriority = (signal: WorkbenchAttentionSignal) => {
  if (signal.kind === "waiting")
    return signal.cause === "failed" || signal.cause === "interrupted" ? 1 : 0;
  return {
    question: 0,
    "failed-checks": 1,
    "changes-requested": 2,
    "unresolved-feedback": 3,
    reply: 4,
  }[signal.kind];
};

const waitingLabels = {
  approval: "Approval needed",
  plan: "Plan ready for review",
  failed: "Agent run failed",
  interrupted: "Agent run interrupted",
} as const;
const signalLabels = {
  question: "Waiting for your answer",
  reply: "Agent replied",
  "failed-checks": "Failed checks",
  "changes-requested": "Changes requested",
  "unresolved-feedback": "Unresolved feedback",
} as const;

export const getWorkbenchAttentionSignalLabel = (signal: WorkbenchAttentionSignal) =>
  signal.kind === "waiting" ? waitingLabels[signal.cause] : signalLabels[signal.kind];

export const getWorkbenchAttentionSourceLabel = (source: WorkbenchAttentionSignal["source"]) => {
  if (source.type === "thread") return `Thread · ${source.threadTitle}`;
  const reference = source.row.pullRequest;
  const title = reference.title === reference.repository ? undefined : reference.title;
  return [`PR #${reference.number}`, title, reference.repository].filter(Boolean).join(" · ");
};
export interface WorkbenchAttentionInspection {
  readonly row: WorkbenchTicketPullRequest;
  readonly status: WorkbenchInspectionStatus;
  readonly inspected: boolean;
}
export interface WorkbenchPullRequestAttention {
  readonly pullRequestTitle?: string | undefined;
  readonly reasons: ReadonlyArray<string>;
  readonly signalKinds: ReadonlyArray<WorkbenchPullRequestAttentionKind>;
  readonly unresolvedReviewThreads: ReadonlyArray<PullRequestReviewThread>;
  readonly resolvedReviewThreadIds: ReadonlyArray<string>;
  readonly activityComplete: boolean;
  readonly checksKnown: boolean;
  readonly reviewDecisionKnown: boolean;
  readonly inspectionStatus: WorkbenchInspectionStatus;
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
        Partial<Pick<PullRequestSummary, "title">>)
    | null;
  readonly activity: Pick<
    PullRequestActivity,
    "reviewThreads" | "commentsTruncated" | "reviewThreadsTruncated"
  > | null;
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

export const getWorkbenchPullRequestAttention = ({
  reference,
  summary,
  activity,
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
      inspected: true,
      terminal: true,
    };
  const signalKinds = pullRequestSummarySignals({ reference, summary });
  const unresolvedReviewThreads =
    activity?.reviewThreads.filter((thread) => !thread.isResolved) ?? [];
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
    resolvedReviewThreadIds:
      activity?.reviewThreads.filter((thread) => thread.isResolved).map((thread) => thread.id) ??
      [],
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
  const signalKinds: WorkbenchPullRequestAttentionKind[] = [];
  if (
    next.signalKinds.includes("failed-checks") ||
    (!next.checksKnown && previous.signalKinds.includes("failed-checks"))
  )
    signalKinds.push("failed-checks");
  if (
    next.signalKinds.includes("changes-requested") ||
    (!next.reviewDecisionKnown && previous.signalKinds.includes("changes-requested"))
  )
    signalKinds.push("changes-requested");
  if (unresolvedReviewThreads.length > 0) signalKinds.push("unresolved-feedback");
  return {
    ...next,
    pullRequestTitle: next.pullRequestTitle ?? previous.pullRequestTitle,
    signalKinds,
    unresolvedReviewThreads,
    reasons: [
      ...signalKinds.map((kind) => pullRequestReasonLabels[kind]),
      ...next.reasons.filter((reason) => reason.startsWith("PR attention ")),
    ],
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
  } else if (runStatus === "interrupted" || runStatus === "failed") {
    notification = { kind: "waiting", cause: runStatus };
    occurredAt = completedAt;
  } else if (runStatus === "completed") {
    notification = { kind: "reply" };
    occurredAt = completedAt;
  } else return null;
  if (!occurredAt || !Number.isFinite(Date.parse(occurredAt))) return null;
  if (lastVisitedAt && Date.parse(lastVisitedAt) >= Date.parse(occurredAt)) return null;
  return { ...notification, occurredAt };
};
