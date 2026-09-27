import {
  EnvironmentId,
  ProjectId,
  WorkbenchProjectId,
  type WorkbenchSnapshot,
} from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
  useLocation,
} from "@tanstack/react-router";
import { act } from "react";
import { create } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import { useWorkbenchPageDialogs } from "./useWorkbenchPageDialogs";
import { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";
import { parseWorkbenchSearch } from "./workbenchSearch";
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
const environmentId = EnvironmentId.make("remote");
const workspaceId = WorkbenchProjectId.make("workspace");
const time = "2026-09-27T00:00:00.000Z";
const snapshot: WorkbenchSnapshot = {
  projects: [
    {
      id: workspaceId,
      title: "Workspace",
      linkedProjectIds: [ProjectId.make("repo")],
      createdAt: time,
      updatedAt: time,
    },
  ],
  tickets: [],
  assignments: [],
  epics: [],
  reservedThreadIds: [],
  ticketWorkspaces: [],
};
const setError = () => {};
const setPendingAction = () => {};
function Harness({ data }: { data: WorkbenchSnapshot | null }) {
  const location = useLocation();
  const search = parseWorkbenchSearch(location.search);
  const selection = useWorkbenchPageSelection({
    environmentId,
    initialProjectId: search.workbenchProjectId,
    initialTicketId: undefined,
    initialEpicId: undefined,
    snapshot: data,
    tickets: [],
    pendingAction: null,
    setError,
  });
  const dialogs = useWorkbenchPageDialogs({
    environmentId,
    projects: [],
    selection,
    setError,
    setPendingAction,
  });
  return (
    <button
      data-open={dialogs.ticketDialogOpen}
      onClick={() => dialogs.handleTicketDialogOpenChange(false)}
    >
      Cancel
    </button>
  );
}
describe("palette Ticket creation intent", () => {
  it("waits for the Workspace, consumes the intent, remains closed after cancellation, and can open again", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRootRoute();
    const route = createRoute({
      getParentRoute: () => root,
      path: "/workbench",
      validateSearch: parseWorkbenchSearch,
    });
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({
        initialEntries: [
          "/workbench?environmentId=remote&workbenchProjectId=workspace&create=ticket",
        ],
      }),
    });
    await router.load();
    let renderer: ReturnType<typeof create> | undefined;
    const render = (data: WorkbenchSnapshot | null) => (
      <RouterContextProvider router={router}>
        <Harness data={data} />
      </RouterContextProvider>
    );
    try {
      await act(async () => {
        renderer = create(render(null));
      });
      if (!renderer) throw new Error("Harness not mounted");
      const mounted = renderer;
      expect(mounted.root.findByType("button").props["data-open"]).toBe(false);
      expect(router.state.location.search.create).toBe("ticket");
      await act(async () => {
        mounted.update(render(snapshot));
      });
      await act(async () => {
        await router.load();
      });
      expect(mounted.root.findByType("button").props["data-open"]).toBe(true);
      await act(async () => {
        mounted.update(render({ ...snapshot }));
      });
      expect(router.state.location.search).toEqual({
        environmentId: "remote",
        workbenchProjectId: "workspace",
      });
      await act(async () => {
        mounted.root.findByType("button").props.onClick();
        mounted.update(render({ ...snapshot }));
      });
      expect(mounted.root.findByType("button").props["data-open"]).toBe(false);
      await act(async () => {
        await router.navigate({
          to: "/workbench",
          search: { environmentId, workbenchProjectId: workspaceId, create: "ticket" },
        });
      });
      await act(async () => {
        await router.load();
      });
      await act(async () => {
        mounted.update(render({ ...snapshot }));
      });
      await act(async () => {
        await router.load();
      });
      expect(mounted.root.findByType("button").props["data-open"]).toBe(true);
      expect(router.state.location.search).not.toHaveProperty("create");
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });
});
