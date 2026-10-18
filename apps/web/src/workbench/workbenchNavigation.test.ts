import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import {
  parseWorkbenchThreadSearch,
  shouldShowWorkbenchSidebar,
  withWorkbenchEnvironmentSearch,
} from "./workbenchNavigation";

describe("Workbench navigation context", () => {
  it("retains the selected environment when routing back to Workbench", () => {
    const environmentId = EnvironmentId.make("remote-environment");
    expect(withWorkbenchEnvironmentSearch(environmentId, { projectId: "workspace" })).toEqual({
      environmentId,
      projectId: "workspace",
    });
    expect(withWorkbenchEnvironmentSearch(null, { projectId: "workspace" })).toEqual({
      projectId: "workspace",
    });
  });

  it("leaves Workbench mode when the same assigned Thread is opened normally", () => {
    expect(
      shouldShowWorkbenchSidebar({ pathname: "/workbench", search: {}, hasTicketContext: false }),
    ).toBe(true);
    expect(
      shouldShowWorkbenchSidebar({
        pathname: "/env/thread",
        search: { workbench: true },
        hasTicketContext: true,
      }),
    ).toBe(true);
    expect(
      shouldShowWorkbenchSidebar({ pathname: "/env/thread", search: {}, hasTicketContext: true }),
    ).toBe(false);
    expect(shouldShowWorkbenchSidebar({ pathname: "/", search: {}, hasTicketContext: false })).toBe(
      false,
    );
  });
  it("clears Workbench context on ordinary router navigation and explicit exit", async () => {
    const root = createRootRoute();
    const thread = createRoute({
      getParentRoute: () => root,
      path: "/$environmentId/$threadId",
      validateSearch: parseWorkbenchThreadSearch,
    });
    const router = createRouter({
      routeTree: root.addChildren([thread]),
      history: createMemoryHistory({ initialEntries: ["/env/thread"] }),
    });
    await router.load();
    await router.navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: "env", threadId: "thread" },
      search: { workbench: true },
    });
    expect(router.state.location.search).toEqual({ workbench: true });
    await router.navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: "env", threadId: "another" },
    });
    expect(router.state.location.search).toEqual({});
    await router.navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: "env", threadId: "thread" },
      search: { workbench: true },
    });
    await router.navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: "env", threadId: "thread" },
      search: {},
    });
    expect(router.state.location.pathname).toBe("/env/thread");
    expect(router.state.location.search).toEqual({});
  });

  it("keeps the sidebar mounted while a new Thread's Assignment snapshot is pending", () => {
    const route = {
      pathname: "/env/new-thread",
      search: { workbench: true },
      hasTicketContext: false,
    };
    expect(shouldShowWorkbenchSidebar({ ...route, isContextPending: true })).toBe(true);
    expect(shouldShowWorkbenchSidebar({ ...route, isContextPending: false })).toBe(false);
    expect(shouldShowWorkbenchSidebar({ ...route, search: {}, isContextPending: true })).toBe(
      false,
    );
  });

  it("requires an explicit flag and a Ticket context for Thread navigation", () => {
    expect(parseWorkbenchThreadSearch({ workbench: true })).toEqual({ workbench: true });
    expect(parseWorkbenchThreadSearch({ workbench: "false" })).toEqual({});
    expect(parseWorkbenchThreadSearch({})).toEqual({});
    expect(
      shouldShowWorkbenchSidebar({
        pathname: "/env/unrelated",
        search: { workbench: true },
        hasTicketContext: false,
      }),
    ).toBe(false);
  });
});
