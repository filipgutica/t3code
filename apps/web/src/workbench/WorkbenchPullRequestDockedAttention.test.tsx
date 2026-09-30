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
import { act, useCallback, useEffect, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import { useWorkbenchAttentionData } from "./WorkbenchAttentionProvider";
import {
  useOpenWorkbenchPullRequest,
  WorkbenchPullRequestPreviewProvider,
} from "./WorkbenchPullRequestPreview";

const native = vi.hoisted(() => ({
  active: new Set<string>(),
  summary: { state: "open", checksState: "passing", reviewDecision: "approved" },
  reviewThreads: [] as PullRequestReviewThread[],
}));
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
  ticketWorkspaces: [],
};
const shells: EnvironmentThreadShell[] = [
  {
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
    latestTurn: null,
    session: null,
    pullRequests: [],
    linkedPullRequest: reference,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  },
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
vi.mock("./state", () => ({ workbenchEnvironment: { snapshot: () => ({ kind: "snapshot" }) } }));
vi.mock("../state/pullRequests", () => ({
  linkedPullRequestDetailAtom: () => ({ kind: "summary" }),
  pullRequestEnvironment: { activity: () => ({ kind: "activity" }) },
  useSharedPullRequestSummary: (_environment: unknown, _input: unknown, data: unknown) => data,
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: (target: { kind: string } | null) => {
    if (!target || target.kind === "snapshot") return { data: target ? snapshot : null };
    const { kind } = target;
    const read = () => ({
      data:
        kind === "summary"
          ? native.summary
          : { reviewThreads: native.reviewThreads, commentsTruncated: false },
      resultIdentity: {},
    });
    const [result, setResult] = useState(read);
    const refresh = useCallback(() => setResult(read()), [kind]);
    useEffect(() => {
      native.active.add(kind);
      return () => {
        native.active.delete(kind);
      };
    }, [kind]);
    return {
      ...result,
      dataUpdatedAt: 1,
      error: null,
      isPending: false,
      isSuccess: true,
      refresh,
    };
  },
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
  native.active.clear();
  native.reviewThreads = [
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
  const threadRef = scopeThreadRef(environmentId, threadId);
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(
        <WorkbenchPullRequestPreviewProvider>
          <TicketAttention />
        </WorkbenchPullRequestPreviewProvider>,
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
    native.reviewThreads = native.reviewThreads.map((thread) => ({ ...thread, isResolved: true }));
    expect(renderer?.root.findByProps({ "aria-label": "Unresolved discussions" }).children).toEqual(
      ["1"],
    );
    await act(() => useRightPanelStore.getState().close(threadRef));
    expect(renderer?.root.findByProps({ "aria-label": "Unresolved discussions" }).children).toEqual(
      ["0"],
    );
    expect(renderer?.root.findByProps({ "aria-label": "Needs attention" }).children).toEqual([
      "no",
    ]);
    expect(native.active.size).toBe(0);
  } finally {
    await act(() => renderer?.unmount());
    useRightPanelStore.setState({ byThreadKey: {} });
    vi.unstubAllGlobals();
  }
});
