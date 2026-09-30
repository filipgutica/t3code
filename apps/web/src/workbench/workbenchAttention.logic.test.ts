import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchTicketId,
  type WorkbenchAssignment,
  type PullRequestReviewThread,
} from "@t3tools/contracts";
import {
  activeWorkbenchAttentionAssignments,
  getWorkbenchPullRequestAttention,
  matchesWorkbenchAttention,
  workbenchThreadAttentionReasons,
  workbenchAttentionIdentity,
} from "./workbenchAttention.logic";
import { getWorkbenchAgentPresentation } from "./workbench.logic";

const environmentId = EnvironmentId.make("attention-local");
const reference = {
  projectId: ProjectId.make("repo"),
  repository: "acme/web",
  number: 7,
  url: "https://github.com/acme/web/pull/7",
};
const cleanSummary = {
  state: "open" as const,
  checksState: "passing" as const,
  reviewDecision: "approved" as const,
};
const activity = { commentsTruncated: false, reviewThreads: [] };
const reviewThread = (id: string, isResolved = false): PullRequestReviewThread => ({
  id,
  path: "src/settings.ts",
  line: 12,
  side: "right",
  isResolved,
  isOutdated: false,
  comments: [],
});
const evaluate = (
  overrides: Partial<Parameters<typeof getWorkbenchPullRequestAttention>[0]> = {},
) =>
  getWorkbenchPullRequestAttention({
    reference,
    summary: cleanSummary,
    activity,
    loading: false,
    error: false,
    ...overrides,
  });

describe("Workbench attention from active native Threads and linked PRs", () => {
  it("keeps ready work visible when another active Thread is working", () => {
    const reasons = workbenchThreadAttentionReasons([
      getWorkbenchAgentPresentation({
        nativeLabel: "Working",
        sessionStatus: "running",
        turnState: "running",
      }),
      getWorkbenchAgentPresentation({
        nativeLabel: null,
        sessionStatus: "ready",
        turnState: "completed",
      }),
      getWorkbenchAgentPresentation({
        nativeLabel: "Pending Approval",
        sessionStatus: "ready",
        turnState: "running",
      }),
    ]);
    expect(reasons).toEqual(["Ready for review", "Waiting for input"]);
    expect(matchesWorkbenchAttention("review", reasons)).toBe(true);
    expect(matchesWorkbenchAttention("attention", reasons)).toBe(true);
    expect(matchesWorkbenchAttention("review", ["Waiting for input"])).toBe(false);
  });
  it("excludes superseded, settled, archived, missing and foreign-environment assignments", () => {
    const assignment = (id: string, supersededAt: string | null = null): WorkbenchAssignment => ({
      id: WorkbenchAssignmentId.make(id),
      ticketId: WorkbenchTicketId.make("ticket"),
      threadId: ThreadId.make(id),
      createdAt: "2026-09-27T00:00:00Z",
      supersededAt,
    });
    const thread = { environmentId, archivedAt: null, settledOverride: "active" as const };
    const result = activeWorkbenchAttentionAssignments({
      environmentId,
      assignments: [
        assignment("active"),
        assignment("superseded", "2026-09-27T00:00:00Z"),
        assignment("settled"),
        assignment("archived"),
        assignment("missing"),
        assignment("foreign"),
      ],
      threadsById: new Map<
        ThreadId,
        {
          environmentId: EnvironmentId;
          archivedAt: string | null;
          settledOverride: "active" | "settled";
        }
      >([
        [ThreadId.make("active"), thread],
        [ThreadId.make("superseded"), thread],
        [ThreadId.make("settled"), { ...thread, settledOverride: "settled" }],
        [ThreadId.make("archived"), { ...thread, archivedAt: "2026-09-27T00:00:00Z" }],
        [ThreadId.make("foreign"), { ...thread, environmentId: EnvironmentId.make("remote") }],
      ]),
    });
    expect(result.map((assignment) => assignment.threadId)).toEqual(["active"]);
  });
  it("uses failed checks, requested changes and unresolved outdated discussions, never unread", () => {
    expect(
      evaluate({
        summary: { ...cleanSummary, checksState: "failing", reviewDecision: "changes-requested" },
        activity: {
          ...activity,
          reviewThreads: [{ ...reviewThread("outdated"), isOutdated: true }],
        },
      }).reasons,
    ).toEqual(["Failed PR checks", "PR changes requested", "Unresolved PR feedback"]);
    expect(
      evaluate({
        activity: { ...activity, reviewThreads: [reviewThread("resolved", true)] },
      }).reasons,
    ).toEqual([]);
    expect(
      evaluate({
        reference: { ...reference, checksState: "failing", reviewDecision: "changes-requested" },
        summary: { state: "open", checksState: null, reviewDecision: null },
      }).reasons,
    ).toEqual([]);
    expect(evaluate().inspected).toBe(true);
  });
  it("retains uncertainty for missing, loading, truncated and failed native reads", () => {
    expect(evaluate({ summary: null }).reasons).toEqual(["PR attention unknown"]);
    expect(evaluate({ summary: { state: "open" } }).inspected).toBe(false);
    expect(evaluate({ loading: true }).reasons).toEqual(["PR attention loading"]);
    expect(evaluate({ activity: { ...activity, commentsTruncated: true } }).reasons).toEqual([
      "PR attention unknown",
    ]);
    const failed = evaluate({ summary: { ...cleanSummary, checksState: "failing" }, error: true });
    expect(failed.reasons).toEqual(["Failed PR checks", "PR attention unavailable"]);
    expect(failed.inspected).toBe(false);
    expect(matchesWorkbenchAttention("attention", failed.reasons)).toBe(true);
  });
  it("counts each actionable PR reason once and preserves unresolved native discussion targets", () => {
    const first = reviewThread("discussion-one");
    const second = { ...reviewThread("discussion-two"), isOutdated: true };
    const result = evaluate({
      summary: { ...cleanSummary, checksState: "failing", reviewDecision: "changes-requested" },
      activity: {
        commentsTruncated: true,
        reviewThreads: [first, second, reviewThread("resolved", true)],
      },
      error: true,
    });
    expect(result.signalKinds).toEqual([
      "failed-checks",
      "changes-requested",
      "unresolved-feedback",
    ]);
    expect(result.unresolvedReviewThreads).toEqual([first, second]);
    expect(result.inspectionStatus).toBe("unavailable");
    expect(evaluate({ loading: true }).signalKinds).toEqual([]);
    expect(evaluate({ activity: { ...activity, commentsTruncated: true } }).inspectionStatus).toBe(
      "incomplete",
    );
  });
  it("excludes merged/closed references even with stale failing observations", () => {
    for (const state of ["merged", "closed"] as const)
      expect(
        evaluate({
          reference: { ...reference, state },
          summary: { ...cleanSummary, checksState: "failing" },
          loading: true,
          error: true,
        }).reasons,
      ).toEqual([]);
    expect(evaluate({ summary: { ...cleanSummary, state: "merged" } }).reasons).toEqual([]);
  });
  it("deduplicates case-insensitive native PR identities within one environment only", () => {
    expect(workbenchAttentionIdentity(environmentId, reference)).toBe(
      workbenchAttentionIdentity(environmentId, { ...reference, repository: "ACME/WEB" }),
    );
    expect(workbenchAttentionIdentity(environmentId, reference)).not.toBe(
      workbenchAttentionIdentity(EnvironmentId.make("remote"), reference),
    );
  });
});
