import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { EnvironmentId, type WorkbenchSnapshot } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
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
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.primary = "workbench-primary";
  state.phase = "connected";
  state.snapshot = snapshot;
  state.error = null;
  state.pending = false;
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

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
  const render = () => (
    <RouterContextProvider router={router}>
      <WorkbenchSidebarUtilityItem
        render={({ label, onClick }) => <button onClick={onClick}>{label}</button>}
      />
    </RouterContextProvider>
  );
  await act(() => {
    renderer = create(render());
  });
  return { router, render };
};

it("opens its Workbench primary while a native Thread on a core-only remote is active", async () => {
  const { router } = await mount();
  await act(async () => {
    renderer!.root.findByType("button").props.onClick();
    await router.load();
  });
  expect(router.state.location.pathname).toBe("/workbench");
  expect(router.state.location.search).toEqual({});
  expect(state.setOpenMobile).toHaveBeenCalledWith(false);
});

it("withholds its primary action until connected feature detection succeeds and removes a failed action", async () => {
  state.primary = "core-primary";
  state.snapshot = null;
  state.error = "Unknown request tag: workbench.getSnapshot";
  const { render } = await mount();
  expect(renderer!.root.findAllByType("button")).toHaveLength(0);

  state.phase = "connecting";
  state.error = null;
  state.pending = true;
  await act(() => renderer!.update(render()));
  expect(renderer!.root.findAllByType("button")).toHaveLength(0);

  state.phase = "connected";
  state.pending = false;
  state.snapshot = snapshot;
  await act(() => renderer!.update(render()));
  expect(renderer!.root.findAllByType("button")).toHaveLength(1);

  state.error = "The server request timed out";
  await act(() => renderer!.update(render()));
  expect(renderer!.root.findAllByType("button")).toHaveLength(0);
});
