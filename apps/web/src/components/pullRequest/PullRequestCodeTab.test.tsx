import {
  EnvironmentId,
  ProjectId,
  type PullRequestDetailView,
  type PullRequestReviewThread,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { act, type ReactNode, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
const { reply, refresh, queryRequests } = vi.hoisted(() => ({
  reply: vi.fn(),
  refresh: vi.fn(),
  queryRequests: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomRefresh: () => refresh }));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: () => DEFAULT_CLIENT_SETTINGS,
  useUpdateClientSettings: () => vi.fn(),
}));
vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("~/hooks/useLocalStorage", () => ({
  useLocalStorage: (_key: string, initial: boolean) => useState(initial),
}));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipPopup: () => null,
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "reply" ? reply : vi.fn()),
}));
vi.mock("~/state/pullRequests", () => ({
  pullRequestEnvironment: {
    diff: () => "diff",
    replyToThread: "reply",
    setThreadResolution: "resolve",
    updateComment: "edit",
    threadComments: "comments",
    diffFileContents: "contents",
    setFilesViewed: "viewed",
  },
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (query: unknown) => {
    queryRequests(query);
    return {
      data: null,
      isPending: false,
      error: query === "diff" ? "Diff unavailable" : null,
      refresh,
    };
  },
}));
vi.mock("./PullRequestMarkdown", () => ({
  PullRequestMarkdown: ({ text }: { text: string }) => <p>{text}</p>,
}));
vi.mock("./PullRequestReactions", () => ({ PullRequestReactionBar: () => null }));
vi.mock("../diffs/StyledDiffCodeView", () => ({ StyledDiffCodeView: () => null }));
vi.mock("../ui/toast", () => ({ toastManager: { add: vi.fn() } }));
import PullRequestCodeTab from "./PullRequestCodeTab";
const detail: PullRequestDetailView = {
  provider: "github",
  projectId: ProjectId.make("project"),
  projectTitle: "Project",
  workspaceRoot: "/workspace",
  repository: "owner/repo",
  number: 1,
  title: "Test pull request",
  body: "Original description",
  url: "https://github.com/owner/repo/pull/1",
  author: { login: "author", name: null, avatarUrl: null },
  viewer: "author",
  state: "open",
  isDraft: false,
  mergeability: "mergeable",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  headBranch: "feature",
  baseBranch: "main",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  mergedAt: null,
  closedAt: null,
  reviewers: [],
  labels: [],
  checks: [{ name: "Unit tests", status: "success", description: null, url: null }],
  comments: [],
  commentCount: 0,
  commentsTruncated: false,
  reviewThreads: [],
  commits: [],
  mergeCapabilities: { merge: false, squash: false, rebase: false },
  capabilities: {
    diff: true,
    comment: true,
    search: true,
    actions: [],
    mergeMethods: [],
    review: { inlineComment: false, reply: false, resolve: false, verdicts: [] },
    reviewers: { request: false, listCandidates: false },
    edit: { changeRequest: true, comment: true },
  },
  viewerPermissions: {
    actions: [],
    comment: true,
    resolve: false,
    verdicts: [],
    requestReviewers: false,
  },
};

const thread = (id: string, body: string): PullRequestReviewThread => ({
  id,
  path: "src/removed.ts",
  line: null,
  side: "right",
  isResolved: false,
  isOutdated: true,
  comments: [
    { id: `${id}-comment`, body, author: null, createdAt: "2026-09-01T00:00:00Z", url: null },
  ],
});
const target = thread("target", "Please handle the missing value");
const other = thread("other", "Different conversation");
const reference = {
  projectId: detail.projectId,
  repository: detail.repository,
  number: detail.number,
};
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reply.mockResolvedValue({ _tag: "Success", value: {} });
  refresh.mockClear();
  reply.mockClear();
  queryRequests.mockClear();
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});
function render(reviewThreadId: string, diff = true) {
  return (
    <PullRequestCodeTab
      environmentId={EnvironmentId.make("environment")}
      reference={reference}
      detail={{
        ...detail,
        reviewThreads: [target, other],
        capabilities: {
          ...detail.capabilities,
          diff,
          review: { ...detail.capabilities.review, reply: true },
        },
      }}
      selectedCommitOid={null}
      onSelectedCommitChange={() => {}}
      onRefresh={refresh}
      focus={{ kind: "review-thread", reviewThreadId }}
    />
  );
}
function text() {
  return renderer.root
    .findAllByType("p")
    .map((paragraph) => paragraph.children.join(""))
    .join("\n");
}
it.each([true, false])(
  "opens the exact off-diff conversation and replies through the native command with diff capability %s",
  async (diff) => {
    await act(async () => {
      renderer = create(render("target", diff));
    });
    expect(text()).toContain("Please handle the missing value");
    expect(text()).not.toContain("Different conversation");
    if (diff) expect(text()).toContain("Diff unavailable");
    else {
      expect(text()).toContain("This host does not provide a pull request diff");
      expect(queryRequests).not.toHaveBeenCalledWith("diff");
    }
    const replyButton = () =>
      renderer.root.findAllByType("button").find((button) => button.children.includes("Reply"))!;
    act(() => replyButton().props.onClick());
    act(() =>
      renderer.root.findByType("textarea").props.onChange({
        target: { value: "Handled in the next commit" },
        currentTarget: { value: "Handled in the next commit" },
        nativeEvent: {},
      }),
    );
    await act(async () => replyButton().props.onClick());
    expect(reply).toHaveBeenCalledWith({
      environmentId: "environment",
      input: { ...reference, threadId: "target", body: "Handled in the next commit" },
    });
    expect(refresh).toHaveBeenCalledOnce();
    await act(async () => renderer.update(render("other", diff)));
    expect(text()).toContain("Different conversation");
    expect(text()).not.toContain("Please handle the missing value");
  },
);
it("names an unavailable exact conversation instead of displaying another thread", async () => {
  await act(async () => {
    renderer = create(render("missing"));
  });
  expect(text()).toContain("This review conversation is not available in the current inspection");
  expect(text()).not.toContain("Please handle the missing value");
  expect(text()).not.toContain("Different conversation");
});
