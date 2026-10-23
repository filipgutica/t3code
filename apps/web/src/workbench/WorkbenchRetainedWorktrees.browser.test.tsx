import {
  EnvironmentId,
  ProjectId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WorkbenchTicketWorkspaceAttemptId,
  type WorkbenchSnapshot,
  type WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { act, render as renderUI, type Screen } from "../../test/render";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
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
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => true,
  useAtomRefresh: () => vi.fn(),
}));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    releaseTicketWorkspace: {},
    discardTicketDraftInBatch: { permissionAtom: () => null },
    ticketPreparations: () => "preparations",
    snapshot: () => "workbench",
    jiraSnapshot: () => "jira",
  },
}));
vi.mock("../state/environments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/environments")>()),
  usePrimaryEnvironmentId: () => EnvironmentId.make(sidebarHost.environmentId),
}));
vi.mock("../state/entities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/entities")>()),
  useThreadShells: () => [],
  useThreadShell: () => null,
  useProjects: () => [],
}));
vi.mock("../state/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/query")>()),
  useEnvironmentQuery: (target: string) => ({
    data: target === "workbench" ? sidebarHost.snapshot : { issueLinks: [] },
    error: null,
    isPending: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("./WorkbenchAttentionProvider", () => ({
  WorkbenchAttentionProvider: ({ children }: { children: ReactNode }) => children,
  useWorkbenchAttentionData: () => ({
    attentionSignalsByTicket: new Map(),
    attentionInspectionsByTicket: new Map(),
    attentionCoverage: "complete",
  }),
}));
vi.mock("./WorkbenchSidebarFooter", () => ({
  WorkbenchSidebarFooter: ({ retainedWorktrees }: { retainedWorktrees: ReactNode }) =>
    retainedWorktrees,
}));
vi.mock("./WorkbenchSidebarThreadRow", () => ({ WorkbenchSidebarThreadRow: () => null }));
vi.mock("../components/ui/sidebar", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    SidebarContent: ({
      children,
      fixedHeader,
    }: {
      children?: ReactNode;
      fixedHeader?: ReactNode;
    }) => (
      <div>
        {fixedHeader}
        {children}
      </div>
    ),
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
vi.mock("../components/ui/menu", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Menu: Container,
    MenuGroup: Container,
    MenuRadioGroup: Container,
    MenuRadioItem: Container,
    MenuSeparator: Container,
    MenuItem: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
    MenuItemLabel: Container,
    MenuShortcut: Container,
    MenuSub: Container,
    MenuSubTrigger: Container,
    MenuSubPopup: Container,
    MenuTrigger: ({ render, children }: { render?: ReactNode; children?: ReactNode }) => (
      <>
        {render}
        {children}
      </>
    ),
    MenuPopup: Container,
    MenuCheckboxItem: ({
      checked,
      onCheckedChange,
      children,
    }: {
      checked: boolean;
      onCheckedChange: (checked: boolean) => void;
      children?: ReactNode;
    }) => (
      <button aria-label="Needs attention" onClick={() => onCheckedChange(!checked)}>
        {children}
      </button>
    ),
  };
});
vi.mock("../components/ui/button", () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  // Real style helpers pull the composer and menu graph back into this primitive mock.
  buttonVariants: ({ className }: { className?: string } = {}) => className ?? "",
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
    AlertDialogClose: Container,
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
function setup() {
  release.mockReset();
  sidebarHost.environmentId = "retained-host";
  sidebarHost.snapshot = snapshot;
}

it.each([false, true])(
  "clears a host's cleanup confirmation on switching environments (pending request: %s)",
  async (pendingRequest) => {
    setup();
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
    await using screen = await renderUI(renderSidebar());
    await act(() => button(screen, "Retained worktrees").click());
    await act(() => button(screen, `Remove worktrees for ${ticketId}`).click());

    let completeA:
      | ((result: AtomCommandResult<WorkbenchTicketWorkspace, Error>) => void)
      | undefined;
    if (pendingRequest) {
      release.mockReturnValueOnce(
        new Promise<AtomCommandResult<WorkbenchTicketWorkspace, Error>>((resolve) => {
          completeA = resolve;
        }),
      );
      await act(() => {
        button(screen, "Remove worktrees").click();
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
    await screen.rerender(renderSidebar());
    expect(
      Array.from(screen.container.querySelectorAll("button")).some(
        (node) => node.getAttribute("aria-label") === "Remove worktrees",
      ),
    ).toBe(false);
    await act(() => button(screen, "Retained worktrees").click());
    await act(() => button(screen, `Remove worktrees for ${ticketId}`).click());
    expect(button(screen, "Remove worktrees").disabled).toBe(false);
    if (pendingRequest) {
      await act(async () => {
        completeA!(
          AsyncResult.failure(Cause.fail(new Error("The previous host still owns its checkout."))),
        );
      });
      expect(screen.container.querySelectorAll('[role="alert"]')).toHaveLength(0);
      expect(button(screen, "Remove worktrees").disabled).toBe(false);
    }
    release.mockResolvedValueOnce(AsyncResult.success({ ...retained, status: "released" }));
    await act(async () => {
      await button(screen, "Remove worktrees").click();
    });
    expect(release.mock.lastCall![0].environmentId).toBe("other-host");
  },
);
const view = (data: WorkbenchSnapshot) => (
  <WorkbenchRetainedWorktrees environmentId={environmentId} snapshot={data} />
);
const button = (screen: Screen, label: string) => {
  const found = Array.from(screen.container.querySelectorAll<HTMLButtonElement>("button")).find(
    (node) => node.getAttribute("aria-label") === label || node.textContent === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
};

it("confirms cleanup, keeps a failed removal available, and retires refreshed releases without reopening", async () => {
  setup();
  await using screen = await renderUI(view(snapshot));
  await act(() => button(screen, "Retained worktrees").click());
  expect(
    Array.from(screen.container.querySelectorAll("code"), (node) => node.textContent),
  ).toContain("/retained/api");
  expect(
    Array.from(screen.container.querySelectorAll("button")).filter((node) =>
      String(node.getAttribute("aria-label")).startsWith("Remove worktrees for"),
    ),
  ).toHaveLength(1);

  await act(() => button(screen, `Remove worktrees for ${ticketId}`).click());
  await act(() => button(screen, "Cancel").click());
  expect(release).not.toHaveBeenCalled();
  await act(() => button(screen, `Remove worktrees for ${ticketId}`).click());
  release.mockResolvedValueOnce(
    AsyncResult.failure(Cause.fail(new Error("A Thread still owns this worktree."))),
  );
  await act(async () => {
    await button(screen, "Remove worktrees").click();
  });
  expect(screen.container.querySelector('[role="alert"]')!.textContent).toBe(
    "A Thread still owns this worktree.",
  );
  expect(button(screen, `Remove worktrees for ${ticketId}`)).toBeDefined();

  release.mockResolvedValueOnce(AsyncResult.success({ ...retained, status: "released" }));
  await act(async () => {
    await button(screen, "Remove worktrees").click();
  });
  expect(release.mock.lastCall![0]).toMatchObject({
    environmentId,
    input: { ticketId, retained: true },
  });
  expect(button(screen, "Retained worktrees")).toBeDefined();
  await screen.rerender(
    view({
      ...snapshot,
      ticketWorkspaces: snapshot.ticketWorkspaces.map((workspace) =>
        workspace.ticketId === ticketId ? { ...workspace, status: "released" } : workspace,
      ),
    }),
  );
  expect(
    Array.from(screen.container.querySelectorAll("button")).some(
      (node) => node.getAttribute("aria-label") === "Retained worktrees",
    ),
  ).toBe(false);
  await screen.rerender(view(snapshot));
  expect(screen.container.querySelectorAll("button")).toHaveLength(1);
  await act(() => button(screen, "Retained worktrees").click());
  expect(button(screen, `Remove worktrees for ${ticketId}`)).toBeDefined();
});

it("hides archived Workspaces from actionable results and restores their search and navigation when cleared", async () => {
  setup();
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
  await using screen = await renderUI(
    <RouterContextProvider router={router}>
      <WorkbenchSidebar />
    </RouterContextProvider>,
  );
  await expect
    .element(screen.container.querySelector("summary")!)
    .toHaveTextContent("Archived Workspaces");
  expect(screen.container.querySelector<HTMLDetailsElement>("details")!.open).toBe(false);
  await act(() => button(screen, "Needs attention").click());
  expect(screen.container.querySelectorAll("summary")).toHaveLength(0);
  await expect
    .element(screen.container.querySelector<HTMLElement>('[aria-live="polite"]')!)
    .toHaveTextContent("No confirmed actions");
  await act(() => button(screen, "Turn off Needs attention filter").click());
  expect(screen.container.querySelectorAll("summary")).toHaveLength(1);
  const search = screen.getByRole("combobox", { name: "Search Workbench sidebar", exact: true });
  await search.fill("Release Checklist");
  expect(screen.container.querySelectorAll("summary")).toHaveLength(0);
  await expect
    .element(screen.container.querySelector<HTMLElement>('[aria-live="polite"]')!)
    .toHaveTextContent("1 result");
  expect(screen.getByRole("listbox").element().getAttribute("aria-label")).toBe(
    "Workbench search results",
  );
  expect(
    Array.from(screen.container.querySelectorAll("span")).some(
      (node) => node.textContent === "Release Checklist",
    ),
  ).toBe(true);
  await act(() => button(screen, "Needs attention").click());
  expect(screen.container.querySelectorAll("summary")).toHaveLength(0);
  await expect
    .element(screen.container.querySelector<HTMLElement>('[aria-live="polite"]')!)
    .toHaveTextContent("No Workbench results");
  expect(
    Array.from(screen.container.querySelectorAll("span")).some(
      (node) => node.textContent === "Release Checklist",
    ),
  ).toBe(false);
  await act(() => button(screen, "Turn off Needs attention filter").click());
  expect(screen.container.querySelectorAll("summary")).toHaveLength(0);
  await expect
    .element(screen.container.querySelector<HTMLElement>('[aria-live="polite"]')!)
    .toHaveTextContent("1 result");
  await search.fill("unrelated search");
  expect(screen.container.querySelectorAll("summary")).toHaveLength(0);
  await search.fill("Roadmap");
  await screen.getByRole("option").click();
  expect(router.state.location.search).toMatchObject({
    environmentId: "archived-sidebar-host",
    workbenchProjectId: workspaceId,
  });
});
