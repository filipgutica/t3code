import {
  EnvironmentId,
  ProjectId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WorkbenchTicketWorkspaceAttemptId,
  type WorkbenchSnapshot,
  type WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import { act, type ButtonHTMLAttributes, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { WorkbenchRetainedWorktrees } from "./WorkbenchRetainedWorktrees";
import { WorkbenchSidebar } from "./WorkbenchSidebar";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";

const release = vi.hoisted(() => vi.fn());
const sidebarHost = vi.hoisted(() => ({
  environmentId: "retained-host",
  snapshot: null as WorkbenchSnapshot | null,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useSearch: () => ({}),
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => release }));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    releaseTicketWorkspace: {},
    snapshot: () => "workbench",
    jiraSnapshot: () => "jira",
  },
}));
vi.mock("../state/environments", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make(sidebarHost.environmentId),
}));
vi.mock("../state/entities", () => ({
  useThreadShells: () => [],
  useThreadShell: () => null,
  useProjects: () => [],
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: (target: string) => ({
    data: target === "workbench" ? sidebarHost.snapshot : { issueLinks: [] },
    error: null,
    isPending: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("./WorkbenchAttentionProvider", () => ({
  useWorkbenchAttentionData: () => ({
    attentionSignalsByTicket: new Map(),
    attentionInspectionsByTicket: new Map(),
    attentionCoverage: "complete",
  }),
}));
vi.mock("../components/sidebar/SidebarChrome", () => ({ SidebarChromeFooter: () => null }));
vi.mock("./WorkbenchSidebarTicketButton", () => ({ WorkbenchSidebarTicketButton: () => null }));
vi.mock("./WorkbenchSidebarThreadRow", () => ({ WorkbenchSidebarThreadRow: () => null }));
vi.mock("../components/ui/sidebar", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    SidebarContent: Container,
    SidebarGroup: Container,
    SidebarMenu: Container,
    SidebarMenuItem: Container,
    SidebarMenuButton: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
    useSidebar: () => ({ isMobile: false, setOpenMobile: vi.fn() }),
  };
});
vi.mock("../components/ui/tooltip", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Tooltip: Container,
    TooltipTrigger: ({ render, children }: { render?: ReactNode; children?: ReactNode }) => (
      <>
        {render}
        {children}
      </>
    ),
    TooltipPopup: Container,
  };
});
vi.mock("../components/ui/button", () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));
vi.mock("../components/ui/dialog", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogPopup: Container,
    DialogHeader: Container,
    DialogTitle: Container,
    DialogDescription: Container,
    DialogPanel: Container,
    DialogFooter: Container,
  };
});
vi.mock("../components/ui/alert-dialog", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    AlertDialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <div>{children}</div> : null,
    AlertDialogPopup: Container,
    AlertDialogHeader: Container,
    AlertDialogTitle: Container,
    AlertDialogDescription: Container,
    AlertDialogFooter: Container,
  };
});

const timestamp = "2026-10-04T00:00:00.000Z";
const ticketId = WorkbenchTicketId.make("deleted-ticket");
const environmentId = EnvironmentId.make("retained-host");
const retained: WorkbenchTicketWorkspace = {
  ticketId,
  attemptId: WorkbenchTicketWorkspaceAttemptId.make("attempt"),
  status: "ready",
  branchName: "workbench/deleted-ticket",
  errorMessage: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  repositories: ["web", "api"].map((repository, index) => ({
    projectId: ProjectId.make(repository),
    isPrimary: index === 0,
    sourcePath: `/repositories/${repository}`,
    worktreePath: `/retained/${repository}`,
    branchName: "workbench/deleted-ticket",
    status: "ready",
    errorMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  })),
};
const snapshot: WorkbenchSnapshot = {
  projects: [],
  tickets: [
    {
      id: WorkbenchTicketId.make("active-ticket"),
      projectId: WorkbenchProjectId.make("board"),
      epicId: null,
      title: "Active Ticket",
      kind: "story",
      markdown: "",
      primaryT3ProjectId: ProjectId.make("web"),
      repositoryProjectIds: [],
      status: "todo",
      blocked: false,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  epics: [],
  assignments: [],
  reservedThreadIds: [],
  ticketWorkspaces: [
    retained,
    { ...retained, ticketId: WorkbenchTicketId.make("active-ticket") },
    { ...retained, ticketId: WorkbenchTicketId.make("released-ticket"), status: "released" },
  ],
};
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  release.mockReset();
  sidebarHost.environmentId = "retained-host";
  sidebarHost.snapshot = snapshot;
});

it.each([false, true])(
  "clears a host's cleanup confirmation on switching environments (pending request: %s)",
  async (pendingRequest) => {
    const root = createRootRoute();
    const route = createRoute({ getParentRoute: () => root, path: "/workbench" });
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ["/workbench"] }),
    });
    await router.load();
    const renderSidebar = () => (
      <RouterContextProvider router={router}>
        <WorkbenchSidebar />
      </RouterContextProvider>
    );
    await act(() => {
      renderer = create(renderSidebar());
    });
    await act(() => button("Retained worktrees").props.onClick());
    await act(() => button(`Remove worktrees for ${ticketId}`).props.onClick());

    let completeA:
      | ((result: AtomCommandResult<WorkbenchTicketWorkspace, Error>) => void)
      | undefined;
    let requestA: Promise<void> | undefined;
    if (pendingRequest) {
      release.mockReturnValueOnce(
        new Promise<AtomCommandResult<WorkbenchTicketWorkspace, Error>>((resolve) => {
          completeA = resolve;
        }),
      );
      await act(() => {
        requestA = button("Remove worktrees").props.onClick();
      });
    }

    sidebarHost.environmentId = "other-host";
    sidebarHost.snapshot = {
      ...snapshot,
      ticketWorkspaces: snapshot.ticketWorkspaces.map((workspace) => ({
        ...workspace,
        branchName: "other-host/retained",
      })),
    };
    await act(() => renderer!.update(renderSidebar()));
    expect(
      renderer!.root
        .findAllByType("button")
        .some((node) => node.props["aria-label"] === "Remove worktrees"),
    ).toBe(false);
    await act(() => button("Retained worktrees").props.onClick());
    await act(() => button(`Remove worktrees for ${ticketId}`).props.onClick());
    expect(button("Remove worktrees").props.disabled).toBe(false);
    if (pendingRequest) {
      await act(async () => {
        completeA!(
          AsyncResult.failure(Cause.fail(new Error("The previous host still owns its checkout."))),
        );
        await requestA;
      });
      expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(0);
      expect(button("Remove worktrees").props.disabled).toBe(false);
    }
    release.mockResolvedValueOnce(AsyncResult.success({ ...retained, status: "released" }));
    await act(async () => {
      await button("Remove worktrees").props.onClick();
    });
    expect(release.mock.lastCall![0].environmentId).toBe("other-host");
  },
);
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
const render = (data: WorkbenchSnapshot) => (
  <WorkbenchRetainedWorktrees environmentId={environmentId} snapshot={data} />
);
const button = (label: string) => {
  const found = renderer!.root
    .findAllByType("button")
    .find((node) => node.props["aria-label"] === label || node.props.children === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
};

it("confirms cleanup, keeps a failed removal available, and retires refreshed releases without reopening", async () => {
  await act(() => {
    renderer = create(render(snapshot));
  });
  await act(() => button("Retained worktrees").props.onClick());
  expect(renderer!.root.findAllByType("code").map((node) => node.props.children)).toContain(
    "/retained/api",
  );
  expect(
    renderer!.root
      .findAllByType("button")
      .filter((node) => String(node.props["aria-label"]).startsWith("Remove worktrees for")),
  ).toHaveLength(1);

  await act(() => button(`Remove worktrees for ${ticketId}`).props.onClick());
  await act(() => button("Cancel").props.onClick());
  expect(release).not.toHaveBeenCalled();
  await act(() => button(`Remove worktrees for ${ticketId}`).props.onClick());
  release.mockResolvedValueOnce(
    AsyncResult.failure(Cause.fail(new Error("A Thread still owns this worktree."))),
  );
  await act(async () => {
    await button("Remove worktrees").props.onClick();
  });
  expect(renderer!.root.findByProps({ role: "alert" }).props.children).toBe(
    "A Thread still owns this worktree.",
  );
  expect(button(`Remove worktrees for ${ticketId}`)).toBeDefined();

  release.mockResolvedValueOnce(AsyncResult.success({ ...retained, status: "released" }));
  await act(async () => {
    await button("Remove worktrees").props.onClick();
  });
  expect(release.mock.lastCall![0]).toMatchObject({
    environmentId,
    input: { ticketId, retained: true },
  });
  expect(button("Retained worktrees")).toBeDefined();
  await act(() =>
    renderer!.update(
      render({
        ...snapshot,
        ticketWorkspaces: snapshot.ticketWorkspaces.map((workspace) =>
          workspace.ticketId === ticketId ? { ...workspace, status: "released" } : workspace,
        ),
      }),
    ),
  );
  expect(
    renderer!.root
      .findAllByType("button")
      .some((node) => node.props["aria-label"] === "Retained worktrees"),
  ).toBe(false);
  await act(() => renderer!.update(render(snapshot)));
  expect(renderer!.root.findAllByType("button")).toHaveLength(1);
  await act(() => button("Retained worktrees").props.onClick());
  expect(button(`Remove worktrees for ${ticketId}`)).toBeDefined();
});

it("keeps archived Workspaces searchable and reachable while showing only actionable Tickets", async () => {
  sidebarHost.environmentId = "archived-sidebar-host";
  const workspaceId = WorkbenchProjectId.make("archived-workspace");
  sidebarHost.snapshot = {
    ...snapshot,
    projects: [
      {
        id: workspaceId,
        title: "Archived Roadmap",
        linkedProjectIds: [],
        archivedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    tickets: [{ ...snapshot.tickets[0]!, projectId: workspaceId, title: "Release Checklist" }],
    ticketWorkspaces: [],
  };
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: "/workbench" });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/workbench"] }),
  });
  await router.load();
  await act(() => {
    renderer = create(
      <RouterContextProvider router={router}>
        <WorkbenchSidebar />
      </RouterContextProvider>,
    );
  });
  await act(() => button("Show actionable Tickets and Threads").props.onClick());
  expect(renderer!.root.findByType("summary").children).toEqual(["Archived Workspaces"]);
  const search = renderer!.root.findByProps({ "aria-label": "Search Workbench sidebar" });
  await act(() => search.props.onChange({ target: { value: "Release Checklist" } }));
  expect(renderer!.root.findAllByType("summary")).toHaveLength(1);
  await act(() => search.props.onChange({ target: { value: "unrelated search" } }));
  expect(renderer!.root.findAllByType("summary")).toHaveLength(0);
  await act(() => search.props.onChange({ target: { value: "Roadmap" } }));
  const workspaceButton = renderer!.root
    .findAllByType("button")
    .find((node) => node.props.tooltip?.children === "Archived Roadmap")!;
  await act(() => workspaceButton.props.onClick());
  expect(router.state.location.search).toMatchObject({
    environmentId: "archived-sidebar-host",
    workbenchProjectId: workspaceId,
  });
});
