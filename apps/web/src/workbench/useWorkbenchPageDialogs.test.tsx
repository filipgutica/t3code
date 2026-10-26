import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchEpicId,
  WorkbenchTicketId,
  type WorkbenchSnapshot,
  type WorkbenchTicketDraft,
} from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
  useLocation,
} from "@tanstack/react-router";
import { act, useEffect } from "react";
import { create } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import { useWorkbenchPageDialogs } from "./useWorkbenchPageDialogs";
import { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";
import { parseWorkbenchThreadSearch } from "./workbenchNavigation";
import { parseWorkbenchSearch } from "./workbenchSearch";
const command = vi.hoisted(() => vi.fn());
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => command }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
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
const setError = vi.fn();
const setPendingAction = () => {};
let latestDialogs: ReturnType<typeof useWorkbenchPageDialogs>;
function Harness({
  data,
  canOperate = true,
}: {
  data: WorkbenchSnapshot | null;
  canOperate?: boolean;
}) {
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
    snapshot: data,
    projects: [],
    canOperate,
    selection,
    setError,
    setPendingAction,
  });
  useEffect(() => {
    latestDialogs = dialogs;
  }, [dialogs]);
  return (
    <button
      data-open={dialogs.ticketDialogOpen}
      onClick={() => dialogs.handleTicketDialogOpenChange(false)}
    >
      Cancel
    </button>
  );
}
const draft: WorkbenchTicketDraft = {
  id: WorkbenchTicketId.make("planned-ticket"),
  projectId: workspaceId,
  threadId: ThreadId.make("planning-thread"),
  anchorProjectId: ProjectId.make("repo"),
  modelSelection: { instanceId: "codex", model: "gpt" } as WorkbenchTicketDraft["modelSelection"],
  revision: 4,
  phase: "planning",
  fields: {
    title: "Planned",
    markdown: "",
    kind: "story",
    epicId: null,
    repositoryProjectIds: [ProjectId.make("repo")],
    primaryT3ProjectId: ProjectId.make("repo"),
  },
  createdAt: time,
  updatedAt: time,
};
const mountRouter = async (entry: string) => {
  const root = createRootRoute();
  const workbench = createRoute({
    getParentRoute: () => root,
    path: "/workbench",
    validateSearch: parseWorkbenchSearch,
  });
  const thread = createRoute({
    getParentRoute: () => root,
    path: "/$environmentId/$threadId",
    validateSearch: parseWorkbenchThreadSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([workbench, thread]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  return router;
};
describe("ticket planning conversation navigation", () => {
  const workspaceEntry = "/workbench?environmentId=remote&workbenchProjectId=workspace";
  const mount = async (entry: string, data = snapshot, canOperate = true) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    command.mockClear();
    const router = await mountRouter(entry);
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        <RouterContextProvider router={router}>
          <Harness data={data} canOperate={canOperate} />
        </RouterContextProvider>,
      );
    });
    if (!renderer) throw new Error("Harness not mounted");
    const mounted = renderer;
    return {
      router,
      mounted,
      settle: async () => {
        await act(async () => {
          await router.load();
        });
      },
      unmount: () => act(async () => mounted.unmount()),
    };
  };

  it("rejects dialog writes and creation intents without operate permission", async () => {
    const { mounted, settle, unmount, router } = await mount(workspaceEntry, snapshot, false);
    try {
      await settle();
      await act(async () => {
        expect(await latestDialogs.saveWorkspace("Edited", [ProjectId.make("repo")])).toBe(false);
        expect(await latestDialogs.submitEpic("Epic", "Description")).toBe(false);
        expect(await latestDialogs.submitProject("Workspace", [ProjectId.make("repo")])).toBe(
          false,
        );
        latestDialogs.openTicketDialog();
        latestDialogs.openEpicDialog();
        latestDialogs.openTicketConversation();
      });
      expect(command).not.toHaveBeenCalled();
      expect(latestDialogs.ticketDialogOpen).toBe(false);
      expect(latestDialogs.epicDialogOpen).toBe(false);
      expect(mounted.root.findByType("button").props["data-open"]).toBe(false);
      expect(router.state.location.href).toBe(workspaceEntry);
    } finally {
      await unmount();
    }
  });

  it.each([undefined, false, true])(
    "requires host lifecycle support (%s) and sends the displayed Epic version",
    async (supported) => {
      const { settle, unmount } = await mount(workspaceEntry, {
        ...snapshot,
        ...(supported === undefined ? {} : { supportsEpicLifecycle: supported }),
      });
      const epic = {
        id: WorkbenchEpicId.make("epic"),
        projectId: workspaceId,
        title: "Epic",
        markdown: "",
        archivedAt: null,
        createdAt: time,
        updatedAt: time,
      };
      command.mockResolvedValue({ _tag: "Success", value: epic });
      try {
        await settle();
        for (const archivedAt of [time, null]) {
          await act(async () => {
            expect(await latestDialogs.setEpicArchived(epic, archivedAt)).toBe(supported === true);
          });
          if (supported === true) {
            expect(command).toHaveBeenLastCalledWith({
              environmentId,
              input: { id: epic.id, archivedAt, expectedUpdatedAt: time },
            });
          } else {
            expect(command).not.toHaveBeenCalled();
          }
        }
      } finally {
        await unmount();
        vi.unstubAllGlobals();
      }
    },
  );

  it("keeps create=ticket in the URL so reload and history resume the conversation", async () => {
    const { router, mounted, settle, unmount } = await mount(`${workspaceEntry}&create=ticket`);
    try {
      await settle();
      expect(router.state.location.search.create).toBe("ticket");
      // The manual form stays closed; it opens only from an explicit manual action.
      expect(mounted.root.findByType("button").props["data-open"]).toBe(false);
    } finally {
      await unmount();
      vi.unstubAllGlobals();
    }
  });

  it("opens the Workspace conversation and keeps the draft when it closes", async () => {
    const { router, settle, unmount } = await mount(workspaceEntry);
    try {
      await settle();
      await act(async () => latestDialogs.openTicketConversation());
      await settle();
      expect(router.state.location.search).toEqual({
        environmentId: "remote",
        workbenchProjectId: "workspace",
        create: "ticket",
      });
      await act(async () => latestDialogs.closeTicketConversation());
      await settle();
      expect(router.state.location.search).toEqual({
        environmentId: "remote",
        workbenchProjectId: "workspace",
      });
      expect(command).not.toHaveBeenCalled();
    } finally {
      await unmount();
      vi.unstubAllGlobals();
    }
  });

  it("selects the created ticket and continues the same native Thread on Start work", async () => {
    const { router, settle, unmount } = await mount(`${workspaceEntry}&create=ticket`);
    try {
      await settle();
      await act(async () => latestDialogs.openCreatedTicket(draft));
      await settle();
      // The draft id is the ticket id, so the route keeps the conversation's identity.
      expect(router.state.location.search).toEqual({
        environmentId: "remote",
        workbenchProjectId: "workspace",
        ticketId: draft.id,
      });
      await act(async () => latestDialogs.openDraftThread({ ...draft, phase: "working" }));
      await settle();
      expect(router.state.location.pathname).toBe(`/remote/${draft.threadId}`);
      expect(router.state.location.search).toEqual({ workbench: true });
      // Navigation only: no Thread is created or started from this path.
      expect(command).not.toHaveBeenCalled();
    } finally {
      await unmount();
      vi.unstubAllGlobals();
    }
  });
});
