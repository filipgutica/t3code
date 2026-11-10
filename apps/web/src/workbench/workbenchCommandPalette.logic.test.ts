import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchSnapshot,
} from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";
import {
  getWorkbenchCommandPaletteEnvironmentId,
  getWorkbenchCommandPaletteTargets,
} from "./workbenchCommandPalette.logic";
import { parseWorkbenchSearch } from "./workbenchSearch";
const environmentId = EnvironmentId.make("remote");
const workspaceId = WorkbenchProjectId.make("workspace");
const threadId = ThreadId.make("thread");
const ticketId = WorkbenchTicketId.make("ticket");
const time = "2026-09-27T00:00:00.000Z";
const snapshot: WorkbenchSnapshot = {
  references: [],
  projects: [
    {
      id: workspaceId,
      title: "Workspace",
      linkedProjectIds: [ProjectId.make("repo")],
      archivedAt: null,
      revision: 0,
      createdAt: time,
      updatedAt: time,
    },
  ],
  tickets: [
    {
      id: ticketId,
      projectId: workspaceId,
      title: "Ticket",
      markdown: "Scope",
      status: "todo",
      blocked: false,
      repositoryProjectIds: [],
      revision: 0,
      createdAt: time,
      updatedAt: time,
    },
  ],
  assignments: [
    {
      id: WorkbenchAssignmentId.make("assignment"),
      ticketId,
      threadId,
      createdAt: time,
      supersededAt: null,
    },
  ],
  reservedThreadIds: [],
  threadRecaps: [],
  ticketWorkspaces: [],
};
describe("Workbench command navigation", () => {
  it("asks only a resolved Workbench host about a Thread page", () => {
    const stockServer = EnvironmentId.make("stock-server");
    const primary = EnvironmentId.make("primary");
    const fallbacks = {
      searchEnvironmentId: undefined,
      threadEnvironmentId: stockServer,
      draftEnvironmentId: undefined,
      primaryEnvironmentId: primary,
    };
    const threadRef = { environmentId: stockServer, threadId };
    // Unassigned on a stock server, or owner discovery still loading: no Workbench to ask.
    expect(
      getWorkbenchCommandPaletteEnvironmentId({ ...fallbacks, threadRef, threadOwnerId: null }),
    ).toBeNull();
    expect(
      getWorkbenchCommandPaletteEnvironmentId({
        ...fallbacks,
        threadRef,
        threadOwnerId: environmentId,
      }),
    ).toBe(environmentId);
    // Off a Thread page, the usual fallbacks apply.
    expect(
      getWorkbenchCommandPaletteEnvironmentId({
        ...fallbacks,
        threadEnvironmentId: undefined,
        threadRef: null,
        threadOwnerId: null,
      }),
    ).toBe(primary);
  });

  it("keeps archived Workspace and Ticket navigation while omitting creation", () => {
    const targets = getWorkbenchCommandPaletteTargets({
      environmentId,
      snapshot: {
        ...snapshot,
        projects: snapshot.projects.map((project) => ({ ...project, archivedAt: time })),
      },
      workspaceId,
      threadRef: { environmentId, threadId },
    });
    expect(targets.board).toEqual({ environmentId, workbenchProjectId: workspaceId });
    expect(targets.ticket).toEqual({ environmentId, workbenchProjectId: workspaceId, ticketId });
    expect(targets.createTicket).toBeNull();
  });
  it("returns an assigned Thread to its Ticket in the remote environment through a validated route", async () => {
    const root = createRootRoute();
    const route = createRoute({
      getParentRoute: () => root,
      path: "/workbench",
      validateSearch: parseWorkbenchSearch,
    });
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ["/workbench"] }),
    });
    await router.load();
    const targets = getWorkbenchCommandPaletteTargets({
      environmentId,
      snapshot,
      workspaceId: undefined,
      threadRef: { environmentId, threadId },
    });
    if (!targets.ticket || !targets.createTicket)
      throw new Error("Expected assigned Ticket targets");
    await router.navigate({ to: "/workbench", search: targets.ticket });
    expect(router.state.location.search).toEqual({
      environmentId: "remote",
      workbenchProjectId: "workspace",
      ticketId: "ticket",
    });
    await router.navigate({ to: "/workbench", search: targets.createTicket });
    expect(router.state.location.search).toEqual({
      environmentId: "remote",
      workbenchProjectId: "workspace",
      create: "ticket",
    });
    expect(router.state.location.search).not.toHaveProperty("ticketId");
  });
  it("requires an explicit or assigned Workspace instead of choosing an arbitrary Workspace", () => {
    const unassigned = getWorkbenchCommandPaletteTargets({
      environmentId,
      snapshot,
      workspaceId: undefined,
      threadRef: { environmentId, threadId: ThreadId.make("unassigned") },
    });
    expect(unassigned).toEqual({ board: { environmentId }, createTicket: null, ticket: null });
    const explicit = getWorkbenchCommandPaletteTargets({
      environmentId,
      snapshot,
      workspaceId,
      threadRef: null,
    });
    expect(explicit.createTicket).toEqual({
      environmentId,
      workbenchProjectId: workspaceId,
      create: "ticket",
    });
    const removed = getWorkbenchCommandPaletteTargets({
      environmentId,
      snapshot,
      workspaceId: WorkbenchProjectId.make("removed"),
      threadRef: null,
    });
    expect(removed.createTicket).toBeNull();
  });
});
