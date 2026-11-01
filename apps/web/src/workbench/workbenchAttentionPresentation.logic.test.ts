import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { WorkbenchAttentionSignal } from "./workbenchAttention.logic";
import {
  getWorkbenchAttentionBadgePresentation,
  getWorkbenchThreadAttention,
} from "./workbenchAttentionPresentation.logic";

const threadId = ThreadId.make("review-thread");
const otherThreadId = ThreadId.make("other-thread");
const threadSource = { type: "thread", threadId, threadTitle: "Review settings" } as const;
const row = {
  threadId,
  threadTitle: "Review settings",
  pullRequest: {
    projectId: ProjectId.make("repository"),
    repository: "acme/settings",
    number: 7,
    url: "https://github.com/acme/settings/pull/7",
  },
};
const prSource = { type: "pull-request", row } as const;
const prSignals: ReadonlyArray<WorkbenchAttentionSignal> = [
  { kind: "unresolved-feedback", source: prSource, unresolvedReviewThreads: [] },
  { kind: "changes-requested", source: prSource, unresolvedReviewThreads: [] },
  { kind: "failed-checks", source: prSource, unresolvedReviewThreads: [] },
];
const notifications: ReadonlyArray<WorkbenchAttentionSignal> = [
  { kind: "reply", source: threadSource },
  { kind: "waiting", cause: "plan", source: threadSource },
];
const question = { kind: "question", source: threadSource } as const;
const approval = { kind: "waiting", cause: "approval", source: threadSource } as const;
const failed = { kind: "waiting", cause: "failed", source: threadSource } as const;

describe("Workbench attention badge presentation", () => {
  it("orders distinct reason kinds and merges requested changes with unresolved feedback", () => {
    const signals = [...prSignals, ...notifications, question, failed, approval, question];
    expect(getWorkbenchAttentionBadgePresentation({ signals, nativeStatusKind: null })).toEqual({
      kinds: ["approval", "input", "failed", "checks", "feedback", "plan", "done"],
      leading: "approval",
      more: 6,
      reasons: "Approval, Input, Failed, Checks failed, Feedback, Plan ready, Done",
    });
    expect(
      getWorkbenchAttentionBadgePresentation({
        signals: prSignals.slice(0, 2),
        nativeStatusKind: null,
      }),
    ).toEqual({
      kinds: ["feedback"],
      leading: "feedback",
      more: 0,
      reasons: "Feedback",
    });
    expect(getWorkbenchAttentionBadgePresentation({ signals: [], nativeStatusKind: null })).toEqual(
      {
        kinds: [],
        leading: null,
        more: 0,
        reasons: "",
      },
    );
  });

  it.each([
    {
      nativeStatusKind: "input" as const,
      kinds: ["approval", "failed", "checks", "feedback", "plan", "done"],
    },
    {
      nativeStatusKind: "approval" as const,
      kinds: ["input", "failed", "checks", "feedback", "plan", "done"],
    },
    {
      nativeStatusKind: "failed" as const,
      kinds: ["approval", "input", "checks", "feedback", "plan", "done"],
    },
    {
      nativeStatusKind: "working" as const,
      kinds: ["approval", "input", "failed", "checks", "feedback", "plan", "done"],
    },
  ])(
    "lets native $nativeStatusKind own the leading slot and counts only additional kinds",
    ({ nativeStatusKind, kinds }) => {
      const badge = getWorkbenchAttentionBadgePresentation({
        signals: [...notifications, question, approval, failed, ...prSignals],
        nativeStatusKind,
      });
      expect(badge.kinds).toEqual(kinds);
      expect(badge.leading).toBeNull();
      expect(badge.more).toBe(kinds.length);
      expect(badge.reasons).toBe(
        "Approval, Input, Failed, Checks failed, Feedback, Plan ready, Done",
      );
    },
  );

  it("scopes PR and Thread reasons to the owning Thread", () => {
    const foreignSignals: ReadonlyArray<WorkbenchAttentionSignal> = [
      { kind: "question", source: { ...threadSource, threadId: otherThreadId } },
      {
        kind: "failed-checks",
        source: { type: "pull-request", row: { ...row, threadId: otherThreadId } },
        unresolvedReviewThreads: [],
      },
    ];
    const attention = getWorkbenchThreadAttention({
      threadId,
      signals: [...foreignSignals, ...notifications, question, approval, failed, ...prSignals],
    });
    expect(attention.signals).toEqual([...notifications, question, approval, failed, ...prSignals]);
    const unknown = getWorkbenchThreadAttention({
      threadId,
      signals: [],
    });
    expect(unknown.signals).toEqual([]);
  });
});
