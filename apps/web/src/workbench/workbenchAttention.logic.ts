import type {
  EnvironmentId,
  PullRequestActivity,
  PullRequestSummary,
  PullRequestReviewThread,
  ThreadId,
  WorkbenchAssignment,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  legacyThreadPullRequestKey,
  threadPullRequestKeyOf,
} from "@t3tools/shared/threadPullRequests";
import type {
  TicketPullRequestReference,
  WorkbenchTicketPullRequest,
} from "./workbenchPullRequests.logic";

export type WorkbenchAttentionMode = "all" | "attention" | "review";
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
export type WorkbenchAttentionSignal =
  | {
      readonly kind: "waiting" | "review-ready";
      readonly source: {
        readonly type: "thread";
        readonly threadId: ThreadId;
        readonly threadTitle: string;
      };
    }
  | {
      readonly kind: WorkbenchPullRequestAttentionKind;
      readonly source: { readonly type: "pull-request"; readonly row: WorkbenchTicketPullRequest };
      readonly unresolvedReviewThreads: ReadonlyArray<PullRequestReviewThread>;
    };
export interface WorkbenchAttentionInspection {
  readonly row: WorkbenchTicketPullRequest;
  readonly status: WorkbenchInspectionStatus;
  readonly inspected: boolean;
}
export interface WorkbenchPullRequestAttention {
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
  readonly summary: Pick<PullRequestSummary, "state" | "checksState" | "reviewDecision"> | null;
  readonly activity: {
    readonly reviewThreads: PullRequestActivity["reviewThreads"];
    readonly commentsTruncated: boolean;
  } | null;
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
  activity.commentsTruncated;
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

export const getWorkbenchPullRequestAttention = ({
  reference,
  summary,
  activity,
  loading,
  error,
}: AttentionInput): WorkbenchPullRequestAttention => {
  if (isTerminalPullRequest({ reference, summary, loading }))
    return {
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
  const reasons: string[] = [];
  const signalKinds: WorkbenchPullRequestAttentionKind[] = [];
  if (
    (summary?.checksState === undefined ? reference.checksState : summary.checksState) === "failing"
  ) {
    reasons.push(pullRequestReasonLabels["failed-checks"]);
    signalKinds.push("failed-checks");
  }
  if (
    (summary?.reviewDecision === undefined ? reference.reviewDecision : summary.reviewDecision) ===
    "changes-requested"
  ) {
    reasons.push(pullRequestReasonLabels["changes-requested"]);
    signalKinds.push("changes-requested");
  }
  const unresolvedReviewThreads =
    activity?.reviewThreads.filter((thread) => !thread.isResolved) ?? [];
  if (unresolvedReviewThreads.length > 0) {
    reasons.push(pullRequestReasonLabels["unresolved-feedback"]);
    signalKinds.push("unresolved-feedback");
  }
  const unknown = hasUnknownCoverage({ summary, activity });
  const statusReason = coverageReason({ loading, error, unknown });
  if (statusReason) reasons.push(statusReason);
  return {
    reasons,
    signalKinds,
    unresolvedReviewThreads,
    resolvedReviewThreadIds:
      activity?.reviewThreads.filter((thread) => thread.isResolved).map((thread) => thread.id) ??
      [],
    activityComplete: !loading && !error && activity !== null && !activity.commentsTruncated,
    checksKnown: !loading && summary !== null && summary.checksState !== undefined,
    reviewDecisionKnown: !loading && summary !== null && summary.reviewDecision !== undefined,
    inspectionStatus: loading
      ? "loading"
      : error
        ? "unavailable"
        : unknown
          ? "incomplete"
          : "complete",
    inspected: !error && !loading && !unknown,
    terminal: !loading && (error || (summary !== null && activity !== null)),
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
  reasons: ReadonlyArray<string>,
) =>
  mode === "all" || (mode === "review" ? reasons.includes("Ready for review") : reasons.length > 0);

export const workbenchThreadAttentionReasons = (
  presentations: ReadonlyArray<{ readonly label: string } | null>,
) => [
  ...new Set(
    presentations.flatMap((presentation) =>
      presentation?.label === "Ready for review" || presentation?.label === "Waiting for input"
        ? [presentation.label]
        : [],
    ),
  ),
];
