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

import type {
  WorkbenchAttentionInspection,
  WorkbenchAttentionSignal,
} from "./workbenchAttention.logic";
import {
  WorkbenchThreadAttentionBadge,
  WorkbenchTicketAttentionBadge,
} from "./WorkbenchTicketAttention";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openPullRequest: vi.fn(),
  signals: [] as WorkbenchAttentionSignal[],
  inspections: [] as WorkbenchAttentionInspection[],
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("./WorkbenchAttentionProvider", () => ({
  useWorkbenchAttentionData: () => ({
    attentionSignalsByTicket: new Map([[ticketId, mocks.signals]]),
    attentionInspectionsByTicket: new Map([[ticketId, mocks.inspections]]),
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
  mocks.inspections = [
    { row, status: "unavailable", displayStatus: "incomplete", inspected: false },
  ];
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
  const target = [...document.querySelectorAll("button")].find((candidate) =>
    candidate.getAttribute("aria-label")?.startsWith(label),
  );
  if (!target) throw new Error(`Missing button: ${label}`);
  return target;
};

it.each([
  "Failed checks",
  "Changes requested",
  "Unresolved feedback",
  "Open review discussion at src/settings.ts:12",
])("opens %s in the PR panel of the selected environment", async (label) => {
  await act(async () =>
    root.render(
      <WorkbenchTicketAttentionBadge
        environmentId={environmentId}
        ticketId={ticketId}
        ticketTitle="Settings"
        compact
      />,
    ),
  );
  const trigger = button("Needs attention, 3 items for Settings");
  trigger.focus();
  await act(async () => trigger.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Inspection incomplete");
  expect(button("Failed checks").textContent).toContain("View checks");
  expect(button("Changes requested").textContent).toContain("View changes");
  await act(async () => button(label).click());
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
});

it("opens the owning remote Thread and counts the remaining notification after suppressing its current Input status", async () => {
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
        statusKind="input"
        compact
      />,
    ),
  );
  const trigger = button("Needs attention, 1 item for Review settings: Agent replied");
  expect(trigger.textContent).toBe("");
  await act(async () => trigger.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
    "Waiting for your answer",
  );
  await act(async () => button("Agent replied").click());
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId },
    search: { workbench: true },
  });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});
