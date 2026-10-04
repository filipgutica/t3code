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
  getWorkbenchThreadNotification,
  workbenchAttentionIdentity,
} from "./workbenchAttention.logic";

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
  it("acknowledges replies without claiming task completion and notifies for a later reply", () => {
    const firstReplyAt = "2026-10-01T00:01:00Z";
    const reply = { nativeLabel: null, runStatus: "completed", completedAt: firstReplyAt };
    expect(getWorkbenchThreadNotification(reply)).toEqual({
      kind: "reply",
      occurredAt: firstReplyAt,
    });
    expect(getWorkbenchThreadNotification({ ...reply, lastVisitedAt: firstReplyAt })).toBeNull();
    expect(
      getWorkbenchThreadNotification({
        ...reply,
        completedAt: "2026-10-01T00:02:00Z",
        lastVisitedAt: firstReplyAt,
      })?.kind,
    ).toBe("reply");
    expect(getWorkbenchThreadNotification({ ...reply, nativeLabel: "Working" })).toBeNull();
    expect(matchesWorkbenchAttention("replies", [{ kind: "reply" }])).toBe(true);
    expect(matchesWorkbenchAttention("replies", [{ kind: "question" }])).toBe(false);
  });
  it("acknowledges each pending question separately, including another question in the same turn", () => {
    const firstQuestionAt = "2026-10-01T00:01:00Z";
    const secondQuestionAt = "2026-10-01T00:02:00Z";
    const waiting = {
      nativeLabel: "Awaiting Input",
      runStatus: "running",
      completedAt: null,
      pendingRequests: { approvals: [], userInputs: [{ createdAt: firstQuestionAt }] },
    };
    expect(getWorkbenchThreadNotification(waiting)).toEqual({
      kind: "question",
      occurredAt: firstQuestionAt,
    });
    expect(
      getWorkbenchThreadNotification({ ...waiting, lastVisitedAt: firstQuestionAt }),
    ).toBeNull();
    const next = {
      ...waiting,
      pendingRequests: {
        approvals: [],
        userInputs: [{ createdAt: firstQuestionAt }, { createdAt: secondQuestionAt }],
      },
    };
    expect(getWorkbenchThreadNotification({ ...next, lastVisitedAt: firstQuestionAt })).toEqual({
      kind: "question",
      occurredAt: secondQuestionAt,
    });
    expect(getWorkbenchThreadNotification({ ...next, lastVisitedAt: secondQuestionAt })).toBeNull();
    expect(getWorkbenchThreadNotification({ ...waiting, pendingRequests: undefined })).toBeNull();
    expect(
      getWorkbenchThreadNotification({
        ...waiting,
        pendingRequests: { approvals: [], userInputs: [] },
      }),
    ).toBeNull();
  });
  it("acknowledges approvals and interrupted turns without treating them as questions", () => {
    const createdAt = "2026-10-01T00:01:00Z";
    const approval = {
      nativeLabel: "Pending Approval",
      runStatus: "running",
      completedAt: null,
      pendingRequests: { approvals: [{ createdAt }], userInputs: [] },
    };
    expect(getWorkbenchThreadNotification(approval)?.kind).toBe("waiting");
    expect(getWorkbenchThreadNotification({ ...approval, lastVisitedAt: createdAt })).toBeNull();
    const interrupted = { nativeLabel: null, runStatus: "interrupted", completedAt: createdAt };
    expect(getWorkbenchThreadNotification(interrupted)?.kind).toBe("waiting");
    expect(getWorkbenchThreadNotification({ ...interrupted, lastVisitedAt: createdAt })).toBeNull();
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
    expect(
      matchesWorkbenchAttention(
        "attention",
        failed.signalKinds.map((kind) => ({ kind })),
      ),
    ).toBe(true);
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
