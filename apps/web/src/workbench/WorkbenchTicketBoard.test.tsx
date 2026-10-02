import { act, cloneElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import { ToggleGroup } from "../components/ui/toggle-group";
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
vi.mock("./state", () => ({ workbenchEnvironment: { jiraGetTicketTransitions: () => null } }));

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
  epics: [],
  groupMode: "none",
  mirrorColumns: null,
  jiraConnected: false,
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

describe("Workbench Board view", () => {
  let renderer: ReactTestRenderer;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
      renderer.root.findAllByProps({ "aria-label": "1 attention item for Waiting for input" })
        .length,
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
