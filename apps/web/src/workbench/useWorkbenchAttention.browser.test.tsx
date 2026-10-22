import { act, render as renderUI, type Screen } from "../../test/render";
import type {
  PendingThreadRequests,
  ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import { makeThreadFixture } from "../test-fixtures";
import { RegistryContext } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { useUiStateStore } from "../uiStateStore";
import { useEffect } from "react";
import { expect, it, vi } from "vite-plus/test";
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
import {
  getWorkbenchPullRequestAttention,
  workbenchAttentionIdentity,
} from "./workbenchAttention.logic";
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
function setup() {
  const resources = new AsyncDisposableStack();
  let registry: AtomRegistry.AtomRegistry;
  let result: ReturnType<typeof useWorkbenchAttention>;
  let renderer: Screen;
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
    useEffect(() => {
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
  useUiStateStore.setState({ threadLastVisitedAtById: {} });
  registry = AtomRegistry.make();
  resources.defer(() => registry.dispose());
  return {
    get result() {
      return result;
    },
    get renderer() {
      return renderer;
    },
    set renderer(value: Screen) {
      renderer = value;
    },
    resources,
    get registry() {
      return registry;
    },
    Harness,
    async [Symbol.asyncDispose]() {
      await resources.disposeAsync();
    },
  };
}
it("retains omitted unresolved discussions during partial reads and retires only confirmed resolutions", async () => {
  await using fixture = setup();
  fixture.renderer = fixture.resources.use(await renderUI(<fixture.Harness />));
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
  const publish = async (
    overrides: Partial<Parameters<typeof getWorkbenchPullRequestAttention>[0]>,
  ) =>
    await act(() =>
      fixture.result.setAttentionObservations(
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
      title: "Keep invitation claims",
      state: "open" as const,
      checksState: "failing" as const,
      reviewDecision: "changes-requested" as const,
    },
    activity: { reviewThreads: [first, second], commentsTruncated: false },
  };
  const feedback = () => {
    const signal = fixture.result.attentionSignalsByTicket
      .get(ticket.id)
      ?.find((signal) => signal.kind === "unresolved-feedback");
    return signal?.kind === "unresolved-feedback" ? signal.unresolvedReviewThreads : undefined;
  };
  await publish(known);
  await act(() => fixture.result.refreshAttention());
  await publish({ activity: null });
  expect(feedback()).toEqual([first, second]);
  expect(
    fixture.result.attentionSignalsByTicket
      .get(ticket.id)
      ?.filter((signal) => signal.source.type === "pull-request")
      .map((signal) => signal.kind),
  ).toEqual(["unresolved-feedback"]);
  await publish({
    reference: { ...reference, title: "Older Thread title" },
    summary: null,
    activity: null,
  });
  const feedbackSource = fixture.result.attentionSignalsByTicket
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
  expect(fixture.result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.status).toBe(
    "incomplete",
  );
  await publish({
    activity: { commentsTruncated: true, reviewThreads: [{ ...first, isResolved: true }] },
  });
  expect(feedback()).toEqual([second]);
  expect(fixture.result.attentionReasonsByTicket.get(ticket.id)).toContain(
    "Unresolved PR feedback",
  );
  expect(fixture.result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.status).toBe(
    "incomplete",
  );
  await publish({});
  expect(feedback()).toBeUndefined();
  expect(fixture.result.attentionReasonsByTicket.get(ticket.id)).not.toContain(
    "Unresolved PR feedback",
  );
  await publish(known);
  await publish({ summary: { state: "merged" }, activity: null });
  expect(
    fixture.result.attentionSignalsByTicket
      .get(ticket.id)
      ?.filter((signal) => signal.source.type === "pull-request"),
  ).toEqual([]);
});
it("preserves each eligible Thread source and deduplicates shared PR reasons independently from coverage", async () => {
  await using fixture = setup();
  fixture.renderer = fixture.resources.use(await renderUI(<fixture.Harness />));
  expect(
    fixture.result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.source),
  ).toEqual([
    { type: "thread", threadId: waiting.id, threadTitle: waiting.title },
    { type: "thread", threadId: otherWaiting.id, threadTitle: otherWaiting.title },
  ]);
  expect(
    fixture.result.attentionSignalsByTicket
      .get(ticket.id)
      ?.find((signal) => signal.kind === "waiting"),
  ).toMatchObject({
    kind: "waiting",
    cause: "approval",
  });
  const pr = fixture.result.attentionReferences[0]!;
  await act(() =>
    fixture.result.setAttentionObservations(
      new Map([
        [
          workbenchAttentionIdentity(environmentId, pr),
          getWorkbenchPullRequestAttention({
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
          }),
        ],
      ]),
    ),
  );
  expect(
    fixture.result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind),
  ).toEqual(["question", "waiting", "failed-checks", "changes-requested"]);
  expect(
    fixture.result.attentionSignalsByTicket
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
    fixture.result.attentionInspectionsByTicket
      .get(ticket.id)
      ?.map((inspection) => [inspection.row.threadId, inspection.status]),
  ).toEqual([[waiting.id, "unavailable"]]);
  expect(fixture.result.attentionReasonsByTicket.get(ticket.id)).toContain(
    "PR attention unavailable",
  );
});
it("retains feedback across reference-set and same-PR metadata changes, then prunes a closed PR", async () => {
  await using fixture = setup();
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
  fixture.renderer = fixture.resources.use(
    await renderUI(<fixture.Harness threads={nativeThreads} />),
  );
  const reviewThread = {
    id: "review-discussion",
    path: "src/index.ts",
    line: 1,
    side: "right" as const,
    isResolved: false,
    isOutdated: false,
    comments: [],
  };
  await act(() =>
    fixture.result.setAttentionObservations(
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
  expect(
    fixture.result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind),
  ).toContain("unresolved-feedback");
  const expanded = new Map(nativeThreads).set(primary.id, {
    ...primary,
    linkedPullRequest: { ...reference, number: 8, url: "https://github.com/acme/web/pull/8" },
  });
  await fixture.renderer.rerender(<fixture.Harness threads={expanded} />);
  expect(fixture.result.attentionReferences).toHaveLength(2);
  expect(
    fixture.result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind),
  ).toContain("unresolved-feedback");
  await act(() =>
    fixture.result.setAttentionObservations(
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
  expect(
    fixture.result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind),
  ).toContain("unresolved-feedback");
  await fixture.renderer.rerender(<fixture.Harness threads={nativeThreads} />);
  expect(fixture.result.attentionReferences).toHaveLength(1);
  expect(
    fixture.result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind),
  ).toContain("unresolved-feedback");
  const pendingLink: ThreadPullRequestLink = {
    ...link,
    snapshot: { ...link.snapshot!, checksState: "pending" },
  };
  const metadataChanged = new Map(nativeThreads)
    .set(waiting.id, { ...waiting, pullRequests: [pendingLink] })
    .set(otherWaiting.id, { ...otherWaiting, pullRequests: [pendingLink] });
  await fixture.renderer.rerender(<fixture.Harness threads={metadataChanged} />);
  await act(() =>
    fixture.result.setAttentionObservations(
      new Map([
        [
          workbenchAttentionIdentity(environmentId, reference),
          getWorkbenchPullRequestAttention({
            reference: fixture.result.attentionReferences[0]!,
            summary: null,
            activity: null,
            loading: false,
            error: true,
          }),
        ],
      ]),
    ),
  );
  expect(fixture.result.attentionSignalsByTicket.get(ticket.id)).toContainEqual(
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
  await fixture.renderer.rerender(<fixture.Harness threads={closed} />);
  expect(fixture.result.attentionReferences).toHaveLength(0);
  expect(
    fixture.result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind),
  ).not.toContain("unresolved-feedback");
});
it("keeps inspection across equivalent rerenders and known attention while explicit refresh completes", async () => {
  await using fixture = setup();
  fixture.renderer = fixture.resources.use(await renderUI(<fixture.Harness />));
  expect(fixture.result.attentionInspectionsByTicket.get(ticket.id)?.[0]).toMatchObject({
    status: "loading",
    displayStatus: "loading",
    inspected: false,
  });
  const scope = fixture.result.attentionScope;
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
  await act(() => fixture.result.setAttentionObservations(observations));
  expect(fixture.result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.inspected).toBe(true);
  await fixture.renderer.rerender(<fixture.Harness />);
  expect(fixture.result.attentionScope).toBe(scope);
  expect(fixture.result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.inspected).toBe(true);
  expect(fixture.result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.status).toBe("complete");
  await act(() => fixture.result.refreshAttention());
  expect(fixture.result.attentionScope).not.toBe(scope);
  expect(fixture.result.attentionInspectionsByTicket.get(ticket.id)?.[0]).toMatchObject({
    status: "loading",
    displayStatus: "complete",
    inspected: false,
  });
  expect(
    fixture.result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind),
  ).toContain("failed-checks");
  await act(() => fixture.result.setAttentionObservations(new Map()));
  await act(() =>
    fixture.result.setAttentionObservations(
      new Map([
        [
          workbenchAttentionIdentity(environmentId, reference),
          getWorkbenchPullRequestAttention({
            reference,
            summary: null,
            activity: null,
            loading: true,
            error: false,
          }),
        ],
      ]),
    ),
  );
  expect(fixture.result.attentionInspectionsByTicket.get(ticket.id)?.[0]).toMatchObject({
    status: "loading",
    displayStatus: "complete",
    inspected: false,
  });
  expect(
    fixture.result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind),
  ).toContain("failed-checks");
  await act(() =>
    fixture.result.setAttentionObservations(
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
  expect(
    fixture.result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind),
  ).toContain("failed-checks");
  expect(fixture.result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.status).toBe(
    "unavailable",
  );
  expect(fixture.result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.displayStatus).toBe(
    "unavailable",
  );
  await act(() => fixture.result.refreshAttention());
  expect(fixture.result.attentionInspectionsByTicket.get(ticket.id)?.[0]).toMatchObject({
    status: "loading",
    displayStatus: "unavailable",
    inspected: false,
  });
  await act(() =>
    fixture.result.setAttentionObservations(
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
    fixture.result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind),
  ).not.toContain("failed-checks");
  expect(fixture.result.attentionInspectionsByTicket.get(ticket.id)?.[0]?.inspected).toBe(true);
  await act(() => fixture.result.setAttentionObservations(observations));
  expect(
    fixture.result.attentionSignalsByTicket.get(ticket.id)?.map((signal) => signal.kind),
  ).toContain("failed-checks");
  await fixture.renderer.rerender(
    <fixture.Harness environment={EnvironmentId.make("empty-environment")} />,
  );
  expect(fixture.result.attentionSignalsByTicket.get(ticket.id)).toEqual([]);
  expect(fixture.result.attentionInspectionsByTicket.get(ticket.id)).toEqual([]);
});
it("uses native server visits to clear questions and reacts to new requests rather than metadata", async () => {
  await using fixture = setup();
  const waitingRef = scopeThreadRef(environmentId, waiting.id);
  const waitingKey = scopedThreadKey(waitingRef);
  const threadSignals = () =>
    fixture.result.attentionSignalsByTicket
      .get(ticket.id)
      ?.filter(
        (signal) => signal.source.type === "thread" && signal.source.threadId === waiting.id,
      );
  fixture.renderer = fixture.resources.use(await renderUI(<fixture.Harness />));
  expect(threadSignals()?.map((signal) => signal.kind)).toEqual(["question"]);
  await fixture.renderer.rerender(<fixture.Harness activeThreadRef={waitingRef} />);
  expect(threadSignals()).toEqual([]);
  expect(useUiStateStore.getState().threadLastVisitedAtById[waitingKey]).toBeUndefined();
  const visited = new Map(threadsById).set(waiting.id, { ...waiting, lastVisitedAt: requestAt });
  await fixture.renderer.rerender(<fixture.Harness threads={visited} />);
  expect(threadSignals()).toEqual([]);
  const renamed = new Map(visited).set(waiting.id, {
    ...waiting,
    lastVisitedAt: requestAt,
    title: "Renamed",
    updatedAt: "2026-09-29T00:02:00.000Z",
  });
  await fixture.renderer.rerender(<fixture.Harness threads={renamed} />);
  expect(threadSignals()).toEqual([]);
  const secondAt = "2026-09-29T00:03:00.000Z";
  await act(async () =>
    fixture.registry.set(requestsAtom(waitingKey), {
      approvals: [],
      userInputs: [question("first-question"), question("second-question", secondAt)],
    }),
  );
  expect(threadSignals()?.map((signal) => signal.kind)).toEqual(["question"]);
  // A same-ID Thread in another environment cannot acknowledge this request.
  await fixture.renderer.rerender(
    <fixture.Harness
      threads={renamed}
      activeThreadRef={scopeThreadRef(EnvironmentId.make("remote"), waiting.id)}
    />,
  );
  expect(threadSignals()?.map((signal) => signal.kind)).toEqual(["question"]);
  await fixture.renderer.rerender(<fixture.Harness activeThreadRef={waitingRef} />);
  expect(threadSignals()).toEqual([]);
  expect(useUiStateStore.getState().threadLastVisitedAtById[waitingKey]).toBeUndefined();
  const visitedAgain = new Map(renamed).set(waiting.id, { ...waiting, lastVisitedAt: secondAt });
  await fixture.renderer.rerender(<fixture.Harness threads={visitedAgain} />);
  expect(threadSignals()).toEqual([]);
});
it("lets an explicit null server visit restore a question despite a newer local visit", async () => {
  await using fixture = setup();
  const waitingKey = scopedThreadKey(scopeThreadRef(environmentId, waiting.id));
  useUiStateStore.setState({
    threadLastVisitedAtById: { [waitingKey]: "2026-09-29T00:05:00.000Z" },
  });
  const visited = new Map(threadsById).set(waiting.id, { ...waiting, lastVisitedAt: requestAt });
  fixture.renderer = fixture.resources.use(await renderUI(<fixture.Harness threads={visited} />));
  const threadSignals = () =>
    fixture.result.attentionSignalsByTicket
      .get(ticket.id)
      ?.filter(
        (signal) => signal.source.type === "thread" && signal.source.threadId === waiting.id,
      );
  expect(threadSignals()).toEqual([]);
  const unread = new Map(visited).set(waiting.id, { ...waiting, lastVisitedAt: null });
  await fixture.renderer.rerender(<fixture.Harness threads={unread} />);
  expect(threadSignals()?.map((signal) => signal.kind)).toEqual(["question"]);
});
