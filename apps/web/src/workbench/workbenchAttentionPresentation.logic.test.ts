import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type {
  WorkbenchAttentionInspection,
  WorkbenchAttentionSignal,
} from "./workbenchAttention.logic";
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
  { kind: "waiting", cause: "interrupted", source: threadSource },
];
const question = { kind: "question", source: threadSource } as const;
const approval = { kind: "waiting", cause: "approval", source: threadSource } as const;
const failed = { kind: "waiting", cause: "failed", source: threadSource } as const;

describe("Workbench attention badge presentation", () => {
  it("counts every Ticket reason and uses the first reason at the highest live priority", () => {
    const signals = [...prSignals, ...notifications, question];
    const badge = getWorkbenchAttentionBadgePresentation(signals);
    expect(badge.count).toBe(7);
    // Plan-ready and input have the same priority; preserve their source's signal order.
    expect(badge.leading?.label).toBe("Plan ready for review");
    expect(badge.reasons).toBe(
      "Plan ready for review, Waiting for your answer, Agent run interrupted, Agent replied, Failed checks, Changes requested, Unresolved feedback",
    );
    expect(getWorkbenchAttentionBadgePresentation([question, ...prSignals]).leading).toMatchObject({
      label: "Waiting for your answer",
      icon: "input",
    });
    expect(getWorkbenchAttentionBadgePresentation(prSignals).leading).toMatchObject({
      label: "Failed checks",
      icon: "failed",
      action: "View checks",
    });
    expect(getWorkbenchAttentionBadgePresentation([])).toEqual({
      count: 0,
      leading: null,
      reasons: "",
    });
  });

  it.each([
    {
      statusKind: "input" as const,
      duplicate: question,
      remaining: [approval, failed],
    },
    {
      statusKind: "approval" as const,
      duplicate: approval,
      remaining: [question, failed],
    },
    {
      statusKind: "failed" as const,
      duplicate: failed,
      remaining: [question, approval],
    },
  ])(
    "removes only the notification already shown by the Thread's $statusKind status",
    ({ statusKind, duplicate, remaining }) => {
      const attention = getWorkbenchThreadAttention({
        threadId,
        statusKind,
        signals: [...notifications, question, approval, failed, ...prSignals],
        inspections: [],
      });
      expect(attention.signals).toEqual([...notifications, ...remaining, ...prSignals]);
      expect(getWorkbenchAttentionBadgePresentation(attention.signals).count).toBe(8);
      expect(
        getWorkbenchThreadAttention({
          threadId,
          statusKind: "waiting",
          signals: [duplicate],
          inspections: [],
        }).signals,
      ).toEqual([duplicate]);
    },
  );

  it("scopes both PR and Thread reasons and inspection uncertainty to the owning Thread", () => {
    const inspection: WorkbenchAttentionInspection = {
      row,
      status: "unavailable",
      displayStatus: "incomplete",
      inspected: false,
    };
    const otherInspection = { ...inspection, row: { ...row, threadId: otherThreadId } };
    const foreignSignals: ReadonlyArray<WorkbenchAttentionSignal> = [
      { kind: "question", source: { ...threadSource, threadId: otherThreadId } },
      {
        kind: "failed-checks",
        source: { type: "pull-request", row: otherInspection.row },
        unresolvedReviewThreads: [],
      },
    ];
    const attention = getWorkbenchThreadAttention({
      threadId,
      statusKind: null,
      signals: [...foreignSignals, ...notifications, ...prSignals],
      inspections: [otherInspection, inspection],
    });
    expect(attention.signals).toEqual([...notifications, ...prSignals]);
    expect(attention.inspections).toEqual([inspection]);
    const unknown = getWorkbenchThreadAttention({
      threadId,
      statusKind: null,
      signals: [],
      inspections: [inspection],
    });
    expect(unknown.signals).toEqual([]);
    expect(unknown.inspections[0]?.displayStatus).toBe("incomplete");
  });
});
