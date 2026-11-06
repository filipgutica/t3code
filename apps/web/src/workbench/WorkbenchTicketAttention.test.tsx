// @vitest-environment jsdom

import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchTicketId,
  type PullRequestReviewThread,
} from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { WorkbenchAttentionSignal } from "./workbenchAttention.logic";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";
import {
  WorkbenchThreadAttentionBadge,
  WorkbenchTicketAttentionBadge,
} from "./WorkbenchTicketAttention";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openPullRequest: vi.fn(),
  signals: [] as WorkbenchAttentionSignal[],
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("./WorkbenchAttentionProvider", () => ({
  useWorkbenchAttentionData: () => ({
    attentionSignalsByTicket: new Map([[ticketId, mocks.signals]]),
  }),
}));
vi.mock("./WorkbenchPullRequestPreview", () => ({
  useOpenWorkbenchPullRequest: () => mocks.openPullRequest,
}));

const environmentId = EnvironmentId.make("remote-environment");
const ticketId = WorkbenchTicketId.make("ticket");
const threadId = ThreadId.make("review-thread");
const threadSource = { type: "thread", threadId, threadTitle: "Review settings" } as const;
const row = {
  threadId,
  threadTitle: "Review settings",
  pullRequest: {
    projectId: ProjectId.make("repository"),
    repository: "acme/settings",
    number: 7,
    url: "https://github.com/acme/settings/pull/7",
    title: "Settings review",
  },
};
const source = { type: "pull-request", row } as const;
const discussion: PullRequestReviewThread = {
  id: "review-discussion",
  path: "src/settings.ts",
  line: 12,
  side: "right",
  isResolved: false,
  isOutdated: true,
  comments: [],
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  useWorkbenchFloatingChatStore.setState({ pageChat: null });
  mocks.signals = [
    { kind: "unresolved-feedback", source, unresolvedReviewThreads: [discussion] },
    { kind: "changes-requested", source, unresolvedReviewThreads: [] },
    { kind: "failed-checks", source, unresolvedReviewThreads: [] },
  ];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const button = (label: string) => {
  const buttons = [...document.querySelectorAll("button")];
  const target =
    buttons.find((candidate) => candidate.getAttribute("aria-label")?.startsWith(label)) ??
    buttons.find((candidate) => candidate.textContent?.includes(label));
  if (!target) throw new Error(`Missing button: ${label}`);
  return target;
};

it.each(["Checks failed", "Changes requested", "1 unresolved thread"])(
  "opens %s in the PR panel of the selected environment",
  async (label) => {
    await act(async () =>
      root.render(
        <WorkbenchTicketAttentionBadge
          environmentId={environmentId}
          ticketId={ticketId}
          ticketTitle="Settings"
        />,
      ),
    );
    const trigger = button("Settings needs attention: Checks failed, Feedback");
    expect(trigger.textContent).toBe(
      "Checks failed+1, Settings needs attention: Checks failed, Feedback",
    );
    trigger.focus();
    await act(async () => trigger.click());
    expect(button("Checks failed").textContent).toContain("View checks");
    expect(button("Changes requested").textContent).toContain("View review");
    expect(button("1 unresolved thread").textContent).toContain("View threads");
    await act(async () => button(label).click());
    expect(mocks.openPullRequest).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      reference: {
        projectId: row.pullRequest.projectId,
        repository: row.pullRequest.repository,
        number: row.pullRequest.number,
        host: "github.com",
      },
      ...(label === "1 unresolved thread" ? { initialTab: "code" } : {}),
      linkedThread: { threadId, title: "Review settings", onOpen: expect.any(Function) },
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  },
);

it.each([
  { chat: "no", chatTicketId: null, shows: false },
  { chat: "another Ticket's", chatTicketId: WorkbenchTicketId.make("other"), shows: false },
  { chat: "this Ticket's", chatTicketId: ticketId, shows: true },
])(
  "keeps the native status in the slot, counts other reasons, and opens the owning remote Thread with $chat chat on screen",
  async ({ chatTicketId, shows }) => {
    const showThread = vi.fn();
    useWorkbenchFloatingChatStore.setState({
      pageChat:
        chatTicketId === null
          ? null
          : { kind: "ticket", environmentId, ticketId: chatTicketId, showThread },
    });
    mocks.signals = [
      { kind: "question", source: threadSource },
      { kind: "reply", source: threadSource },
      {
        kind: "waiting",
        cause: "plan",
        source: { ...threadSource, threadId: ThreadId.make("another") },
      },
    ];
    await act(async () =>
      root.render(
        <WorkbenchThreadAttentionBadge
          environmentId={environmentId}
          ticketId={ticketId}
          threadId={threadId}
          threadTitle="Review settings"
          nativeStatusKind="input"
          nativeStatus={<span>Input</span>}
        />,
      ),
    );
    const trigger = button("Review settings needs attention: Input, Done");
    expect(trigger.textContent).toBe("Input+1, Review settings needs attention: Input, Done");
    await act(async () => trigger.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
      "Plan ready for review",
    );
    const reply = button("Agent replied");
    expect(reply.textContent).toContain(shows ? "Show in chat" : "Open Thread");
    await act(async () => reply.click());
    if (shows) {
      expect(showThread).toHaveBeenCalledExactlyOnceWith(threadId);
      expect(mocks.navigate).not.toHaveBeenCalled();
    } else {
      expect(showThread).not.toHaveBeenCalled();
      expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId },
      });
    }
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  },
);

it("keeps the card reachable when the native status already shows the only reason", async () => {
  mocks.signals = [{ kind: "question", source: threadSource }];
  await act(async () =>
    root.render(
      <WorkbenchThreadAttentionBadge
        environmentId={environmentId}
        ticketId={ticketId}
        threadId={threadId}
        threadTitle="Review settings"
        nativeStatusKind="input"
        nativeStatus={<span>Input</span>}
      />,
    ),
  );
  const trigger = button("Review settings needs attention: Input");
  expect(trigger.textContent).toBe("Input, Review settings needs attention: Input");
  await act(async () => trigger.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Input needed");
});

it("lets a Ticket's Working status yield to a reason that needs the user, like a native folder", async () => {
  mocks.signals = [{ kind: "reply", source: threadSource }];
  await act(async () =>
    root.render(
      <WorkbenchTicketAttentionBadge
        environmentId={environmentId}
        ticketId={ticketId}
        ticketTitle="Settings"
        nativeStatusKind="working"
        nativeStatus={<span>Working</span>}
      />,
    ),
  );
  expect(button("Settings needs attention: Done").textContent).toBe(
    "Done, Settings needs attention: Done",
  );
});

it("leaves a plain native status when no reason needs attention", async () => {
  mocks.signals = [];
  await act(async () =>
    root.render(
      <WorkbenchThreadAttentionBadge
        environmentId={environmentId}
        ticketId={ticketId}
        threadId={threadId}
        threadTitle="Review settings"
        nativeStatusKind="working"
        nativeStatus={<span>Working</span>}
      />,
    ),
  );
  expect(container.querySelector("button")).toBeNull();
  expect(container.textContent).toBe("Working");
});
