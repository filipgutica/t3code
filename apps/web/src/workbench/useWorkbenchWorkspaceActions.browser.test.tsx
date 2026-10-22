import { act, render as renderUI, type Screen } from "../../test/render";
import {
  EnvironmentId,
  ThreadId,
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
import { useEffect, useState } from "react";
import * as Cause from "effect/Cause";
import { describe, expect, it, vi } from "vite-plus/test";
import { useWorkbenchWorkspaceActions } from "./useWorkbenchWorkspaceActions";
import { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";
import { parseWorkbenchSearch } from "./workbenchSearch";
const commands = vi.hoisted(() => ({ archive: vi.fn(), remove: vi.fn() }));
const grants = vi.hoisted(
  () =>
    new Map<
      string,
      {
        archive: boolean;
        remove: boolean;
      }
    >(),
);
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
function setup() {
  const resources = new AsyncDisposableStack();
  // The fixture supplies its router context or mocks navigation; avoid a second router.
  let actions: ReturnType<typeof useWorkbenchWorkspaceActions>;
  let selection: ReturnType<typeof useWorkbenchPageSelection>;
  let renderer: Screen;
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
    renderer = resources.use(await renderUI(page(data), { router: false }));
    return {
      router,
      update: async (current: WorkbenchSnapshot) => {
        await renderer.rerender(page(current));
      },
    };
  };
  grants.clear();
  grants.set(environmentId, { archive: true, remove: true });
  commands.archive.mockReset().mockResolvedValue({ _tag: "Success", value: workspace });
  commands.remove.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  return {
    get actions() {
      return actions;
    },
    get selection() {
      return selection;
    },
    get renderer() {
      return renderer;
    },
    get error() {
      return error;
    },
    mount,
    async [Symbol.asyncDispose]() {
      await resources.disposeAsync();
    },
  };
}
it("preserves a draft deep link without requiring a Ticket record and falls back after discard", async () => {
  await using fixture = setup();
  const draftId = WorkbenchTicketId.make("draft");
  const draft = {
    id: draftId,
    projectId: workspace.id,
    threadId: ThreadId.make("draft-thread"),
    anchorProjectId: ProjectId.make("repo"),
    modelSelection: { instanceId: "codex", model: "gpt" } as NonNullable<
      WorkbenchSnapshot["ticketDrafts"]
    >[number]["modelSelection"],
    revision: 1,
    phase: "draft" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
    fields: {
      title: "Try retries",
      markdown: "",
      kind: "story" as const,
      epicId: null,
      repositoryProjectIds: [],
      primaryT3ProjectId: null,
      localOnly: false,
      jiraSprintId: null,
    },
  };
  const { router, update } = await fixture.mount(
    { ...snapshot, ticketDrafts: [draft] },
    "/workbench?environmentId=remote&workbenchProjectId=workspace&ticketId=draft",
  );
  expect(router.state.location.search.ticketId).toBe(draftId);
  expect(fixture.selection.selectedTicketId).toBe(draftId);
  expect(fixture.selection.selectedTicket).toBeNull();
  await act(async () => fixture.selection.setAwaitingTicketId(draftId));
  await update({ ...snapshot, ticketDrafts: [draft] });
  expect(fixture.selection.awaitingTicketId).toBeNull();
  await update({ ...snapshot, ticketDrafts: [] });
  expect(router.state.location.search.ticketId).toBeUndefined();
});
describe("Workspace lifecycle", () => {
  it("does not archive, restore, or open deletion for a read-only environment", async () => {
    await using fixture = setup();
    grants.set(environmentId, { archive: false, remove: false });
    await fixture.mount();
    await act(async () => {
      await fixture.actions.setArchived(workspace);
      await fixture.actions.setArchived(archived);
      fixture.actions.requestDeletion(workspace);
    });
    expect(commands.archive).not.toHaveBeenCalled();
    expect(fixture.actions.deletion).toBeNull();
  });
  it("blocks confirmation after write grants are revoked and still permits cancellation", async () => {
    await using fixture = setup();
    const { update, router } = await fixture.mount();
    await act(async () => fixture.actions.requestDeletion(workspace));
    grants.set(environmentId, { archive: false, remove: false });
    await update(snapshot);
    await act(async () => fixture.actions.removeWorkspace());
    expect(commands.remove).not.toHaveBeenCalled();
    expect(fixture.actions.deletion?.workspace.id).toBe(workspace.id);
    expect(router.state.location.search.ticketId).toBe(ticketId);
    await act(async () => fixture.actions.closeDeletion());
    expect(fixture.actions.deletion).toBeNull();
  });
  it("reads grants from the selected environment and keeps late deletion success on its owning host", async () => {
    await using fixture = setup();
    const { router, update } = await fixture.mount();
    let resolveDeletion: (value: { _tag: "Success"; value: undefined }) => void = () => {};
    commands.remove.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDeletion = resolve;
      }),
    );
    await act(async () => fixture.actions.requestDeletion(workspace));
    let request: Promise<void> | undefined;
    await act(() => {
      request = fixture.actions.removeWorkspace();
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
    expect(fixture.actions.deletion).toBeNull();
    await act(async () => {
      resolveDeletion({ _tag: "Success", value: undefined });
      await request;
    });
    await act(async () => {
      await fixture.actions.setArchived(workspace);
      fixture.actions.requestDeletion(workspace);
    });
    expect(commands.archive).not.toHaveBeenCalled();
    expect(fixture.actions.deletion).toBeNull();
    expect(fixture.actions.deletedProjectIds.has(workspace.id)).toBe(false);
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
    expect(fixture.actions.deletion).toBeNull();
    expect(fixture.actions.deletedProjectIds.has(workspace.id)).toBe(true);
    await act(async () => fixture.actions.removeWorkspace());
    expect(commands.remove).toHaveBeenCalledTimes(1);
    expect(router.state.location.search).toEqual({ environmentId, workbenchProjectId: next.id });
  });
  it("archives and restores in the selected environment using the reviewed revision", async () => {
    await using fixture = setup();
    await fixture.mount();
    await act(async () => fixture.actions.setArchived(workspace));
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
      fixture.actions.setArchived({ ...workspace, archivedAt: timestamp, revision: 4 }),
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
    await using fixture = setup();
    const { update, router } = await fixture.mount();
    await act(async () => fixture.actions.requestDeletion(workspace));
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
    await act(async () => fixture.actions.removeWorkspace());
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
    expect(fixture.actions.deletion?.ticketCount).toBe(1);
    expect(fixture.error).not.toBeNull();
    expect(router.state.location.search.ticketId).toBe(ticketId);
    await act(async () => fixture.actions.closeDeletion());
    expect(fixture.actions.deletion).toBeNull();
    expect(fixture.error).toBeNull();
    await act(async () => fixture.actions.requestDeletion(workspace));
    expect(fixture.actions.deletion?.ticketCount).toBe(2);
  });
  it("does not select a previously deleted Workspace while its snapshot still lags", async () => {
    await using fixture = setup();
    const { router } = await fixture.mount();
    await act(async () => fixture.actions.requestDeletion(workspace));
    await act(async () => fixture.actions.removeWorkspace());
    expect(router.state.location.search).toEqual({ environmentId, workbenchProjectId: next.id });
    expect(fixture.actions.deletion).toBeNull();
    await act(async () => fixture.actions.requestDeletion(next));
    await act(async () => fixture.actions.removeWorkspace());
    expect(router.state.location.search).toEqual({ environmentId });
    expect(fixture.selection.selectedProject).toBeNull();
    expect(fixture.actions.deletedProjectIds).toEqual(new Set([workspace.id, next.id]));
  });
  it("reports a navigation failure after deletion and leaves lifecycle actions usable", async () => {
    await using fixture = setup();
    const { router } = await fixture.mount();
    await act(async () => fixture.actions.requestDeletion(workspace));
    const navigation = vi
      .spyOn(router, "navigate")
      .mockRejectedValueOnce(new Error("Route failed"));
    await act(async () => fixture.actions.removeWorkspace());
    navigation.mockRestore();
    expect(fixture.error).toContain("Route failed");
    expect(fixture.actions.deletedProjectIds.has(workspace.id)).toBe(true);
    expect(fixture.actions.deletion).toBeNull();
    await act(async () => fixture.actions.requestDeletion(next));
    expect(fixture.actions.deletion?.workspace.id).toBe(next.id);
  });
  it("clears all child route IDs when no active Workspace remains", async () => {
    await using fixture = setup();
    const { router, update } = await fixture.mount({
      ...snapshot,
      projects: [workspace, archived],
    });
    await act(async () => fixture.actions.requestDeletion(workspace));
    await act(async () => fixture.actions.removeWorkspace());
    expect(router.state.location.search).toEqual({ environmentId });
    expect(fixture.selection.selectedProject).toBeNull();
    await update({ ...snapshot, projects: [archived], tickets: [], epics: [] });
    expect(router.state.location.search).toEqual({ environmentId });
    expect(fixture.selection.selectedProject).toBeNull();
  });
  it("defaults to an active Workspace while keeping explicitly routed archived Workspaces inspectable", async () => {
    await using fixture = setup();
    const { router, update } = await fixture.mount(
      { ...snapshot, projects: [archived, next] },
      "/workbench?environmentId=remote",
    );
    expect(fixture.selection.selectedProject?.id).toBe(next.id);
    await act(async () =>
      router.navigate({
        to: "/workbench",
        search: { environmentId, workbenchProjectId: archived.id },
      }),
    );
    await update({ ...snapshot, projects: [archived, next] });
    expect(fixture.selection.selectedProject?.id).toBe(archived.id);
    await update({ ...snapshot, projects: [next], tickets: [], epics: [] });
    expect(router.state.location.search).toEqual({ environmentId, workbenchProjectId: next.id });
  });
  it.each([
    { child: "Ticket", search: "ticketId=ticket", expected: { ticketId } },
    { child: "Epic", search: "epicId=epic", expected: { epicId } },
  ])(
    "preserves a valid $child route when replacing a missing Workspace selection",
    async ({ search, expected }) => {
      await using fixture = setup();
      const { router } = await fixture.mount(
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
      await using fixture = setup();
      const { router } = await fixture.mount(
        snapshot,
        `/workbench?environmentId=remote&workbenchProjectId=workspace&${search}&create=workspace`,
      );
      await act(async () => fixture.selection.handleWorkspaceDialogOpenChange(false));
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
      await using fixture = setup();
      const empty = { ...snapshot, projects: [], tickets: [], epics: [] };
      const { router, update } = await fixture.mount(empty, "/workbench?environmentId=remote");
      await act(async () => {
        fixture.selection.setAwaitingProjectId(workspace.id);
        fixture.selection.setSelectedProjectId(workspace.id);
        if (child === "ticket") {
          fixture.selection.setAwaitingTicketId(ticketId);
          fixture.selection.setSelectedTicketId(ticketId);
        } else {
          fixture.selection.setAwaitingEpicId(epicId);
          fixture.selection.setSelectedEpicId(epicId);
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
      expect(fixture.selection.awaitingSelectedProject).toBe(true);
      await update({ ...snapshot, projects: [workspace] });
      expect(fixture.selection.awaitingSelectedProject).toBe(false);
      expect(fixture.selection.selectedProject?.id).toBe(workspace.id);
      await update({ ...empty, projects: fallback ? [next, archived] : [archived] });
      expect(fixture.selection.awaitingSelectedProject).toBe(false);
      expect(fixture.selection.selectedProject?.id ?? null).toBe(fallback ? next.id : null);
      expect(router.state.location.search).toEqual(
        fallback ? { environmentId, workbenchProjectId: next.id } : { environmentId },
      );
    },
  );
});
