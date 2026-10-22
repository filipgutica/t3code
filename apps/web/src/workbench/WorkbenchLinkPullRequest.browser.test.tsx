import { makeThreadFixture } from "../test-fixtures";
import { type ReactNode } from "react";
import { act, render, type Screen } from "../../test/render";
import { page } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchTicketId,
  type WorkbenchAssignment,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { WorkbenchLinkPullRequest } from "./WorkbenchLinkPullRequest";

const observed = vi.hoisted(() => ({
  mode: "multiple",
  phase: "connected",
  canLinkAny: true,
}));
vi.mock("./WorkbenchPullRequestPicker", () => ({
  WorkbenchPullRequestPicker: ({ thread }: { thread: EnvironmentThreadShell }) => (
    <div data-picker-thread={thread.id} />
  ),
}));
vi.mock("../hooks/usePullRequestLinking", () => ({
  usePullRequestLinking: () => ({ mode: observed.mode, canLinkAny: observed.canLinkAny }),
}));
vi.mock("../state/environments", () => ({
  useEnvironment: () => ({ connection: { phase: observed.phase } }),
}));
vi.mock("../components/ui/dialog", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Container,
    DialogPopup: Container,
    DialogHeader: Container,
    DialogTitle: Container,
    DialogDescription: Container,
    DialogPanel: Container,
    DialogFooter: Container,
  };
});
vi.mock("../components/ui/tooltip", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Tooltip: Container,
    TooltipTrigger: ({ children, render }: { children?: ReactNode; render?: ReactNode }) => (
      <>
        {render}
        {children}
      </>
    ),
    TooltipPopup: ({ children }: { children?: ReactNode }) => <div role="tooltip">{children}</div>,
  };
});
const environmentId = EnvironmentId.make("local-link-test");
const ticketId = WorkbenchTicketId.make("link-ticket");
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
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
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
const assignment = (id: string): WorkbenchAssignment => ({
  id: WorkbenchAssignmentId.make(id),
  ticketId,
  threadId: ThreadId.make(id),
  supersededAt: null,
  createdAt: "2026-09-27T00:00:00.000Z",
});
const one = thread("first");
const two = thread("second");
const props = {
  environmentId,
  ticketId,
  assignments: [assignment("first")],
  threadsById: new Map([[one.id, one]]),
};
const button = (screen: Screen, text: string) =>
  Array.from(screen.container.querySelectorAll<HTMLButtonElement>("button")).find(
    (node) => node.textContent?.trim() === text,
  )!;
const pickerThreads = (screen: Screen) =>
  Array.from(screen.container.querySelectorAll("[data-picker-thread]"), (node) =>
    node.getAttribute("data-picker-thread"),
  );
function setup() {
  observed.mode = "multiple";
  observed.phase = "connected";
  observed.canLinkAny = true;
}

describe("Ticket PR linking", () => {
  it("opens the PR picker for the sole eligible Thread in the Ticket's environment", async () => {
    setup();
    await using screen = await render(
      <WorkbenchLinkPullRequest
        {...props}
        assignments={[
          ...props.assignments,
          assignment("missing"),
          { ...assignment("second"), supersededAt: "2026-09-27T00:00:01.000Z" },
        ]}
        threadsById={
          new Map([
            [one.id, one],
            [two.id, two],
          ])
        }
      />,
    );
    expect(button(screen, "Link PR").disabled).toBe(false);
    await act(() => button(screen, "Link PR").click());
    expect(pickerThreads(screen)).toEqual([one.id]);
  });
  it("requires an explicit Thread choice when multiple live Threads are eligible", async () => {
    setup();
    await using screen = await render(
      <WorkbenchLinkPullRequest
        {...props}
        assignments={[assignment("first"), assignment("second")]}
        threadsById={
          new Map([
            [one.id, { ...one, title: "Same title" }],
            [two.id, { ...two, title: "Same title" }],
          ])
        }
      />,
    );
    await act(() => button(screen, "Link PR").click());
    expect(pickerThreads(screen)).toEqual([]);
    await screen.getByRole("combobox").click();
    await expect
      .element(page.getByRole("option", { name: "Same title · source checkout · first" }))
      .toBeVisible();
    const labels = Array.from(document.querySelectorAll('[role="option"]'), (node) =>
      node.textContent?.trim(),
    );
    expect(labels).toContain("Same title · source checkout · first");
    expect(labels).toContain("Same title · source checkout · second");
    expect(button(screen, "Continue").disabled).toBe(true);
    await page.getByRole("option", { name: "Same title · source checkout · second" }).click();
    await act(() => button(screen, "Continue").click());
    expect(pickerThreads(screen)).toEqual([two.id]);
  });
  it.each(["missing", "archived", "settled", "foreign", "unsupported", "offline", "no-host"])(
    "explains why linking is unavailable for %s",
    async (reason) => {
      setup();
      if (reason === "unsupported") observed.mode = "unsupported";
      if (reason === "offline") observed.phase = "offline";
      if (reason === "no-host") observed.canLinkAny = false;
      const target =
        reason === "archived"
          ? { ...one, archivedAt: "2026-09-27T00:00:00.000Z" }
          : reason === "settled"
            ? { ...one, settledOverride: "settled" as const }
            : reason === "foreign"
              ? { ...one, environmentId: EnvironmentId.make("remote") }
              : one;
      await using screen = await render(
        <WorkbenchLinkPullRequest
          {...props}
          threadsById={reason === "missing" ? new Map() : new Map([[one.id, target]])}
        />,
      );
      expect(button(screen, "Link PR").disabled).toBe(true);
      expect(screen.container.querySelectorAll('[role="tooltip"]').length).toBeGreaterThan(0);
      expect(
        screen.container.querySelectorAll('button[aria-label="Why Link PR is unavailable"]'),
      ).toHaveLength(1);
      if (reason === "no-host")
        expect(screen.container.querySelector('[role="tooltip"]')!.textContent).toContain(
          "supported Git remote",
        );
      await act(() => button(screen, "Link PR").click());
      expect(pickerThreads(screen)).toEqual([]);
    },
  );
});
