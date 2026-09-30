import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchAssignment,
  type WorkbenchTicket,
  type PullRequestReviewThread,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useWorkbenchAttention } from "./useWorkbenchAttention";
import {
  getWorkbenchPullRequestAttention,
  workbenchAttentionIdentity,
  type WorkbenchAttentionMode,
} from "./workbenchAttention.logic";

const environmentId = EnvironmentId.make("source-attention");
const projectId = WorkbenchProjectId.make("workspace");
const ticket: WorkbenchTicket = {
  id: WorkbenchTicketId.make("ticket"),
  projectId,
  title: "Review invitations",
  kind: "story",
  markdown: "",
  epicId: null,
  primaryT3ProjectId: ProjectId.make("repo"),
  repositoryProjectIds: [],
  status: "in_progress",
  blocked: false,
  revision: 0,
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
};
const thread = (id: string): EnvironmentThreadShell => ({
  id: ThreadId.make(id),
  environmentId,
  projectId: ProjectId.make("repo"),
  title: id,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
  latestTurn: null,
  session: null,
  pullRequests: [],
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
});
const reference = {
  projectId: ProjectId.make("repo"),
  repository: "acme/web",
  number: 7,
  url: "https://github.com/acme/web/pull/7",
};
const primary = thread("primary");
const waiting = { ...thread("waiting"), hasPendingUserInput: true, linkedPullRequest: reference };
const otherWaiting = {
  ...thread("other-waiting"),
  hasPendingApprovals: true,
  linkedPullRequest: reference,
};
const excluded = [
  { ...waiting, id: ThreadId.make("settled"), settledOverride: "settled" as const },
  { ...waiting, id: ThreadId.make("archived"), archivedAt: "2026-09-29T00:00:00.000Z" },
  { ...waiting, id: ThreadId.make("foreign"), environmentId: EnvironmentId.make("remote") },
  { ...waiting, id: ThreadId.make("superseded") },
];
const threadsById = new Map(
  [primary, waiting, otherWaiting, ...excluded].map((row) => [row.id, row]),
);
const assignments: WorkbenchAssignment[] = [...threadsById.values()].map((row) => ({
  id: WorkbenchAssignmentId.make(row.id),
  ticketId: ticket.id,
  threadId: row.id,
  createdAt: "2026-09-29T00:00:00.000Z",
  supersededAt: row.id === "superseded" ? "2026-09-29T00:00:00.000Z" : null,
}));
assignments.push({ ...assignments[1]!, id: WorkbenchAssignmentId.make("duplicate-assignment") });
let result: ReturnType<typeof useWorkbenchAttention>;
let renderer: ReactTestRenderer;
function Harness({
  mode,
  environment = environmentId,
  threads = threadsById,
}: {
  mode: WorkbenchAttentionMode;
  environment?: EnvironmentId;
  threads?: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
}) {
  const attention = useWorkbenchAttention({
    environmentId: environment,
    projectId,
    attentionMode: mode,
    tickets: [ticket],
    assignments,
    threadsById: threads,
  });
  useEffect(() => {
    result = attention;
  }, [attention]);
  return null;
}
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => act(() => renderer?.unmount()));

it("retains omitted unresolved discussions during partial reads and retires only confirmed resolutions", () => {
  act(() => {
    renderer = create(<Harness mode="all" />);
  });
  const first: PullRequestReviewThread = {
    id: "feedback-one",
    path: "src/invitations.ts",
    line: 12,
    side: "right",
    isResolved: false,
    isOutdated: false,
    comments: [],
  };
  const second = { ...first, id: "feedback-two", path: "src/settings.ts", line: 23 };
  const publish = (overrides: Partial<Parameters<typeof getWorkbenchPullRequestAttention>[0]>) =>
    act(() =>
      result.setAttentionObservations(
        new Map([
          [
            workbenchAttentionIdentity(environmentId, reference),
            getWorkbenchPullRequestAttention({
              reference,
              summary: { state: "open", checksState: "passing", reviewDecision: "approved" },
              activity: { reviewThreads: [], commentsTruncated: false },
              loading: false,
              error: false,
              ...overrides,
            }),
          ],
        ]),
      ),
    );
  const known = {
    summary: {
      state: "open" as const,
      checksState: "failing" as const,
      reviewDecision: "changes-requested" as const,
    },
    activity: { reviewThreads: [first, second], commentsTruncated: false },
  };
  const feedback = () => {
    const signal = result.attentionSignalsByTicket
      .get(ticket.id)
      ?.find((signal) => signal.kind === "unresolved-feedback");
    return signal?.kind === "unresolved-feedback" ? signal.unresolvedReviewThreads : undefined;
  };
  publish(known);
  act(() => result.refreshAttention());
  publish({ activity: null });
  expect(feedback()).toEqual([first, second]);
  expect(
    result.attentionSignalsByTicket
      .get(ticket.id)
      ?.filter((signal) => signal.source.type === "pull-request")
      .map((signal) => signal.kind),
  ).toEqual(["unresolved-feedback"]);
  publish({ activity: { commentsTruncated: true, reviewThreads: [] } });
  expect(feedback()).toEqual([first, second]);
  publish({
    activity: { commentsTruncated: true, reviewThreads: [{ ...first, isResolved: true }] },
  });
  expect(feedback()).toEqual([second]);
  expect(result.attentionReasonsByTicket.get(ticket.id)).toContain("Unresolved PR feedback");
  expect(result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.status).toBe("incomplete");
  publish({});
  expect(feedback()).toBeUndefined();
  expect(result.attentionReasonsByTicket.get(ticket.id)).not.toContain("Unresolved PR feedback");
  publish(known);
  publish({ summary: { state: "merged" }, activity: null });
  expect(
    result.attentionSignalsByTicket
      .get(ticket.id)
      ?.filter((signal) => signal.source.type === "pull-request"),
  ).toEqual([]);
});

it("preserves each eligible Thread source and deduplicates shared PR reasons independently from coverage", () => {
  act(() => {
    renderer = create(<Harness mode="all" />);
  });
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.source)).toEqual([
    { type: "thread", threadId: waiting.id, threadTitle: waiting.title },
    { type: "thread", threadId: otherWaiting.id, threadTitle: otherWaiting.title },
  ]);
  const pr = result.attentionReferences[0]!;
  act(() =>
    result.setAttentionObservations(
      new Map([
        [
          workbenchAttentionIdentity(environmentId, pr),
          getWorkbenchPullRequestAttention({
            reference: pr,
            summary: { state: "open", checksState: "failing", reviewDecision: "changes-requested" },
            activity: { commentsTruncated: false, reviewThreads: [] },
            loading: false,
            error: true,
          }),
        ],
      ]),
    ),
  );
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toEqual([
    "waiting",
    "waiting",
    "failed-checks",
    "changes-requested",
  ]);
  expect(
    result.attentionSignalsByTicket
      .get(ticket.id)
      ?.slice(2)
      .map((signal) => signal.source),
  ).toEqual([
    {
      type: "pull-request",
      row: { threadId: waiting.id, threadTitle: waiting.title, pullRequest: reference },
    },
    {
      type: "pull-request",
      row: { threadId: waiting.id, threadTitle: waiting.title, pullRequest: reference },
    },
  ]);
  expect(
    result.attentionInspectionsByTicket
      .get(ticket.id)
      ?.map((inspection) => [inspection.row.threadId, inspection.status]),
  ).toEqual([[waiting.id, "unavailable"]]);
  expect(result.attentionReasonsByTicket.get(ticket.id)).toContain("PR attention unavailable");
});

it("retains feedback across reference-set and same-PR metadata changes, then prunes a closed PR", () => {
  const link: ThreadPullRequestLink = {
    host: "github.com",
    repository: reference.repository,
    number: reference.number,
    url: reference.url,
    source: "manual",
    linkedAt: "2026-09-29T00:00:00.000Z",
    stack: null,
    snapshot: {
      state: "open",
      title: "Invite teammates",
      headBranch: "invitations",
      baseBranch: "main",
      isDraft: false,
      updatedAt: null,
      syncedAt: "2026-09-29T00:00:00.000Z",
      checksState: "passing",
      reviewDecision: "approved",
    },
  };
  const nativeThreads = new Map(threadsById)
    .set(waiting.id, { ...waiting, pullRequests: [link] })
    .set(otherWaiting.id, { ...otherWaiting, pullRequests: [link] });
  act(() => {
    renderer = create(<Harness mode="all" threads={nativeThreads} />);
  });
  const reviewThread = {
    id: "review-discussion",
    path: "src/index.ts",
    line: 1,
    side: "right" as const,
    isResolved: false,
    isOutdated: false,
    comments: [],
  };
  act(() =>
    result.setAttentionObservations(
      new Map([
        [
          workbenchAttentionIdentity(environmentId, reference),
          getWorkbenchPullRequestAttention({
            reference,
            summary: { state: "open", checksState: "passing", reviewDecision: "approved" },
            activity: { reviewThreads: [reviewThread], commentsTruncated: false },
            loading: false,
            error: false,
          }),
        ],
      ]),
    ),
  );
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toContain(
    "unresolved-feedback",
  );
  const expanded = new Map(nativeThreads).set(primary.id, {
    ...primary,
    linkedPullRequest: { ...reference, number: 8, url: "https://github.com/acme/web/pull/8" },
  });
  act(() => renderer.update(<Harness mode="all" threads={expanded} />));
  expect(result.attentionReferences).toHaveLength(2);
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toContain(
    "unresolved-feedback",
  );
  act(() =>
    result.setAttentionObservations(
      new Map([
        [
          workbenchAttentionIdentity(environmentId, reference),
          getWorkbenchPullRequestAttention({
            reference,
            summary: null,
            activity: null,
            loading: false,
            error: true,
          }),
        ],
      ]),
    ),
  );
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toContain(
    "unresolved-feedback",
  );
  act(() => renderer.update(<Harness mode="all" threads={nativeThreads} />));
  expect(result.attentionReferences).toHaveLength(1);
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toContain(
    "unresolved-feedback",
  );
  const pendingLink: ThreadPullRequestLink = {
    ...link,
    snapshot: { ...link.snapshot!, checksState: "pending" },
  };
  const metadataChanged = new Map(nativeThreads)
    .set(waiting.id, { ...waiting, pullRequests: [pendingLink] })
    .set(otherWaiting.id, { ...otherWaiting, pullRequests: [pendingLink] });
  act(() => renderer.update(<Harness mode="all" threads={metadataChanged} />));
  act(() =>
    result.setAttentionObservations(
      new Map([
        [
          workbenchAttentionIdentity(environmentId, reference),
          getWorkbenchPullRequestAttention({
            reference: result.attentionReferences[0]!,
            summary: null,
            activity: null,
            loading: false,
            error: true,
          }),
        ],
      ]),
    ),
  );
  expect(result.attentionSignalsByTicket.get(ticket.id)).toContainEqual(
    expect.objectContaining({
      kind: "unresolved-feedback",
      unresolvedReviewThreads: [reviewThread],
    }),
  );
  const closedLink: ThreadPullRequestLink = {
    ...link,
    snapshot: { ...link.snapshot!, state: "closed" },
  };
  const closed = new Map(nativeThreads)
    .set(waiting.id, { ...waiting, pullRequests: [closedLink] })
    .set(otherWaiting.id, { ...otherWaiting, pullRequests: [closedLink] });
  act(() => renderer.update(<Harness mode="all" threads={closed} />));
  expect(result.attentionReferences).toHaveLength(0);
  expect(
    result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind),
  ).not.toContain("unresolved-feedback");
});

it("keeps inspection across filter toggles and known attention while explicit refresh completes", () => {
  act(() => {
    renderer = create(<Harness mode="attention" />);
  });
  const scope = result.attentionScope;
  const observations = new Map([
    [
      workbenchAttentionIdentity(environmentId, reference),
      getWorkbenchPullRequestAttention({
        reference,
        summary: { state: "open", checksState: "failing", reviewDecision: "approved" },
        activity: { reviewThreads: [], commentsTruncated: false },
        loading: false,
        error: false,
      }),
    ],
  ]);
  act(() => result.setAttentionObservations(observations));
  expect(result.attentionCoverage).toBe("1 of 1 linked PRs inspected");
  act(() => renderer.update(<Harness mode="all" />));
  expect(result.attentionScope).toBe(scope);
  expect(result.attentionCoverage).toBe("1 of 1 linked PRs inspected");
  expect(result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.status).toBe("complete");
  act(() => result.refreshAttention());
  expect(result.attentionScope).not.toBe(scope);
  expect(result.attentionCoverage).toBe("0 of 1 linked PRs inspected");
  expect(result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.status).toBe("loading");
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toContain(
    "failed-checks",
  );
  act(() => result.setAttentionObservations(new Map()));
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toContain(
    "failed-checks",
  );
  act(() =>
    result.setAttentionObservations(
      new Map([
        [
          workbenchAttentionIdentity(environmentId, reference),
          getWorkbenchPullRequestAttention({
            reference,
            summary: null,
            activity: null,
            loading: false,
            error: true,
          }),
        ],
      ]),
    ),
  );
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toContain(
    "failed-checks",
  );
  expect(result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.status).toBe("unavailable");
  act(() =>
    result.setAttentionObservations(
      new Map([
        [
          workbenchAttentionIdentity(environmentId, reference),
          getWorkbenchPullRequestAttention({
            reference,
            summary: { state: "open", checksState: "passing", reviewDecision: "approved" },
            activity: { reviewThreads: [], commentsTruncated: false },
            loading: false,
            error: false,
          }),
        ],
      ]),
    ),
  );
  expect(
    result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind),
  ).not.toContain("failed-checks");
  expect(result.attentionCoverage).toBe("1 of 1 linked PRs inspected");
  act(() => result.setAttentionObservations(observations));
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toContain(
    "failed-checks",
  );
  act(() =>
    renderer.update(<Harness mode="all" environment={EnvironmentId.make("empty-environment")} />),
  );
  expect(result.attentionSignalsByTicket.get(ticket.id)).toEqual([]);
  expect(result.attentionInspectionsByTicket.get(ticket.id)).toEqual([]);
  expect(result.attentionCoverage).toBe("0 of 0 linked PRs inspected");
});
