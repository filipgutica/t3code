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
import { startWorkbenchLocationTracking } from "./workbenchLastLocation";

const state = vi.hoisted(() => ({
  primary: "workbench-primary",
  phase: "connected",
  remotePhase: "connected",
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
      {
        environmentId: EnvironmentId.make("core-remote"),
        connection: { phase: state.remotePhase },
      },
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
  threadRecaps: [],
  ticketWorkspaces: [],
};
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.primary = "workbench-primary";
  state.phase = "connected";
  state.remotePhase = "connected";
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

const mount = async (initialEntry = "/core-remote/native-thread") => {
  const root = createRootRoute();
  const validateSearch = (search: Record<string, unknown>) => search;
  const workbench = createRoute({ getParentRoute: () => root, path: "/workbench", validateSearch });
  const nativeThread = createRoute({
    getParentRoute: () => root,
    path: "/$environmentId/$threadId",
    validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([workbench, nativeThread]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
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

const navigateAndResolve = async ({
  router,
  href,
  replace = false,
}: {
  router: Awaited<ReturnType<typeof mount>>["router"];
  href: string;
  replace?: boolean;
}) => {
  const fromLocation = router.state.location;
  await act(async () => {
    const navigation = router.navigate({ href, replace });
    await router.load();
    await navigation;
  });
  // Node routers run in server mode and never emit onResolved themselves.
  router.emit({
    type: "onResolved",
    fromLocation,
    toLocation: router.state.location,
    pathChanged: fromLocation.pathname !== router.state.location.pathname,
    hrefChanged: fromLocation.href !== router.state.location.href,
    hashChanged: fromLocation.hash !== router.state.location.hash,
  });
};

const openWorkbench = async (router: Awaited<ReturnType<typeof mount>>["router"]) => {
  await act(async () => {
    renderer!.root.findByType("button").props.onClick();
    await router.load();
  });
};

it("returns to the last Workbench Thread after the user leaves for a native Thread", async () => {
  const workbenchThreadHref = "/workbench-primary/ticket-thread?workbench=true";
  const { router } = await mount();
  using _tracking = { [Symbol.dispose]: startWorkbenchLocationTracking(router) };
  await navigateAndResolve({ router, href: workbenchThreadHref });
  await navigateAndResolve({ router, href: "/core-remote/native-thread" });
  await openWorkbench(router);
  expect(router.state.location.href).toBe(workbenchThreadHref);
});

it.each([null, "/workbench?environmentId=workbench-primary&workbenchProjectId=board-two"])(
  "forgets a replaced missing Thread and falls back to Board %s",
  async (boardHref) => {
    const threadHref = "/workbench-primary/deleted-thread?workbench=true";
    const { router } = await mount(boardHref ?? threadHref);
    using _tracking = { [Symbol.dispose]: startWorkbenchLocationTracking(router) };
    await navigateAndResolve({ router, href: threadHref });
    await navigateAndResolve({ router, href: "/core-remote/native-thread" });
    await navigateAndResolve({ router, href: "/", replace: true });
    await openWorkbench(router);
    expect(router.state.location.href).toBe(threadHref);

    await navigateAndResolve({ router, href: "/", replace: true });
    await openWorkbench(router);
    expect(router.state.location.href).toBe(boardHref ?? "/workbench");
    await navigateAndResolve({ router, href: "/core-remote/native-thread" });
    await openWorkbench(router);
    expect(router.state.location.href).toBe(boardHref ?? "/workbench");
  },
);

it.each([
  { create: "ticket", selection: { epicId: "durable-epic" } },
  { create: "workspace", selection: { ticketId: "durable-ticket" } },
])(
  "does not replay creation intent when reopening Workbench: $create",
  async ({ create, selection }) => {
    const search = {
      environmentId: "workbench-primary",
      workbenchProjectId: "board-two",
      ...selection,
    };
    const { router } = await mount(`/workbench?${new URLSearchParams({ ...search, create })}`);
    using _tracking = { [Symbol.dispose]: startWorkbenchLocationTracking(router) };
    await navigateAndResolve({ router, href: "/core-remote/native-thread" });
    await openWorkbench(router);
    expect(router.state.location.pathname).toBe("/workbench");
    expect(router.state.location.search).toEqual(search);
  },
);

it.each([
  "/workbench?environmentId=core-remote&workbenchProjectId=remote-board",
  "/core-remote/remote-thread?workbench=true",
])(
  "uses the entry point fallback when the remembered environment disconnects: %s",
  async (href) => {
    const { router, render } = await mount(href);
    using _tracking = { [Symbol.dispose]: startWorkbenchLocationTracking(router) };
    await navigateAndResolve({ router, href: "/workbench-primary/native-thread" });
    state.remotePhase = "disconnected";
    await act(() => renderer!.update(render()));
    await openWorkbench(router);
    expect(router.state.location.pathname).toBe("/workbench");
    expect(router.state.location.search).toEqual({});
  },
);
