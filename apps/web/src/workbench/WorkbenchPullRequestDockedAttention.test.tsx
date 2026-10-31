import { makeThreadFixture } from "../test-fixtures";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type PullRequestReviewThread,
  type WorkbenchSnapshot,
} from "@t3tools/contracts";
import { act } from "react";
import { RegistryContext } from "@effect/atom-react";
import { createAttentionNativeFixture } from "./workbenchAttention.testkit";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import { useWorkbenchAttentionData } from "./WorkbenchAttentionProvider";
import {
  useOpenWorkbenchPullRequest,
  WorkbenchPullRequestPreviewProvider,
} from "./WorkbenchPullRequestPreview";

let native: ReturnType<typeof createAttentionNativeFixture>;
const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("repo");
const threadId = ThreadId.make("reading");
const workspaceId = WorkbenchProjectId.make("workspace");
const ticketId = WorkbenchTicketId.make("ticket");
const timestamp = "2026-09-30T00:00:00.000Z";
const reference = {
  projectId,
  repository: "acme/web",
  number: 7,
  url: "https://github.com/acme/web/pull/7",
};
const snapshot: WorkbenchSnapshot = {
  references: [],
  projects: [
    {
      id: workspaceId,
      title: "Workspace",
      linkedProjectIds: [projectId],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  epics: [],
  tickets: [
    {
      id: ticketId,
      projectId: workspaceId,
      title: "Review invitations",
      kind: "story",
      markdown: "",
      epicId: null,
      primaryT3ProjectId: projectId,
      repositoryProjectIds: [],
      status: "in_progress",
      blocked: false,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  assignments: [
    {
      id: WorkbenchAssignmentId.make("assignment"),
      ticketId,
      threadId,
      createdAt: timestamp,
      supersededAt: null,
    },
  ],
  reservedThreadIds: [],
  threadRecaps: [],
  ticketWorkspaces: [],
};
const shells: EnvironmentThreadShell[] = [
  makeThreadFixture({
    id: threadId,
    environmentId,
    projectId,
    title: "Invite teammates",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    latestRun: null,
    runtime: null,
    pullRequests: [],
    linkedPullRequest: reference,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  }),
];
vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({
    pathname: "/local/thread/reading",
    href: "/local/thread/reading?workbench=true",
  }),
  useSearch: () => ({ workbench: true }),
  useParams: ({
    select,
  }: {
    select: (params: { environmentId: string; threadId: string }) => unknown;
  }) => select({ environmentId: "local", threadId: "reading" }),
}));
vi.mock("../state/entities", () => ({ useThreadShells: () => shells }));
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => environmentId }));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    snapshot: () => ({ kind: "snapshot" }),
    pullRequestViewer: (target: Parameters<typeof native.viewerQuery>[0]) =>
      native.viewerQuery(target),
  },
}));
vi.mock("../state/pullRequests", () => ({
  linkedPullRequestDetailAtom: (target: Parameters<typeof native.summaryQuery>[0]) =>
    native.summaryQuery(target),
  pullRequestEnvironment: {
    activity: (target: Parameters<typeof native.activityQuery>[0]) => native.activityQuery(target),
  },
  sharedPullRequestSummaryAtom: (...args: Parameters<typeof native.sharedSummary>) =>
    native.sharedSummary(...args),
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: (target: { kind: string } | null) => ({ data: target ? snapshot : null }),
}));

function TicketAttention() {
  const attention = useWorkbenchAttentionData();
  const open = useOpenWorkbenchPullRequest();
  const signals = attention.attentionSignalsByTicket.get(ticketId) ?? [];
  const unresolved = signals.find((signal) => signal.kind === "unresolved-feedback");
  return (
    <>
      <output aria-label="Unresolved discussions">
        {unresolved?.kind === "unresolved-feedback" ? unresolved.unresolvedReviewThreads.length : 0}
      </output>
      <output aria-label="Needs attention">{signals.length > 0 ? "yes" : "no"}</output>
      <button onClick={() => open?.({ environmentId, reference })}>Open pull request</button>
    </>
  );
}

it("clears resolved discussion attention after closing the docked PR without a metadata change", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native = createAttentionNativeFixture();
  const reviewThreads: PullRequestReviewThread[] = [
    {
      id: "review-discussion",
      path: "src/invitations.ts",
      line: 12,
      side: "right",
      isResolved: false,
      isOutdated: false,
      comments: [],
    },
  ];
  const target = {
    environmentId,
    input: {
      projectId,
      repository: reference.repository,
      number: reference.number,
      host: "github.com",
    },
  };
  const input = {
    reference,
    summary: {
      state: "open" as const,
      checksState: "passing" as const,
      reviewDecision: "approved" as const,
    },
    activity: { reviewThreads, commentsTruncated: false },
    loading: false,
    error: false,
  };
  native.stage(target, input);
  const threadRef = scopeThreadRef(environmentId, threadId);
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(
        <RegistryContext.Provider value={native.registry}>
          <WorkbenchPullRequestPreviewProvider>
            <TicketAttention />
          </WorkbenchPullRequestPreviewProvider>
        </RegistryContext.Provider>,
      );
    });
    expect(renderer?.root.findByProps({ "aria-label": "Unresolved discussions" }).children).toEqual(
      ["1"],
    );
    expect(renderer?.root.findByProps({ "aria-label": "Needs attention" }).children).toEqual([
      "yes",
    ]);
    expect(native.active.size).toBe(0);
    await act(() => renderer?.root.findByType("button").props.onClick());
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef),
    ).toMatchObject({ kind: "pull-request", number: 7 });
    native.stage(target, {
      ...input,
      activity: {
        commentsTruncated: false,
        reviewThreads: reviewThreads.map((thread) => ({ ...thread, isResolved: true })),
      },
    });
    expect(renderer?.root.findByProps({ "aria-label": "Unresolved discussions" }).children).toEqual(
      ["1"],
    );
    await act(() => useRightPanelStore.getState().close(threadRef));
    await act(async () =>
      native.publish(target, {
        ...input,
        activity: {
          commentsTruncated: false,
          reviewThreads: reviewThreads.map((thread) => ({ ...thread, isResolved: true })),
        },
      }),
    );
    expect(renderer?.root.findByProps({ "aria-label": "Unresolved discussions" }).children).toEqual(
      ["0"],
    );
    expect(renderer?.root.findByProps({ "aria-label": "Needs attention" }).children).toEqual([
      "no",
    ]);
    expect(native.active.size).toBe(0);
  } finally {
    await act(() => renderer?.unmount());
    native.registry.dispose();
    useRightPanelStore.setState({ byThreadKey: {} });
    vi.unstubAllGlobals();
  }
});
