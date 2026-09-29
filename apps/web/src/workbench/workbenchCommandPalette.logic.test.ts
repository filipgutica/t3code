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
import { getWorkbenchCommandPaletteTargets } from "./workbenchCommandPalette.logic";
import { parseWorkbenchSearch } from "./workbenchSearch";
const environmentId = EnvironmentId.make("remote");
const workspaceId = WorkbenchProjectId.make("workspace");
const threadId = ThreadId.make("thread");
const ticketId = WorkbenchTicketId.make("ticket");
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
  tickets: [
    {
      id: ticketId,
      projectId: workspaceId,
      epicId: null,
      title: "Ticket",
      markdown: "Scope",
      kind: "story",
      status: "todo",
      blocked: false,
      primaryT3ProjectId: ProjectId.make("repo"),
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
  epics: [],
  reservedThreadIds: [],
  ticketWorkspaces: [],
};
describe("Workbench command navigation", () => {
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
      threadId,
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
      threadId: ThreadId.make("unassigned"),
    });
    expect(unassigned).toEqual({ board: { environmentId }, createTicket: null, ticket: null });
    const explicit = getWorkbenchCommandPaletteTargets({
      environmentId,
      snapshot,
      workspaceId,
      threadId: undefined,
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
      threadId: undefined,
    });
    expect(removed.createTicket).toBeNull();
  });
});
