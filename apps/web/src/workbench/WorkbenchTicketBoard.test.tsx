// @vitest-environment jsdom

import { act, cloneElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { create as createRenderer, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { ToggleGroup } from "../components/ui/toggle-group";

vi.mock("../hooks/useMediaQuery", () => ({ useMediaQuery: () => true }));
let boardWidth = 1024;
let resizeBoard = () => {};
vi.mock("../lib/observeResize", () => ({
  observeResize: (_element: Element, callback: () => void) => {
    resizeBoard = callback;
    return () => {};
  },
}));
const create: typeof createRenderer = (element) =>
  createRenderer(element, {
    createNodeMock: () =>
      Object.defineProperty(document.createElement("div"), "clientWidth", {
        get: () => boardWidth,
      }),
  });
import { Select } from "../components/ui/select";
import type { Project } from "../types";
import { WorkbenchTicketBoard } from "./WorkbenchTicketBoard";
import * as attentionProvider from "./WorkbenchAttentionProvider";

vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, error: null, isPending: false }),
}));
vi.mock("../state/pullRequests", () => ({
  linkedPullRequestDetailAtom: () => null,
  pullRequestEnvironment: { activity: () => null },
  useSharedPullRequestSummary: () => null,
}));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    snapshot: () => Atom.make(null),
    ticketPreparations: () => Atom.make(null),
    discardTicketDraftInBatch: { permissionAtom: () => Atom.make(true) },
  },
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));

vi.mock("../components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, render }: { children?: ReactNode; render: ReactElement }) =>
    cloneElement(render, {}, children),
  TooltipPopup: () => null,
}));
vi.mock("./WorkbenchTicketStatusMenu", () => ({ WorkbenchTicketStatusMenu: () => null }));

vi.mock("../components/ui/select", () => {
  const Container = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Select: Container,
    SelectTrigger: Container,
    SelectValue: Container,
    SelectPopup: () => null,
    SelectItem: Container,
  };
});

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
  referencesByTicket: new Map(),
  epics: [],
  groupMode: "none",
  viewControls: null,
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
};

describe("Workbench Board view", () => {
  let renderer: ReactTestRenderer;
  beforeEach(() => {
    boardWidth = 1024;
    document.documentElement.style.fontSize = "16px";
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it.each([12, 16, 20])(
    "gates dragging at 48rem with a %ipx root and respects archive",
    async (rootFontSize) => {
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
      act(() => {
        renderer = create(<WorkbenchTicketBoard {...props} onMove={onMove} />);
      });
      const dragContext = () =>
        renderer.root.find(
          (node) =>
            typeof node.props.onDragStart === "function" &&
            typeof node.props.onDragEnd === "function",
        );
      act(() => dragContext().props.onDragStart(drop));
      act(() => renderer.update(<WorkbenchTicketBoard {...props} onMove={onMove} readOnly />));
      act(() => dragContext().props.onDragEnd(drop));
      expect(onMove).not.toHaveBeenCalled();
      act(() => renderer.update(<WorkbenchTicketBoard {...props} onMove={onMove} />));
      act(() => dragContext().props.onDragEnd(drop));
      expect(onMove).toHaveBeenCalledExactlyOnceWith(active, "in_progress");
      onMove.mockClear();
      act(() => {
        boardWidth = 48 * rootFontSize - 1;
        resizeBoard();
      });
      act(() => dragContext().props.onDragEnd(drop));
      expect(onMove).not.toHaveBeenCalled();
      act(() => {
        boardWidth = 48 * rootFontSize;
        resizeBoard();
      });
      act(() => dragContext().props.onDragEnd(drop));
      expect(onMove).toHaveBeenCalledExactlyOnceWith(active, "in_progress");
      onMove.mockClear();
      await act(async () => {
        document.documentElement.style.fontSize = `${rootFontSize + 1}px`;
      });
      act(() => dragContext().props.onDragEnd(drop));
      expect(onMove).not.toHaveBeenCalled();
      await act(async () => {
        document.documentElement.style.fontSize = `${rootFontSize}px`;
      });
      act(() => dragContext().props.onDragEnd(drop));
      expect(onMove).toHaveBeenCalledExactlyOnceWith(active, "in_progress");
    },
  );
  it("shows snapshot Progress counts and removes them when the checklist is cleared", () => {
    const record = {
      ...ticket("Planned work"),
      progress: "- [x] This list must not supply Board counts",
    };
    const countText = () =>
      renderer.root
        .findAllByType("span")
        .map((node) => node.children.filter((child) => typeof child === "string").join(""))
        .filter((text) => /^\d+ of \d+$/u.test(text));
    act(() => {
      renderer = create(<WorkbenchTicketBoard {...props} tickets={[record]} />);
    });
    expect(countText()).toEqual([]);
    act(() =>
      renderer.update(
        <WorkbenchTicketBoard
          {...props}
          tickets={[{ ...record, progressDone: 1, progressTotal: 3 }]}
        />,
      ),
    );
    expect(countText()).toEqual(["1 of 3"]);
    act(() =>
      renderer.update(
        <WorkbenchTicketBoard
          {...props}
          tickets={[{ ...record, progressDone: 3, progressTotal: 3 }]}
        />,
      ),
    );
    expect(countText()).toEqual(["3 of 3"]);
    act(() =>
      renderer.update(
        <WorkbenchTicketBoard
          {...props}
          tickets={[{ ...record, progressDone: 0, progressTotal: 0 }]}
        />,
      ),
    );
    expect(countText()).toEqual([]);
  });
  it("offers Thread creation for unfinished cards and hides it after completion", () => {
    const onOpenThread = vi.fn();
    const active = ticket("Unassigned");
    act(() => {
      renderer = create(
        <WorkbenchTicketBoard {...props} tickets={[active]} onOpenThread={onOpenThread} />,
      );
    });
    const createThread = () =>
      renderer.root
        .findAllByType("button")
        .filter((node) => node.props["aria-label"] === "Create Thread for Unassigned");
    act(() => createThread()[0]!.props.onClick());
    expect(onOpenThread).toHaveBeenCalledExactlyOnceWith(active, undefined);
    act(() =>
      renderer.update(
        <WorkbenchTicketBoard
          {...props}
          tickets={[{ ...active, status: "done" }]}
          onOpenThread={onOpenThread}
        />,
      ),
    );
    expect(createThread()).toHaveLength(0);
    act(() =>
      renderer.update(
        <WorkbenchTicketBoard {...props} tickets={[active]} onOpenThread={onOpenThread} />,
      ),
    );
    expect(createThread()).toHaveLength(1);
  });
  it("keeps the search and matching Tickets when returning from Ticket detail", () => {
    act(() => {
      renderer = create(<WorkbenchTicketBoard {...props} />);
    });
    act(() =>
      renderer.root
        .findByProps({ "aria-label": "Search tickets" })
        .props.onChange({ target: { value: "welcome" } }),
    );
    act(() => vi.advanceTimersByTime(200));
    expect(renderer.root.findAllByType("article")).toHaveLength(1);
    act(() => renderer.unmount());
    act(() => {
      renderer = create(<WorkbenchTicketBoard {...props} />);
    });
    expect(renderer.root.findByProps({ "aria-label": "Search tickets" }).props.value).toBe(
      "welcome",
    );
    expect(renderer.root.findAllByType("article")).toHaveLength(1);
  });
  it("retains attention filters on remount and clears an empty result back to All", () => {
    const scoped = { ...props, projectId: WorkbenchProjectId.make("attention-remount-workspace") };
    act(() => {
      renderer = create(<WorkbenchTicketBoard {...scoped} />);
    });
    const control = () =>
      renderer.root
        .findAllByType(ToggleGroup)
        .find((node) => node.props["aria-label"] === "Filter by attention")!;
    act(() => control().props.onValueChange(["replies"]));
    expect(renderer.root.findAllByType("article")).toHaveLength(0);
    act(() => renderer.unmount());
    act(() => {
      renderer = create(<WorkbenchTicketBoard {...scoped} />);
    });
    expect(control().props.value).toEqual(["replies"]);
    expect(renderer.root.findAllByType("article")).toHaveLength(0);
    const clear = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("Clear filters"))!;
    act(() => clear.props.onClick());
    expect(control().props.value).toEqual(["all"]);
    expect(renderer.root.findAllByType("article")).toHaveLength(2);
  });
  it("shows confirmed actions with bells and excludes inspection-only Tickets", () => {
    const waiting = ticket("Waiting for input");
    const unavailable = ticket("PR inspection unavailable");
    const reference = {
      projectId: ProjectId.make("repo"),
      repository: "acme/web",
      number: 7,
      url: "https://github.com/acme/web/pull/7",
    };
    vi.spyOn(attentionProvider, "useWorkbenchAttentionData").mockReturnValue({
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
    act(() => {
      renderer = create(
        <WorkbenchTicketBoard
          {...props}
          projectId={WorkbenchProjectId.make("confirmed-actions-board")}
          tickets={[waiting, unavailable]}
        />,
      );
    });
    expect(renderer.root.findAllByType("article")).toHaveLength(2);
    const control = renderer.root
      .findAllByType(ToggleGroup)
      .find((node) => node.props["aria-label"] === "Filter by attention")!;
    act(() => control.props.onValueChange(["attention"]));
    expect(renderer.root.findAllByType("h3").map((node) => node.children.join(""))).toEqual([
      waiting.title,
    ]);
    expect(
      renderer.root
        .findAllByType("span")
        .filter(
          (node) => node.children.join("") === ", Waiting for input needs attention: Approval",
        ).length,
    ).toBeGreaterThan(0);
  });
  it("matches secondary repositories, retains the filter while loading, and clears removed repositories", () => {
    const workspaceProps = {
      ...props,
      projectId: WorkbenchProjectId.make("repository-filter-workspace"),
      tickets: [
        {
          ...ticket("Across repositories"),
          repositoryProjectIds: [ProjectId.make("repo"), ProjectId.make("secondary")],
        },
        ticket("Primary only"),
      ],
    };
    act(() => {
      renderer = create(<WorkbenchTicketBoard {...workspaceProps} />);
    });
    act(() => renderer.root.findByType(Select).props.onValueChange("secondary"));
    expect(renderer.root.findAllByType("article")).toHaveLength(1);
    expect(renderer.root.findByType("h3").children).toEqual(["Across repositories"]);
    act(() => renderer.unmount());
    act(() => {
      renderer = create(
        <WorkbenchTicketBoard
          {...workspaceProps}
          repositoriesReady={false}
          repositoryProjectIds={[]}
        />,
      );
    });
    expect(renderer.root.findAllByType("article")).toHaveLength(1);
    act(() => renderer.update(<WorkbenchTicketBoard {...workspaceProps} />));
    expect(renderer.root.findAllByType("article")).toHaveLength(1);
    act(() =>
      renderer.update(<WorkbenchTicketBoard {...workspaceProps} repositoriesById={new Map()} />),
    );
    expect(renderer.root.findAllByType("article")).toHaveLength(1);
    act(() =>
      renderer.update(
        <WorkbenchTicketBoard {...workspaceProps} repositoryProjectIds={[repositories[0]!.id]} />,
      ),
    );
    expect(renderer.root.findAllByType("article")).toHaveLength(2);
  });
  it.each([
    [
      "repository",
      (root: ReactTestRenderer["root"]) => root.findByType(Select).props.onValueChange("secondary"),
    ],
    [
      "search",
      (root: ReactTestRenderer["root"]) => {
        root
          .findByProps({ "aria-label": "Search tickets" })
          .props.onChange({ target: { value: "billing" } });
        vi.advanceTimersByTime(200);
      },
    ],
    [
      "attention",
      (root: ReactTestRenderer["root"]) =>
        root
          .findAllByType(ToggleGroup)
          .find((node) => node.props["aria-label"] === "Filter by attention")!
          .props.onValueChange(["attention"]),
    ],
  ])("clears the %s filter while Tickets still match", (filter, applyFilter) => {
    const billing = { ...ticket("Billing"), repositoryProjectIds: [ProjectId.make("secondary")] };
    vi.spyOn(attentionProvider, "useWorkbenchAttentionData").mockReturnValue({
      attentionRefresh: 0,
      refreshAttention: vi.fn(),
      attentionReferences: [],
      attentionScope: "clear-filters-board",
      setAttentionObservations: vi.fn(),
      attentionReasonsByTicket: new Map([[billing.id, ["Waiting for input"]]]),
      attentionSignalsByTicket: new Map([
        [
          billing.id,
          [
            {
              kind: "waiting",
              cause: "approval",
              source: { type: "thread", threadId: ThreadId.make("billing"), threadTitle: "" },
            },
          ],
        ],
      ]),
      attentionInspectionsByTicket: new Map(),
      attentionCoverage: "0 linked PRs",
    });
    act(() => {
      renderer = create(
        <WorkbenchTicketBoard
          {...props}
          projectId={WorkbenchProjectId.make(`clear-${filter}-workspace`)}
          tickets={[ticket("Welcome"), billing]}
        />,
      );
    });
    const clearButtons = () =>
      renderer.root
        .findAllByType("button")
        .filter((button) => button.children.includes("Clear filters"));
    expect(clearButtons()).toHaveLength(0);
    act(() => applyFilter(renderer.root));
    expect(renderer.root.findAllByType("h3").map((node) => node.children.join(""))).toEqual([
      "Billing",
    ]);
    expect(clearButtons()).toHaveLength(1);
    act(() => clearButtons()[0]!.props.onClick());
    expect(renderer.root.findAllByType("article")).toHaveLength(2);
    expect(renderer.root.findByProps({ "aria-label": "Search tickets" }).props.value).toBe("");
    expect(renderer.root.findByType(Select).props.value).toBe("all-repositories");
    expect(
      renderer.root
        .findAllByType(ToggleGroup)
        .find((node) => node.props["aria-label"] === "Filter by attention")!.props.value,
    ).toEqual(["all"]);
    expect(clearButtons()).toHaveLength(0);
  });
  it("isolates search by both environment and workspace and clears a combined empty filter", () => {
    const workspaceProps = { ...props, projectId: WorkbenchProjectId.make("scope-workspace") };
    act(() => {
      renderer = create(<WorkbenchTicketBoard {...workspaceProps} />);
    });
    act(() =>
      renderer.root
        .findByProps({ "aria-label": "Search tickets" })
        .props.onChange({ target: { value: "missing" } }),
    );
    act(() => vi.advanceTimersByTime(200));
    act(() => renderer.root.findByType(Select).props.onValueChange("secondary"));
    expect(renderer.root.findAllByType("article")).toHaveLength(0);
    act(() =>
      renderer.update(
        <WorkbenchTicketBoard
          {...workspaceProps}
          environmentId={EnvironmentId.make("other-environment")}
        />,
      ),
    );
    expect(renderer.root.findAllByType("article")).toHaveLength(2);
    act(() =>
      renderer.update(
        <WorkbenchTicketBoard
          {...workspaceProps}
          projectId={WorkbenchProjectId.make("other-workspace")}
        />,
      ),
    );
    expect(renderer.root.findAllByType("article")).toHaveLength(2);
    act(() => renderer.update(<WorkbenchTicketBoard {...workspaceProps} />));
    expect(renderer.root.findAllByType("article")).toHaveLength(0);
    const clearButton = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("Clear filters"));
    expect(clearButton).toBeDefined();
    act(() => clearButton!.props.onClick());
    expect(renderer.root.findAllByType("article")).toHaveLength(2);
    expect(renderer.root.findByProps({ "aria-label": "Search tickets" }).props.value).toBe("");
  });
});
