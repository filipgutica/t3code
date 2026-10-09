import {
  EnvironmentId,
  ProjectId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WorkbenchEpicId,
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
import { act, useEffect, useState } from "react";
import * as Cause from "effect/Cause";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useWorkbenchWorkspaceActions } from "./useWorkbenchWorkspaceActions";
import { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";
import { parseWorkbenchSearch } from "./workbenchSearch";

const commands = vi.hoisted(() => ({ archive: vi.fn(), remove: vi.fn() }));
const grants = vi.hoisted(() => new Map<string, { archive: boolean; remove: boolean }>());
vi.mock("@effect/atom-react", () => ({
  useAtomValue: ({
    environmentId,
    action,
  }: {
    environmentId: string | null;
    action: "archive" | "remove";
  }) => environmentId !== null && (grants.get(environmentId)?.[action] ?? false),
}));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    archiveProject: {
      action: "archive",
      permissionAtom: (environmentId: EnvironmentId | null) => ({
        environmentId,
        action: "archive",
      }),
    },
    deleteProject: {
      action: "remove",
      permissionAtom: (environmentId: EnvironmentId | null) => ({
        environmentId,
        action: "remove",
      }),
    },
  },
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: { action: string }) =>
    command.action === "archive" ? commands.archive : commands.remove,
}));

const environmentId = EnvironmentId.make("remote");
const timestamp = "2026-10-09T00:00:00.000Z";
const workspace = {
  id: WorkbenchProjectId.make("workspace"),
  title: "Delivery",
  linkedProjectIds: [ProjectId.make("repo")],
  revision: 3,
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const archived = { ...workspace, id: WorkbenchProjectId.make("archived"), archivedAt: timestamp };
const next = { ...workspace, id: WorkbenchProjectId.make("next") };
const ticketId = WorkbenchTicketId.make("ticket");
const epicId = WorkbenchEpicId.make("epic");
const snapshot: WorkbenchSnapshot = {
  projects: [workspace, archived, next],
  tickets: [
    {
      id: ticketId,
      projectId: workspace.id,
      epicId,
      title: "Ticket",
      markdown: "",
      kind: "story",
      primaryT3ProjectId: ProjectId.make("repo"),
      repositoryProjectIds: [],
      status: "todo",
      blocked: false,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  epics: [
    {
      id: epicId,
      projectId: workspace.id,
      title: "Epic",
      markdown: "",
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  assignments: [],
  ticketWorkspaces: [],
  reservedThreadIds: [],
};
let actions: ReturnType<typeof useWorkbenchWorkspaceActions>;
let selection: ReturnType<typeof useWorkbenchPageSelection>;
let renderer: ReactTestRenderer;
let error: string | null;
function Harness({ data }: { data: WorkbenchSnapshot }) {
  const search = parseWorkbenchSearch(useLocation().search);
  const selectedEnvironmentId = search.environmentId ?? environmentId;
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [message, setError] = useState<string | null>(null);
  const currentActions = useWorkbenchWorkspaceActions({
    environmentId: selectedEnvironmentId,
    snapshot: data,
    pendingAction,
    setPendingAction,
    setError,
  });
  const currentSelection = useWorkbenchPageSelection({
    environmentId: selectedEnvironmentId,
    initialProjectId: search.workbenchProjectId,
    initialTicketId: search.ticketId,
    initialEpicId: search.epicId,
    snapshot: data,
    tickets: data.tickets,
    pendingAction,
    setError,
    excludedProjectIds: currentActions.deletedProjectIds,
  });
  useEffect(() => {
    error = message;
    actions = currentActions;
    selection = currentSelection;
  }, [message, currentActions, currentSelection]);
  return null;
}
const mount = async (
  data = snapshot,
  entry = "/workbench?environmentId=remote&workbenchProjectId=workspace&ticketId=ticket",
) => {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/workbench",
    validateSearch: parseWorkbenchSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  const page = (current: WorkbenchSnapshot) => (
    <RouterContextProvider router={router}>
      <Harness data={current} />
    </RouterContextProvider>
  );
  await act(async () => {
    renderer = create(page(data));
  });
  return {
    router,
    update: async (current: WorkbenchSnapshot) => {
      await act(async () => renderer.update(page(current)));
    },
  };
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  grants.clear();
  grants.set(environmentId, { archive: true, remove: true });
  commands.archive.mockReset().mockResolvedValue({ _tag: "Success", value: workspace });
  commands.remove.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

describe("Workspace lifecycle", () => {
  it("does not archive, restore, or open deletion for a read-only environment", async () => {
    grants.set(environmentId, { archive: false, remove: false });
    await mount();
    await act(async () => {
      await actions.setArchived(workspace);
      await actions.setArchived(archived);
      actions.requestDeletion(workspace);
    });
    expect(commands.archive).not.toHaveBeenCalled();
    expect(actions.deletion).toBeNull();
  });
  it("blocks confirmation after write grants are revoked and still permits cancellation", async () => {
    const { update, router } = await mount();
    await act(async () => actions.requestDeletion(workspace));
    grants.set(environmentId, { archive: false, remove: false });
    await update(snapshot);
    await act(async () => actions.removeWorkspace());
    expect(commands.remove).not.toHaveBeenCalled();
    expect(actions.deletion?.workspace.id).toBe(workspace.id);
    expect(router.state.location.search.ticketId).toBe(ticketId);
    await act(async () => actions.closeDeletion());
    expect(actions.deletion).toBeNull();
  });
  it("reads grants from the selected environment and keeps late deletion success on its owning host", async () => {
    const { router, update } = await mount();
    let resolveDeletion: (value: { _tag: "Success"; value: undefined }) => void = () => {};
    commands.remove.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDeletion = resolve;
      }),
    );
    await act(async () => actions.requestDeletion(workspace));
    let request: Promise<void> | undefined;
    await act(() => {
      request = actions.removeWorkspace();
    });
    const otherEnvironmentId = EnvironmentId.make("read-only-host");
    grants.set(otherEnvironmentId, { archive: false, remove: false });
    await act(async () =>
      router.navigate({
        to: "/workbench",
        search: { environmentId: otherEnvironmentId, workbenchProjectId: workspace.id },
      }),
    );
    await update(snapshot);
    expect(actions.deletion).toBeNull();
    await act(async () => {
      resolveDeletion({ _tag: "Success", value: undefined });
      await request;
    });
    await act(async () => {
      await actions.setArchived(workspace);
      actions.requestDeletion(workspace);
    });
    expect(commands.archive).not.toHaveBeenCalled();
    expect(actions.deletion).toBeNull();
    expect(actions.deletedProjectIds.has(workspace.id)).toBe(false);
    expect(router.state.location.search).toEqual({
      environmentId: otherEnvironmentId,
      workbenchProjectId: workspace.id,
    });
    await act(async () =>
      router.navigate({
        to: "/workbench",
        search: { environmentId, workbenchProjectId: next.id },
      }),
    );
    await update(snapshot);
    expect(actions.deletion).toBeNull();
    expect(actions.deletedProjectIds.has(workspace.id)).toBe(true);
    await act(async () => actions.removeWorkspace());
    expect(commands.remove).toHaveBeenCalledTimes(1);
    expect(router.state.location.search).toEqual({ environmentId, workbenchProjectId: next.id });
  });
  it("archives and restores in the selected environment using the reviewed revision", async () => {
    await mount();
    await act(async () => actions.setArchived(workspace));
    expect(commands.archive).toHaveBeenLastCalledWith({
      environmentId,
      input: {
        id: workspace.id,
        expectedRevision: 3,
        archivedAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    });
    await act(async () =>
      actions.setArchived({ ...workspace, archivedAt: timestamp, revision: 4 }),
    );
    expect(commands.archive).toHaveBeenLastCalledWith({
      environmentId,
      input: {
        id: workspace.id,
        expectedRevision: 4,
        archivedAt: null,
        updatedAt: expect.any(String),
      },
    });
    expect(commands.remove).not.toHaveBeenCalled();
  });
  it("keeps a failed delete confirmation and its reviewed counts through a snapshot refresh", async () => {
    const { update, router } = await mount();
    await act(async () => actions.requestDeletion(workspace));
    await update({
      ...snapshot,
      tickets: [
        ...snapshot.tickets,
        { ...snapshot.tickets[0]!, id: WorkbenchTicketId.make("added") },
      ],
    });
    commands.remove.mockResolvedValueOnce({
      _tag: "Failure",
      cause: Cause.fail(new Error("Workspace changed; review it again.")),
    });
    await act(async () => actions.removeWorkspace());
    expect(commands.remove).toHaveBeenCalledWith({
      environmentId,
      input: {
        id: workspace.id,
        expectedRevision: 3,
        expectedTicketCount: 1,
        expectedEpicCount: 1,
        deletedAt: expect.any(String),
      },
    });
    expect(actions.deletion?.ticketCount).toBe(1);
    expect(error).not.toBeNull();
    expect(router.state.location.search.ticketId).toBe(ticketId);
    await act(async () => actions.closeDeletion());
    expect(actions.deletion).toBeNull();
    expect(error).toBeNull();
    await act(async () => actions.requestDeletion(workspace));
    expect(actions.deletion?.ticketCount).toBe(2);
  });
  it("does not select a previously deleted Workspace while its snapshot still lags", async () => {
    const { router } = await mount();
    await act(async () => actions.requestDeletion(workspace));
    await act(async () => actions.removeWorkspace());
    expect(router.state.location.search).toEqual({ environmentId, workbenchProjectId: next.id });
    expect(actions.deletion).toBeNull();
    await act(async () => actions.requestDeletion(next));
    await act(async () => actions.removeWorkspace());
    expect(router.state.location.search).toEqual({ environmentId });
    expect(selection.selectedProject).toBeNull();
    expect(actions.deletedProjectIds).toEqual(new Set([workspace.id, next.id]));
  });
  it("reports a navigation failure after deletion and leaves lifecycle actions usable", async () => {
    const { router } = await mount();
    await act(async () => actions.requestDeletion(workspace));
    const navigation = vi
      .spyOn(router, "navigate")
      .mockRejectedValueOnce(new Error("Route failed"));
    await act(async () => actions.removeWorkspace());
    navigation.mockRestore();
    expect(error).toContain("Route failed");
    expect(actions.deletedProjectIds.has(workspace.id)).toBe(true);
    expect(actions.deletion).toBeNull();
    await act(async () => actions.requestDeletion(next));
    expect(actions.deletion?.workspace.id).toBe(next.id);
  });
  it("clears all child route IDs when no active Workspace remains", async () => {
    const { router, update } = await mount({ ...snapshot, projects: [workspace, archived] });
    await act(async () => actions.requestDeletion(workspace));
    await act(async () => actions.removeWorkspace());
    expect(router.state.location.search).toEqual({ environmentId });
    expect(selection.selectedProject).toBeNull();
    await update({ ...snapshot, projects: [archived], tickets: [], epics: [] });
    expect(router.state.location.search).toEqual({ environmentId });
    expect(selection.selectedProject).toBeNull();
  });
  it("defaults to an active Workspace while keeping explicitly routed archived Workspaces inspectable", async () => {
    const { router, update } = await mount(
      { ...snapshot, projects: [archived, next] },
      "/workbench?environmentId=remote",
    );
    expect(selection.selectedProject?.id).toBe(next.id);
    await act(async () =>
      router.navigate({
        to: "/workbench",
        search: { environmentId, workbenchProjectId: archived.id },
      }),
    );
    await update({ ...snapshot, projects: [archived, next] });
    expect(selection.selectedProject?.id).toBe(archived.id);
    await update({ ...snapshot, projects: [next], tickets: [], epics: [] });
    expect(router.state.location.search).toEqual({ environmentId, workbenchProjectId: next.id });
  });
  it.each([
    { child: "Ticket", search: "ticketId=ticket", expected: { ticketId } },
    { child: "Epic", search: "epicId=epic", expected: { epicId } },
  ])(
    "preserves a valid $child route when replacing a missing Workspace selection",
    async ({ search, expected }) => {
      const { router } = await mount(
        snapshot,
        `/workbench?environmentId=remote&workbenchProjectId=missing&${search}`,
      );
      expect(router.state.location.search).toEqual({
        environmentId,
        workbenchProjectId: workspace.id,
        ...expected,
      });
    },
  );
  it.each([
    { child: "Ticket", search: "ticketId=ticket", expected: { ticketId } },
    { child: "Epic", search: "epicId=epic", expected: { epicId } },
  ])(
    "keeps the environment and $child route when cancelling Workspace creation",
    async ({ search, expected }) => {
      const { router } = await mount(
        snapshot,
        `/workbench?environmentId=remote&workbenchProjectId=workspace&${search}&create=workspace`,
      );
      await act(async () => selection.handleWorkspaceDialogOpenChange(false));
      expect(router.state.location.search).toEqual({
        environmentId,
        workbenchProjectId: workspace.id,
        ...expected,
      });
    },
  );
  it.each([
    { child: "ticket", fallback: true },
    { child: "ticket", fallback: false },
    { child: "epic", fallback: true },
    { child: "epic", fallback: false },
  ] as const)(
    "expires creation waits before external Workspace deletion ($child, fallback: $fallback)",
    async ({ child, fallback }) => {
      const empty = { ...snapshot, projects: [], tickets: [], epics: [] };
      const { router, update } = await mount(empty, "/workbench?environmentId=remote");
      await act(async () => {
        selection.setAwaitingProjectId(workspace.id);
        selection.setSelectedProjectId(workspace.id);
        if (child === "ticket") {
          selection.setAwaitingTicketId(ticketId);
          selection.setSelectedTicketId(ticketId);
        } else {
          selection.setAwaitingEpicId(epicId);
          selection.setSelectedEpicId(epicId);
        }
        await router.navigate({
          to: "/workbench",
          search: {
            environmentId,
            workbenchProjectId: workspace.id,
            ...(child === "ticket" ? { ticketId } : { epicId }),
          },
        });
      });
      expect(selection.awaitingSelectedProject).toBe(true);
      await update({ ...snapshot, projects: [workspace] });
      expect(selection.awaitingSelectedProject).toBe(false);
      expect(selection.selectedProject?.id).toBe(workspace.id);
      await update({ ...empty, projects: fallback ? [next, archived] : [archived] });
      expect(selection.awaitingSelectedProject).toBe(false);
      expect(selection.selectedProject?.id ?? null).toBe(fallback ? next.id : null);
      expect(router.state.location.search).toEqual(
        fallback ? { environmentId, workbenchProjectId: next.id } : { environmentId },
      );
    },
  );
});
