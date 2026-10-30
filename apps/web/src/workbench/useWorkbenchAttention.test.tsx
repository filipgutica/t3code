import type {
  PendingThreadRequests,
  ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import { makeThreadFixture } from "../test-fixtures";
import { RegistryContext } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { useUiStateStore } from "../uiStateStore";
import { act, useLayoutEffect } from "react";
import { createAttentionNativeFixture } from "./workbenchAttention.testkit";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  RuntimeRequestId,
  type ScopedThreadRef,
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
import { type getWorkbenchPullRequestAttention } from "./workbenchAttention.logic";

vi.mock("../state/threads", () => ({
  environmentThreadDetails: {
    pendingRequestsAtom: (ref: ScopedThreadRef) => requestsAtom(scopedThreadKey(ref)),
  },
}));
const requestAt = "2026-09-29T00:01:00.000Z";
const question = (id: string, createdAt = requestAt): ThreadPendingUserInput => ({
  requestId: RuntimeRequestId.make(id),
  createdAt,
  questions: [
    {
      id: "question",
      header: "Choice",
      question: "Which option?",
      options: [{ label: "One", description: "First option" }],
      multiSelect: false,
    },
  ],
  responseCapability: "live",
  dismissible: false,
});
const requestsAtom = Atom.family((key: string) =>
  Atom.make<PendingThreadRequests>({
    approvals: key.endsWith(":other-waiting")
      ? [
          {
            requestId: RuntimeRequestId.make("approval"),
            requestKind: "command",
            createdAt: requestAt,
            responseCapability: "live",
          },
        ]
      : [],
    userInputs: key.endsWith(":waiting") ? [question("first-question")] : [],
  }),
);
let registry: AtomRegistry.AtomRegistry;
let native: ReturnType<typeof createAttentionNativeFixture>;
vi.mock("../state/pullRequests", () => ({
  linkedPullRequestDetailAtom: (target: Parameters<typeof native.summaryQuery>[0]) =>
    native.summaryQuery(target),
  pullRequestEnvironment: {
    activity: (target: Parameters<typeof native.activityQuery>[0]) => native.activityQuery(target),
  },
  sharedPullRequestSummaryAtom: (...args: Parameters<typeof native.sharedSummary>) =>
    native.sharedSummary(...args),
}));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    pullRequestViewer: (target: Parameters<typeof native.viewerQuery>[0]) =>
      native.viewerQuery(target),
  },
}));
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
const thread = (id: string): EnvironmentThreadShell =>
  makeThreadFixture({
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
    latestRun: null,
    runtime: null,
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
function AttentionHarness({
  environment = environmentId,
  threads = threadsById,
  activeThreadRef = null,
}: {
  environment?: EnvironmentId;
  threads?: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  activeThreadRef?: ScopedThreadRef | null;
}) {
  const attention = useWorkbenchAttention({
    environmentId: environment,
    projectId,
    tickets: [ticket],
    assignments,
    threadsById: threads,
    activeThreadRef,
  });
  useLayoutEffect(() => {
    result = attention;
  }, [attention]);
  return null;
}
function Harness(props: Parameters<typeof AttentionHarness>[0]) {
  return (
    <RegistryContext.Provider value={registry}>
      <AttentionHarness {...props} />
    </RegistryContext.Provider>
  );
}
async function publishInput(input: Parameters<typeof getWorkbenchPullRequestAttention>[0]) {
  await act(async () => result.refreshAttention());
  await act(async () =>
    native.publish(
      {
        environmentId,
        input: {
          projectId: input.reference.projectId,
          repository: input.reference.repository,
          number: input.reference.number,
          host: new URL(input.reference.url).host,
        },
      },
      input,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useUiStateStore.setState({ threadLastVisitedAtById: {} });
  native = createAttentionNativeFixture();
  registry = native.registry;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  registry.dispose();
  vi.unstubAllGlobals();
});

it("retains omitted unresolved discussions during partial reads and retires only confirmed resolutions", async () => {
  await act(async () => {
    renderer = create(<Harness />);
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
    publishInput({
      reference,
      summary: { state: "open", checksState: "passing", reviewDecision: "approved" },
      activity: { reviewThreads: [], commentsTruncated: false },
      loading: false,
      error: false,
      ...overrides,
    });
  const known = {
    summary: {
      title: "Keep invitation claims",
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
  await publish(known);
  await act(async () => result.refreshAttention());
  await publish({ activity: null });
  expect(feedback()).toEqual([first, second]);
  expect(
    result.attentionSignalsByTicket
      .get(ticket.id)
      ?.filter((signal) => signal.source.type === "pull-request")
      .map((signal) => signal.kind),
  ).toEqual(["unresolved-feedback"]);
  await publish({
    reference: { ...reference, title: "Older Thread title" },
    summary: null,
    activity: null,
  });
  const feedbackSource = result.attentionSignalsByTicket
    .get(ticket.id)
    ?.find((signal) => signal.kind === "unresolved-feedback")?.source;
  expect(
    feedbackSource?.type === "pull-request" ? feedbackSource.row.pullRequest.title : null,
  ).toBe("Keep invitation claims");
  await publish({ activity: { commentsTruncated: true, reviewThreads: [] } });
  expect(feedback()).toEqual([first, second]);
  await publish({
    activity: { commentsTruncated: false, reviewThreadsTruncated: true, reviewThreads: [] },
  });
  expect(feedback()).toEqual([first, second]);
  expect(result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.status).toBe("incomplete");
  await publish({
    activity: { commentsTruncated: true, reviewThreads: [{ ...first, isResolved: true }] },
  });
  expect(feedback()).toEqual([second]);
  expect(result.attentionReasonsByTicket.get(ticket.id)).toContain("Unresolved PR feedback");
  expect(result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.status).toBe("incomplete");
  await publish({});
  expect(feedback()).toBeUndefined();
  expect(result.attentionReasonsByTicket.get(ticket.id)).not.toContain("Unresolved PR feedback");
  await publish(known);
  await publish({ summary: { state: "merged" }, activity: null });
  expect(
    result.attentionSignalsByTicket
      .get(ticket.id)
      ?.filter((signal) => signal.source.type === "pull-request"),
  ).toEqual([]);
});

it("preserves each eligible Thread source and deduplicates shared PR reasons independently from coverage", async () => {
  await act(async () => {
    renderer = create(<Harness />);
  });
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.source)).toEqual([
    { type: "thread", threadId: waiting.id, threadTitle: waiting.title },
    { type: "thread", threadId: otherWaiting.id, threadTitle: otherWaiting.title },
  ]);
  expect(
    result.attentionSignalsByTicket.get(ticket.id)?.find((signal) => signal.kind === "waiting"),
  ).toMatchObject({
    kind: "waiting",
    cause: "approval",
  });
  const pr = result.attentionReferences[0]!;
  await publishInput({
    reference: pr,
    summary: {
      title: "Keep invitation claims",
      state: "open",
      checksState: "failing",
      reviewDecision: "changes-requested",
    },
    activity: { commentsTruncated: false, reviewThreads: [] },
    loading: false,
    error: true,
  });
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toEqual([
    "question",
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
      row: {
        threadId: waiting.id,
        threadTitle: waiting.title,
        pullRequest: { ...reference, title: "Keep invitation claims" },
      },
    },
    {
      type: "pull-request",
      row: {
        threadId: waiting.id,
        threadTitle: waiting.title,
        pullRequest: { ...reference, title: "Keep invitation claims" },
      },
    },
  ]);
  expect(
    result.attentionInspectionsByTicket
      .get(ticket.id)
      ?.map((inspection) => [inspection.row.threadId, inspection.status]),
  ).toEqual([[waiting.id, "unavailable"]]);
  expect(result.attentionReasonsByTicket.get(ticket.id)).toContain("PR attention unavailable");
});

it("retains feedback across reference-set and same-PR metadata changes, then prunes a closed PR", async () => {
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
  await act(async () => {
    renderer = create(<Harness threads={nativeThreads} />);
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
  await publishInput({
    reference,
    summary: { state: "open", checksState: "passing", reviewDecision: "approved" },
    activity: { reviewThreads: [reviewThread], commentsTruncated: false },
    loading: false,
    error: false,
  });
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toContain(
    "unresolved-feedback",
  );
  const expanded = new Map(nativeThreads).set(primary.id, {
    ...primary,
    linkedPullRequest: { ...reference, number: 8, url: "https://github.com/acme/web/pull/8" },
  });
  await act(async () => renderer.update(<Harness threads={expanded} />));
  expect(result.attentionReferences).toHaveLength(2);
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toContain(
    "unresolved-feedback",
  );
  await publishInput({
    reference,
    summary: null,
    activity: null,
    loading: false,
    error: true,
  });
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toContain(
    "unresolved-feedback",
  );
  await act(async () => renderer.update(<Harness threads={nativeThreads} />));
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
  await act(async () => renderer.update(<Harness threads={metadataChanged} />));
  await publishInput({
    reference: result.attentionReferences[0]!,
    summary: null,
    activity: null,
    loading: false,
    error: true,
  });
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
  await act(async () => renderer.update(<Harness threads={closed} />));
  expect(result.attentionReferences).toHaveLength(0);
  expect(
    result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind),
  ).not.toContain("unresolved-feedback");
});

it("keeps inspection across equivalent rerenders and known attention while explicit refresh completes", async () => {
  await act(async () => {
    renderer = create(<Harness />);
  });
  expect(result.attentionInspectionsByTicket.get(ticket.id)?.[0]).toMatchObject({
    status: "loading",
    displayStatus: "loading",
    inspected: false,
  });
  const observations: Parameters<typeof getWorkbenchPullRequestAttention>[0] = {
    reference,
    summary: { state: "open", checksState: "failing", reviewDecision: "approved" },
    activity: { reviewThreads: [], commentsTruncated: false },
    loading: false,
    error: false,
  };
  await publishInput(observations);
  const scope = result.attentionScope;
  expect(result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.inspected).toBe(true);
  await act(async () => renderer.update(<Harness />));
  expect(result.attentionScope).toBe(scope);
  expect(result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.inspected).toBe(true);
  expect(result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.status).toBe("complete");
  await act(async () => result.refreshAttention());
  expect(result.attentionScope).not.toBe(scope);
  expect(result.attentionInspectionsByTicket.get(ticket.id)?.[0]).toMatchObject({
    status: "loading",
    displayStatus: "complete",
    inspected: false,
  });
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toContain(
    "failed-checks",
  );
  await publishInput({ reference, summary: null, activity: null, loading: true, error: false });
  await publishInput({
    reference,
    summary: null,
    activity: null,
    loading: true,
    error: false,
  });
  expect(result.attentionInspectionsByTicket.get(ticket.id)?.[0]).toMatchObject({
    status: "loading",
    displayStatus: "complete",
    inspected: false,
  });
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toContain(
    "failed-checks",
  );
  await publishInput({
    reference,
    summary: null,
    activity: null,
    loading: false,
    error: true,
  });
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toContain(
    "failed-checks",
  );
  expect(result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.status).toBe("unavailable");
  expect(result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.displayStatus).toBe(
    "unavailable",
  );
  await act(async () => result.refreshAttention());
  expect(result.attentionInspectionsByTicket.get(ticket.id)?.[0]).toMatchObject({
    status: "loading",
    displayStatus: "unavailable",
    inspected: false,
  });
  await publishInput({
    reference,
    summary: { state: "open", checksState: "passing", reviewDecision: "approved" },
    activity: { reviewThreads: [], commentsTruncated: false },
    loading: false,
    error: false,
  });
  expect(
    result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind),
  ).not.toContain("failed-checks");
  expect(result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.inspected).toBe(true);
  await publishInput(observations);
  expect(result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind)).toContain(
    "failed-checks",
  );
  await act(async () =>
    renderer.update(<Harness environment={EnvironmentId.make("empty-environment")} />),
  );
  expect(result.attentionSignalsByTicket.get(ticket.id)).toEqual([]);
  expect(result.attentionInspectionsByTicket.get(ticket.id)).toEqual([]);
});

it("uses native server visits to clear questions and reacts to new requests rather than metadata", async () => {
  const waitingRef = scopeThreadRef(environmentId, waiting.id);
  const waitingKey = scopedThreadKey(waitingRef);
  const threadSignals = () =>
    result.attentionSignalsByTicket
      .get(ticket.id)
      ?.filter(
        (signal) => signal.source.type === "thread" && signal.source.threadId === waiting.id,
      );
  await act(async () => {
    renderer = create(<Harness />);
  });
  expect(threadSignals()?.map((signal) => signal.kind)).toEqual(["question"]);
  await act(async () => renderer.update(<Harness activeThreadRef={waitingRef} />));
  expect(threadSignals()).toEqual([]);
  expect(useUiStateStore.getState().threadLastVisitedAtById[waitingKey]).toBeUndefined();
  const visited = new Map(threadsById).set(waiting.id, { ...waiting, lastVisitedAt: requestAt });
  await act(async () => renderer.update(<Harness threads={visited} />));
  expect(threadSignals()).toEqual([]);
  const renamed = new Map(visited).set(waiting.id, {
    ...waiting,
    lastVisitedAt: requestAt,
    title: "Renamed",
    updatedAt: "2026-09-29T00:02:00.000Z",
  });
  await act(async () => renderer.update(<Harness threads={renamed} />));
  expect(threadSignals()).toEqual([]);
  const secondAt = "2026-09-29T00:03:00.000Z";
  await act(async () =>
    registry.set(requestsAtom(waitingKey), {
      approvals: [],
      userInputs: [question("first-question"), question("second-question", secondAt)],
    }),
  );
  expect(threadSignals()?.map((signal) => signal.kind)).toEqual(["question"]);
  // A same-ID Thread in another environment cannot acknowledge this request.
  await act(async () =>
    renderer.update(
      <Harness
        threads={renamed}
        activeThreadRef={scopeThreadRef(EnvironmentId.make("remote"), waiting.id)}
      />,
    ),
  );
  expect(threadSignals()?.map((signal) => signal.kind)).toEqual(["question"]);
  await act(async () => renderer.update(<Harness activeThreadRef={waitingRef} />));
  expect(threadSignals()).toEqual([]);
  expect(useUiStateStore.getState().threadLastVisitedAtById[waitingKey]).toBeUndefined();
  const visitedAgain = new Map(renamed).set(waiting.id, { ...waiting, lastVisitedAt: secondAt });
  await act(async () => renderer.update(<Harness threads={visitedAgain} />));
  expect(threadSignals()).toEqual([]);
});

it("lets an explicit null server visit restore a question despite a newer local visit", async () => {
  const waitingKey = scopedThreadKey(scopeThreadRef(environmentId, waiting.id));
  useUiStateStore.setState({
    threadLastVisitedAtById: { [waitingKey]: "2026-09-29T00:05:00.000Z" },
  });
  const visited = new Map(threadsById).set(waiting.id, { ...waiting, lastVisitedAt: requestAt });
  await act(async () => {
    renderer = create(<Harness threads={visited} />);
  });
  const threadSignals = () =>
    result.attentionSignalsByTicket
      .get(ticket.id)
      ?.filter(
        (signal) => signal.source.type === "thread" && signal.source.threadId === waiting.id,
      );
  expect(threadSignals()).toEqual([]);
  const unread = new Map(visited).set(waiting.id, { ...waiting, lastVisitedAt: null });
  await act(async () => renderer.update(<Harness threads={unread} />));
  expect(threadSignals()?.map((signal) => signal.kind)).toEqual(["question"]);
});
