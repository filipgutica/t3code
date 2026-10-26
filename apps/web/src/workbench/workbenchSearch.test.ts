import { WorkbenchProjectId, WorkbenchEpicId } from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { parseWorkbenchSearch, redirectLegacyWorkbenchSearch } from "./workbenchSearch";

describe("Workbench route search", () => {
  it("preserves existing workspace links and selects a ticket before an epic", () => {
    expect(
      parseWorkbenchSearch({
        environmentId: "remote",
        projectId: "workspace",
        ticketId: "ticket",
        epicId: "epic",
        create: "workspace",
      }),
    ).toEqual({
      environmentId: "remote",
      workbenchProjectId: "workspace",
      ticketId: "ticket",
      create: "workspace",
    });
    expect(parseWorkbenchSearch({ projectId: "workspace", epicId: "epic" })).toEqual({
      workbenchProjectId: "workspace",
      epicId: "epic",
    });
  });

  it("loads a legacy deep link and navigates with canonical selection parameters", async () => {
    const root = createRootRoute();
    const workbench = createRoute({
      getParentRoute: () => root,
      path: "/workbench",
      validateSearch: parseWorkbenchSearch,
      beforeLoad: ({ location }) => redirectLegacyWorkbenchSearch(location.search),
    });
    const router = createRouter({
      routeTree: root.addChildren([workbench]),
      history: createMemoryHistory({
        initialEntries: ["/workbench?projectId=workspace&ticketId=ticket"],
      }),
    });
    // The server router first redirects to its validated URL, then runs beforeLoad.
    for (let step = 0; step < 2; step++) {
      await router.load();
      const next = router.state.redirect;
      if (!next) throw new Error("Expected legacy URL redirect");
      await router.navigate(next.options);
    }
    expect(router.state.location.search).toEqual({
      workbenchProjectId: "workspace",
      ticketId: "ticket",
    });
    expect(() => redirectLegacyWorkbenchSearch(router.state.location.search)).not.toThrow();
    await router.navigate({
      to: "/workbench",
      search: {
        workbenchProjectId: WorkbenchProjectId.make("another"),
        epicId: WorkbenchEpicId.make("epic"),
      },
    });
    expect(router.state.location.search).toEqual({ workbenchProjectId: "another", epicId: "epic" });
  });

  it("uses namespaced values when old and new parameters are both present", () => {
    expect(
      parseWorkbenchSearch({
        workbenchProjectId: "current",
        projectId: "legacy",
      }),
    ).toEqual({ workbenchProjectId: "current" });
  });

  it("ignores malformed selection and unrelated query fields", () => {
    expect(
      parseWorkbenchSearch({
        environmentId: 1,
        projectId: [],
        ticketId: null,
        epicId: {},
        create: true,
        q: "native search",
      }),
    ).toEqual({});
  });
});
