import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { EnvironmentId, type WorkbenchSnapshot } from "@t3tools/contracts";
import { act, render } from "../../test/render";
import { expect, it, vi } from "vite-plus/test";
import { WorkbenchSidebarUtilityItem } from "./WorkbenchSidebarUtilityItem";

const state = vi.hoisted(() => ({
  primary: "workbench-primary",
  phase: "connected",
  snapshot: null as WorkbenchSnapshot | null,
  error: null as string | null,
  pending: false,
  setOpenMobile: vi.fn(),
}));
vi.mock("../state/environments", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make(state.primary),
  useEnvironment: () => ({ connection: { phase: state.phase } }),
  useEnvironments: () => ({
    environments: [
      { environmentId: EnvironmentId.make(state.primary), connection: { phase: state.phase } },
      { environmentId: EnvironmentId.make("core-remote"), connection: { phase: "connected" } },
    ],
  }),
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: (target: { environmentId: EnvironmentId } | null) => ({
    data: target?.environmentId === state.primary ? state.snapshot : null,
    isSuccess: target !== null && state.snapshot !== null && state.error === null,
    isPending: state.pending,
    error: state.error,
    refresh: vi.fn(),
  }),
}));
vi.mock("./state", () => ({
  workbenchEnvironment: { snapshot: (target: unknown) => target },
}));
vi.mock("../components/ui/sidebar", () => ({
  useSidebar: () => ({ isMobile: true, setOpenMobile: state.setOpenMobile }),
}));

const snapshot: WorkbenchSnapshot = {
  projects: [],
  tickets: [],
  epics: [],
  assignments: [],
  reservedThreadIds: [],
  ticketWorkspaces: [],
};
function setup() {
  state.primary = "workbench-primary";
  state.phase = "connected";
  state.snapshot = snapshot;
  state.error = null;
  state.pending = false;
  vi.clearAllMocks();
}

const mount = async () => {
  const root = createRootRoute();
  const workbench = createRoute({ getParentRoute: () => root, path: "/workbench" });
  const nativeThread = createRoute({
    getParentRoute: () => root,
    path: "/$environmentId/$threadId",
  });
  const router = createRouter({
    routeTree: root.addChildren([workbench, nativeThread]),
    history: createMemoryHistory({ initialEntries: ["/core-remote/native-thread"] }),
  });
  await router.load();
  const view = () => (
    <RouterContextProvider router={router}>
      <WorkbenchSidebarUtilityItem
        render={({ label, onClick }) => <button onClick={onClick}>{label}</button>}
      />
    </RouterContextProvider>
  );
  // This suite drives its own router to assert the destination and search.
  return Object.assign(await render(view(), { router: false }), { testRouter: router, view });
};

it("opens its Workbench primary while a native Thread on a core-only remote is active", async () => {
  setup();
  await using screen = await mount();
  const router = screen.testRouter;
  await act(async () => {
    screen.container.querySelector<HTMLButtonElement>("button")!.click();
    await router.load();
  });
  expect(router.state.location.pathname).toBe("/workbench");
  expect(router.state.location.search).toEqual({});
  expect(state.setOpenMobile).toHaveBeenCalledWith(false);
});

it("withholds its primary action until connected feature detection succeeds and removes a failed action", async () => {
  setup();
  state.primary = "core-primary";
  state.snapshot = null;
  state.error = "Unknown request tag: workbench.getSnapshot";
  await using screen = await mount();
  expect(screen.container.querySelectorAll("button")).toHaveLength(0);

  state.phase = "connecting";
  state.error = null;
  state.pending = true;
  await screen.rerender(screen.view());
  expect(screen.container.querySelectorAll("button")).toHaveLength(0);

  state.phase = "connected";
  state.pending = false;
  state.snapshot = snapshot;
  await screen.rerender(screen.view());
  expect(screen.container.querySelectorAll("button")).toHaveLength(1);

  state.error = "The server request timed out";
  await screen.rerender(screen.view());
  expect(screen.container.querySelectorAll("button")).toHaveLength(0);
});
