import type {
  EnvironmentId,
  PullRequestActivity,
  PullRequestSummary,
  WorkbenchAssignment,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  legacyThreadPullRequestKey,
  threadPullRequestKeyOf,
} from "@t3tools/shared/threadPullRequests";
import type { TicketPullRequestReference } from "./workbenchPullRequests.logic";

export type WorkbenchAttentionMode = "all" | "attention" | "review";
export interface WorkbenchPullRequestAttention {
  readonly reasons: ReadonlyArray<string>;
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
  readonly environmentId: EnvironmentId;
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
    readonly reviewThreads: ReadonlyArray<
      Pick<PullRequestActivity["reviewThreads"][number], "isResolved" | "isOutdated">
    >;
    readonly commentsTruncated: boolean;
  } | null;
  readonly loading: boolean;
  readonly error: boolean;
};
const isTerminalPullRequest = ({
  reference,
  summary,
}: Pick<AttentionInput, "reference" | "summary">) =>
  reference.state === "merged" ||
  reference.state === "closed" ||
  summary?.state === "merged" ||
  summary?.state === "closed";
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
  if (isTerminalPullRequest({ reference, summary }))
    return { reasons: [], inspected: true, terminal: true };
  const reasons: string[] = [];
  if (
    (summary?.checksState === undefined ? reference.checksState : summary.checksState) === "failing"
  )
    reasons.push("Failed PR checks");
  if (
    (summary?.reviewDecision === undefined ? reference.reviewDecision : summary.reviewDecision) ===
    "changes-requested"
  )
    reasons.push("PR changes requested");
  if (activity?.reviewThreads.some((thread) => !thread.isResolved))
    reasons.push("Unresolved PR feedback");
  const unknown = hasUnknownCoverage({ summary, activity });
  const statusReason = coverageReason({ loading, error, unknown });
  if (statusReason) reasons.push(statusReason);
  return {
    reasons,
    inspected: !error && !loading && !unknown,
    terminal: !loading && (error || (summary !== null && activity !== null)),
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
