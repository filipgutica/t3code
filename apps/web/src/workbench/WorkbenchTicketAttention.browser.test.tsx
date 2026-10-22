import { page } from "vite-plus/test/browser";
import { act, render as renderBrowser } from "../../test/render";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchTicketId,
  type PullRequestReviewThread,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import type { WorkbenchAttentionSignal } from "./workbenchAttention.logic";
import {
  WorkbenchThreadAttentionBadge,
  WorkbenchTicketAttentionBadge,
} from "./WorkbenchTicketAttention";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openPullRequest: vi.fn(),
  signals: [] as WorkbenchAttentionSignal[],
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => mocks.navigate,
}));
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
async function setup() {
  vi.clearAllMocks();
  mocks.signals = [
    { kind: "unresolved-feedback", source, unresolvedReviewThreads: [discussion] },
    { kind: "changes-requested", source, unresolvedReviewThreads: [] },
    { kind: "failed-checks", source, unresolvedReviewThreads: [] },
  ];
  // Navigation is mocked at the owning feature boundary, so this suite supplies no router.
  return renderBrowser(null, { router: false });
}

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
    await using context = await setup();
    await act(async () =>
      context.rerender(
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
    await page.elementLocator(trigger).click();
    expect(button("Checks failed").textContent).toContain("View checks");
    expect(button("Changes requested").textContent).toContain("View review");
    expect(button("1 unresolved thread").textContent).toContain("View threads");
    await page.elementLocator(button(label)).click();
    expect(mocks.openPullRequest).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      reference: {
        projectId: row.pullRequest.projectId,
        repository: row.pullRequest.repository,
        number: row.pullRequest.number,
        host: "github.com",
      },
      linkedThread: { threadId, title: "Review settings", onOpen: expect.any(Function) },
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  },
);

it("keeps the native status in the slot, counts other reasons, and opens the owning remote Thread", async () => {
  await using context = await setup();
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
    context.rerender(
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
  await page.elementLocator(trigger).click();
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
    "Plan ready for review",
  );
  await page.elementLocator(button("Agent replied")).click();
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId },
    search: { workbench: true },
  });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("keeps the card reachable when the native status already shows the only reason", async () => {
  await using context = await setup();
  mocks.signals = [{ kind: "question", source: threadSource }];
  await act(async () =>
    context.rerender(
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
  await page.elementLocator(trigger).click();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Input needed");
});

it("leaves a plain native status when no reason needs attention", async () => {
  await using context = await setup();
  mocks.signals = [];
  await act(async () =>
    context.rerender(
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
  expect(context.container.querySelector("button")).toBeNull();
  expect(context.container.textContent).toBe("Working");
});
