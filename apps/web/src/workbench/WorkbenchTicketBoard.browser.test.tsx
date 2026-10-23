import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import type { DndContext, DragEndEvent } from "@dnd-kit/core";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { act, render } from "../../test/render";
import type { Project } from "../types";
import { WorkbenchTicketBoard } from "./WorkbenchTicketBoard";
import * as attentionProvider from "./WorkbenchAttentionProvider";

const mocks = vi.hoisted(() => ({
  resizeBoard: () => {},
  dragContext: null as ComponentProps<typeof DndContext> | null,
}));
vi.mock("../hooks/useMediaQuery", () => ({ useMediaQuery: () => true }));
vi.mock("../lib/observeResize", () => ({
  observeResize: (_element: Element, callback: () => void) => {
    mocks.resizeBoard = callback;
    return () => {};
  },
}));
// DndContext is the external event boundary; keep its real provider and capture its public callbacks.
vi.mock(import("@dnd-kit/core"), async (original) => {
  const actual = await original();
  const { memo, useEffect } = await import("react");
  return {
    ...actual,
    DndContext: memo((props: ComponentProps<typeof actual.DndContext>) => {
      useEffect(() => {
        mocks.dragContext = props;
        return () => {
          if (mocks.dragContext === props) mocks.dragContext = null;
        };
      }, [props]);
      return <actual.DndContext {...props} />;
    }),
  };
});
// Attention is supplied by the host. Keep the board's fixture independent of its PR query graph.
vi.mock("./WorkbenchAttentionProvider", () => ({
  WorkbenchAttentionProvider: ({ children }: { children: ReactNode }) => children,
  useWorkbenchAttentionData: vi.fn(),
}));
vi.mock("../state/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/query")>()),
  useEnvironmentQuery: () => ({ data: null, error: null, isPending: false }),
}));
vi.mock("../state/pullRequests", () => ({
  linkedPullRequestDetailAtom: () => null,
  pullRequestEnvironment: { activity: () => null },
  useSharedPullRequestSummary: () => null,
  usePullRequestList: () => ({ data: null, isPending: false, error: null, refresh: vi.fn() }),
}));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    jiraGetTicketTransitions: () => null,
    snapshot: () => Atom.make(null),
    ticketPreparations: () => Atom.make(null),
    discardTicketDraftInBatch: { permissionAtom: () => Atom.make(true) },
  },
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("./WorkbenchTicketStatusMenu", () => ({ WorkbenchTicketStatusMenu: () => null }));

const ticket = (title: string): WorkbenchTicket => ({
  id: WorkbenchTicketId.make(title),
  projectId: WorkbenchProjectId.make("remount-workspace"),
  epicId: null,
  title,
  kind: "story",
  markdown: "",
  primaryT3ProjectId: ProjectId.make("repo"),
  repositoryProjectIds: [],
  status: "todo",
  blocked: false,
  revision: 0,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
});
const repository = (id: string): Project => ({
  id: ProjectId.make(id),
  environmentId: EnvironmentId.make("remount-local"),
  title: id,
  workspaceRoot: `/tmp/${id}`,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
});
const repositories = [repository("repo"), repository("secondary")];
const props: ComponentProps<typeof WorkbenchTicketBoard> = {
  environmentId: EnvironmentId.make("remount-local"),
  projectId: WorkbenchProjectId.make("remount-workspace"),
  tickets: [ticket("Welcome"), ticket("Billing")],
  epics: [],
  groupMode: "none",
  viewControls: null,
  mirrorColumns: null,
  jiraConnected: false,
  openJiraIssueTicket: () => undefined,
  jiraStatusMappings: [],
  jiraIssueLinksByTicketId: new Map(),
  activeJiraTicketIds: new Set(),
  selectedTicketId: null,
  repositoryProjectIds: repositories.map((repository) => repository.id),
  repositoriesReady: true,
  repositoriesById: new Map(repositories.map((project) => [project.id, project])),
  assignmentsByTicket: new Map(),
  assignments: [],
  threadsById: new Map(),
  archivedThreadsById: new Map(),
  threadLookupReady: true,
  pending: false,
  pendingAction: null,
  pendingTicketIds: new Set(),
  onSelect: vi.fn(),
  onSelectEpic: vi.fn(),
  onMove: vi.fn(),
  onRegenerateSummary: vi.fn(),
  onOpenThread: vi.fn(),
  onCreateTicket: vi.fn(),
  onJiraTransition: vi.fn(),
};

async function setup() {
  mocks.resizeBoard = () => {};
  mocks.dragContext = null;
  vi.mocked(attentionProvider.useWorkbenchAttentionData).mockReturnValue({
    attentionRefresh: 0,
    refreshAttention: vi.fn(),
    attentionReferences: [],
    attentionScope: "",
    setAttentionObservations: vi.fn(),
    attentionReasonsByTicket: new Map(),
    attentionSignalsByTicket: new Map(),
    attentionInspectionsByTicket: new Map(),
    attentionCoverage: "0 of 0 linked PRs inspected",
  });
  const originalFontSize = document.documentElement.style.fontSize;
  document.documentElement.style.fontSize = "16px";
  const resources = new AsyncDisposableStack();
  resources.defer(() => {
    document.documentElement.style.fontSize = originalFontSize;
  });
  try {
    const screen = resources.use(await render(null));
    screen.container.style.width = "1024px";
    screen.container.style.height = "800px";
    const renderBoard = (overrides: Partial<typeof props> = {}) =>
      screen.rerender(<WorkbenchTicketBoard {...props} {...overrides} />);
    return {
      screen,
      renderBoard,
      articles: () => [...screen.container.querySelectorAll("article")],
      titles: () =>
        [...screen.container.querySelectorAll("article h3")].map((node) => node.textContent),
      resize: (width: number) =>
        act(() => {
          screen.container.style.width = `${width}px`;
          mocks.resizeBoard();
        }),
      remount: async (overrides: Partial<typeof props> = {}) => {
        await screen.rerender(null);
        await renderBoard(overrides);
      },
      [Symbol.asyncDispose]: () => resources.disposeAsync(),
    };
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
}

async function selectRepository(name: string) {
  await page.getByRole("combobox", { name: "Filter by repository" }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

describe("Workbench Board view", () => {
  it.each([12, 16, 20])(
    "gates dragging at 48rem with a %ipx root and respects archive",
    async (rootFontSize) => {
      await using context = await setup();
      document.documentElement.style.fontSize = `${rootFontSize}px`;
      const onMove = vi.fn();
      const active = props.tickets[0]!;
      const drop: DragEndEvent = {
        activatorEvent: new Event("mousedown"),
        active: {
          id: active.id,
          data: { current: undefined },
          rect: { current: { initial: null, translated: null } },
        },
        over: {
          id: JSON.stringify([null, "in_progress"]),
          data: { current: undefined },
          rect: { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 },
          disabled: false,
        },
        collisions: [],
        delta: { x: 0, y: 0 },
      };
      await context.renderBoard({ onMove });
      await act(() => mocks.dragContext?.onDragStart?.(drop));
      await context.renderBoard({ onMove, readOnly: true });
      await act(() => mocks.dragContext?.onDragEnd?.(drop));
      expect(onMove).not.toHaveBeenCalled();
      await context.renderBoard({ onMove });
      await act(() => mocks.dragContext?.onDragEnd?.(drop));
      expect(onMove).toHaveBeenCalledExactlyOnceWith(active, "in_progress");
      onMove.mockClear();
      await context.resize(48 * rootFontSize - 1);
      await act(() => mocks.dragContext?.onDragEnd?.(drop));
      expect(onMove).not.toHaveBeenCalled();
      await context.resize(48 * rootFontSize);
      await act(() => mocks.dragContext?.onDragEnd?.(drop));
      expect(onMove).toHaveBeenCalledExactlyOnceWith(active, "in_progress");
      onMove.mockClear();
      await act(() => {
        document.documentElement.style.fontSize = `${rootFontSize + 1}px`;
      });
      await act(() => mocks.dragContext?.onDragEnd?.(drop));
      expect(onMove).not.toHaveBeenCalled();
      await act(() => {
        document.documentElement.style.fontSize = `${rootFontSize}px`;
      });
      await act(() => mocks.dragContext?.onDragEnd?.(drop));
      expect(onMove).toHaveBeenCalledExactlyOnceWith(active, "in_progress");
    },
  );
  it("offers Thread creation for unfinished cards and hides it after completion", async () => {
    await using context = await setup();
    const onOpenThread = vi.fn();
    const active = ticket("Unassigned");
    await context.renderBoard({ tickets: [active], onOpenThread });
    await context.screen.getByRole("button", { name: "Create Thread for Unassigned" }).click();
    expect(onOpenThread).toHaveBeenCalledExactlyOnceWith(active, undefined);
    await context.renderBoard({ tickets: [{ ...active, status: "done" }], onOpenThread });
    expect(
      context.screen.container.querySelector('[aria-label="Create Thread for Unassigned"]'),
    ).toBeNull();
    await context.renderBoard({ tickets: [active], onOpenThread });
    await expect
      .element(context.screen.getByRole("button", { name: "Create Thread for Unassigned" }))
      .toBeVisible();
  });
  it("keeps the search and matching Tickets when returning from Ticket detail", async () => {
    await using context = await setup();
    await context.renderBoard();
    await context.screen.getByRole("textbox", { name: "Search tickets" }).fill("welcome");
    await vi.waitFor(() => expect(context.articles()).toHaveLength(1));
    await context.remount();
    await expect
      .element(context.screen.getByRole("textbox", { name: "Search tickets" }))
      .toHaveValue("welcome");
    expect(context.articles()).toHaveLength(1);
  });
  it("retains attention filters on remount and clears an empty result back to All", async () => {
    await using context = await setup();
    const scoped = { projectId: WorkbenchProjectId.make("attention-remount-workspace") };
    await context.renderBoard(scoped);
    await context.screen.getByRole("button", { name: "Agent replies", exact: true }).click();
    expect(context.articles()).toHaveLength(0);
    await context.remount(scoped);
    await expect
      .element(context.screen.getByRole("button", { name: "Agent replies", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    expect(context.articles()).toHaveLength(0);
    await context.screen.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect
      .element(context.screen.getByRole("button", { name: "All", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    expect(context.articles()).toHaveLength(2);
  });
  it("shows confirmed actions with bells and excludes inspection-only Tickets", async () => {
    await using context = await setup();
    const waiting = ticket("Waiting for input");
    const unavailable = ticket("PR inspection unavailable");
    const reference = {
      projectId: ProjectId.make("repo"),
      repository: "acme/web",
      number: 7,
      url: "https://github.com/acme/web/pull/7",
    };
    vi.mocked(attentionProvider.useWorkbenchAttentionData).mockReturnValue({
      attentionRefresh: 0,
      refreshAttention: vi.fn(),
      attentionReferences: [reference],
      attentionScope: "confirmed-actions-board",
      setAttentionObservations: vi.fn(),
      attentionReasonsByTicket: new Map([
        [waiting.id, ["Waiting for input"]],
        [unavailable.id, ["PR attention unavailable"]],
      ]),
      attentionSignalsByTicket: new Map([
        [
          waiting.id,
          [
            {
              kind: "waiting",
              cause: "approval",
              source: {
                type: "thread",
                threadId: ThreadId.make("waiting"),
                threadTitle: waiting.title,
              },
            },
          ],
        ],
      ]),
      attentionInspectionsByTicket: new Map([
        [
          unavailable.id,
          [
            {
              row: {
                threadId: ThreadId.make("unavailable"),
                threadTitle: unavailable.title,
                pullRequest: reference,
              },
              status: "unavailable",
              displayStatus: "unavailable",
              inspected: false,
            },
          ],
        ],
      ]),
      attentionCoverage: "0 of 1 linked PRs inspected",
    });
    await context.renderBoard({
      projectId: WorkbenchProjectId.make("confirmed-actions-board"),
      tickets: [waiting, unavailable],
    });
    expect(context.articles()).toHaveLength(2);
    await context.screen.getByRole("button", { name: "Needs attention", exact: true }).click();
    expect(context.titles()).toEqual([waiting.title]);
    await expect
      .element(
        context.screen.getByRole("button", { name: "Waiting for input needs attention: Approval" }),
      )
      .toBeVisible();
  });
  it("matches secondary repositories, retains the filter while loading, and clears removed repositories", async () => {
    await using context = await setup();
    const workspaceProps = {
      projectId: WorkbenchProjectId.make("repository-filter-workspace"),
      tickets: [
        {
          ...ticket("Across repositories"),
          repositoryProjectIds: [ProjectId.make("repo"), ProjectId.make("secondary")],
        },
        ticket("Primary only"),
      ],
    };
    await context.renderBoard(workspaceProps);
    await selectRepository("secondary");
    expect(context.articles()).toHaveLength(1);
    expect(context.titles()).toEqual(["Across repositories"]);
    await context.remount({
      ...workspaceProps,
      repositoriesReady: false,
      repositoryProjectIds: [],
    });
    expect(context.articles()).toHaveLength(1);
    await context.renderBoard(workspaceProps);
    expect(context.articles()).toHaveLength(1);
    await context.renderBoard({ ...workspaceProps, repositoriesById: new Map() });
    expect(context.articles()).toHaveLength(1);
    await context.renderBoard({ ...workspaceProps, repositoryProjectIds: [repositories[0]!.id] });
    expect(context.articles()).toHaveLength(2);
  });
  it("isolates search by both environment and workspace and clears a combined empty filter", async () => {
    await using context = await setup();
    const workspaceProps = { projectId: WorkbenchProjectId.make("scope-workspace") };
    await context.renderBoard(workspaceProps);
    await context.screen.getByRole("textbox", { name: "Search tickets" }).fill("missing");
    await vi.waitFor(() => expect(context.articles()).toHaveLength(0));
    await selectRepository("secondary");
    expect(context.articles()).toHaveLength(0);
    await context.renderBoard({
      ...workspaceProps,
      environmentId: EnvironmentId.make("other-environment"),
    });
    expect(context.articles()).toHaveLength(2);
    await context.renderBoard({
      ...workspaceProps,
      projectId: WorkbenchProjectId.make("other-workspace"),
    });
    expect(context.articles()).toHaveLength(2);
    await context.renderBoard(workspaceProps);
    expect(context.articles()).toHaveLength(0);
    await context.screen.getByRole("button", { name: "Clear filters", exact: true }).click();
    await vi.waitFor(() => expect(context.articles()).toHaveLength(2));
    await expect
      .element(context.screen.getByRole("textbox", { name: "Search tickets" }))
      .toHaveValue("");
  });
});
