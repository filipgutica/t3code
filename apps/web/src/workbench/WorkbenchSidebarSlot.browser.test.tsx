import { act, render as renderBrowser } from "../../test/render";
import { useEffect } from "react";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchSnapshot,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { WorkbenchSidebarSlot } from "./WorkbenchSidebarSlot";

const state = vi.hoisted(
  (): {
    search: Record<string, unknown>;
    params: Record<string, string>;
    snapshot: WorkbenchSnapshot | null;
    pending: boolean;
    mounts: number;
  } => ({ search: {}, params: {}, snapshot: null, pending: false, mounts: 0 }),
);
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useSearch: () => state.search,
  useParams: ({ select }: { select: (params: Record<string, string>) => unknown }) =>
    select(state.params),
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({ data: state.snapshot, isPending: state.pending }),
}));
vi.mock("./state", () => ({ workbenchEnvironment: { snapshot: () => null } }));
vi.mock("../components/sidebar/SidebarChrome", () => ({ SidebarChromeHeader: () => null }));
vi.mock("./WorkbenchSidebar", () => ({
  WorkbenchSidebar: ({ routeEnvironmentId }: { routeEnvironmentId?: EnvironmentId }) => {
    useEffect(() => {
      state.mounts++;
    }, []);
    return (
      <div
        data-testid="sidebar-scroll"
        data-environment={routeEnvironmentId}
        style={{ height: 100, overflow: "auto" }}
      >
        <div style={{ height: 1200 }} />
      </div>
    );
  },
}));

it("preserves the scroll container while the new Thread's Assignment refresh finishes", async () => {
  state.search = {};
  state.params = {};
  state.snapshot = null;
  state.pending = false;
  state.mounts = 0;
  // Route hooks are mocked so the test can expose the intermediate Assignment-loading route.
  await using screen = await renderBrowser(null, { router: false });
  const host = screen.container;
  const render = async (pathname: string) => {
    await act(async () =>
      screen.rerender(
        <WorkbenchSidebarSlot pathname={pathname} isElectron={false}>
          <div>Native sidebar</div>
        </WorkbenchSidebarSlot>,
      ),
    );
  };
  await render("/workbench");
  const scroll = host.querySelector<HTMLElement>('[data-testid="sidebar-scroll"]')!;
  scroll.scrollTop = 800;

  state.params = { environmentId: "remote", threadId: "new-thread" };
  state.search = { workbench: true };
  state.pending = true;
  await render("/remote/new-thread");
  expect(host.querySelector('[data-testid="sidebar-scroll"]')).toBe(scroll);
  expect(scroll.scrollTop).toBe(800);
  expect(scroll.dataset.environment).toBe("remote");

  const workspaceId = WorkbenchProjectId.make("workspace");
  const ticketId = WorkbenchTicketId.make("ticket");
  const timestamp = "2026-10-17T00:00:00.000Z";
  state.snapshot = {
    projects: [
      {
        id: workspaceId,
        title: "Workspace",
        linkedProjectIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    tickets: [
      {
        id: ticketId,
        projectId: workspaceId,
        epicId: null,
        title: "Ticket",
        markdown: "",
        kind: "story",
        primaryT3ProjectId: ProjectId.make("repository"),
        repositoryProjectIds: [],
        status: "todo",
        blocked: false,
        revision: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    assignments: [
      {
        id: WorkbenchAssignmentId.make("assignment"),
        ticketId,
        threadId: ThreadId.make("new-thread"),
        createdAt: timestamp,
        supersededAt: null,
      },
    ],
    epics: [],
    ticketWorkspaces: [],
    reservedThreadIds: [],
  };
  state.pending = false;
  await render("/remote/new-thread");
  expect(host.querySelector('[data-testid="sidebar-scroll"]')).toBe(scroll);
  expect(scroll.scrollTop).toBe(800);
  expect(state.mounts).toBe(1);

  state.search = {};
  await render("/remote/new-thread");
  expect(host.textContent).toBe("Native sidebar");
});
