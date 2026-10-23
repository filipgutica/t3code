import { act, render as renderUI, type Screen } from "../../test/render";
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
import { useEffect } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { useWorkbenchPageDialogs } from "./useWorkbenchPageDialogs";
import { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";
import { parseWorkbenchThreadSearch } from "./workbenchNavigation";
import { parseWorkbenchSearch } from "./workbenchSearch";
const command = vi.hoisted(() => vi.fn());
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => command }));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => true,
}));
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
function setup() {
  const resources = new AsyncDisposableStack();
  // The fixture supplies its router context or mocks navigation; avoid a second router.
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
      localOnlySupported: false,
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
      localOnly: false,
      jiraSprintId: null,
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
  const mount = async (entry: string, data = snapshot, canOperate = true) => {
    command.mockClear();
    const router = await mountRouter(entry);
    let renderer: Screen | undefined;
    renderer = resources.use(
      await renderUI(
        <RouterContextProvider router={router}>
          <Harness data={data} canOperate={canOperate} />
        </RouterContextProvider>,
        { router: false },
      ),
    );
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
      unmount: async () => await mounted.unmount(),
    };
  };
  return {
    get latestDialogs() {
      return latestDialogs;
    },
    mount,
    setError,
    draft,
    async [Symbol.asyncDispose]() {
      await resources.disposeAsync();
    },
  };
}
describe("ticket planning conversation navigation", () => {
  const workspaceEntry = "/workbench?environmentId=remote&workbenchProjectId=workspace";
  it("rejects dialog writes and creation intents without operate permission", async () => {
    await using fixture = setup();
    const { mounted, settle, unmount, router } = await fixture.mount(
      workspaceEntry,
      snapshot,
      false,
    );
    try {
      await settle();
      await act(async () => {
        expect(await fixture.latestDialogs.saveWorkspace("Edited", [ProjectId.make("repo")])).toBe(
          false,
        );
        expect(await fixture.latestDialogs.submitEpic("Epic", "Description")).toBe(false);
        expect(
          await fixture.latestDialogs.submitProject("Workspace", [ProjectId.make("repo")]),
        ).toBe(false);
        fixture.latestDialogs.openTicketDialog();
        fixture.latestDialogs.openEpicDialog();
        fixture.latestDialogs.openTicketConversation();
      });
      expect(command).not.toHaveBeenCalled();
      expect(fixture.latestDialogs.ticketDialogOpen).toBe(false);
      expect(fixture.latestDialogs.epicDialogOpen).toBe(false);
      expect(mounted.container.querySelector("button")?.getAttribute("data-open")).toBe("false");
      expect(router.state.location.href).toBe(workspaceEntry);
    } finally {
      await unmount();
    }
  });
  it.each([undefined, false, true])(
    "requires host lifecycle support (%s) and sends the displayed Epic version",
    async (supported) => {
      await using fixture = setup();
      const { settle, unmount } = await fixture.mount(workspaceEntry, {
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
            expect(await fixture.latestDialogs.setEpicArchived(epic, archivedAt)).toBe(
              supported === true,
            );
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
    await using fixture = setup();
    const { router, mounted, settle, unmount } = await fixture.mount(
      `${workspaceEntry}&create=ticket`,
    );
    try {
      await settle();
      expect(router.state.location.search.create).toBe("ticket");
      // The manual form stays closed; it opens only from an explicit manual action.
      expect(mounted.container.querySelector("button")?.getAttribute("data-open")).toBe("false");
    } finally {
      await unmount();
      vi.unstubAllGlobals();
    }
  });
  it("opens the Workspace conversation and keeps the draft when it closes", async () => {
    await using fixture = setup();
    const { router, settle, unmount } = await fixture.mount(workspaceEntry);
    try {
      await settle();
      await act(async () => fixture.latestDialogs.openTicketConversation());
      await settle();
      expect(router.state.location.search).toEqual({
        environmentId: "remote",
        workbenchProjectId: "workspace",
        create: "ticket",
      });
      await act(async () => fixture.latestDialogs.closeTicketConversation());
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
    await using fixture = setup();
    const { router, settle, unmount } = await fixture.mount(`${workspaceEntry}&create=ticket`);
    try {
      await settle();
      await act(async () => fixture.latestDialogs.openCreatedTicket(fixture.draft));
      await settle();
      // The draft id is the ticket id, so the route keeps the conversation's identity.
      expect(router.state.location.search).toEqual({
        environmentId: "remote",
        workbenchProjectId: "workspace",
        ticketId: fixture.draft.id,
      });
      await act(async () =>
        fixture.latestDialogs.openDraftThread({ ...fixture.draft, phase: "working" }),
      );
      await settle();
      expect(router.state.location.pathname).toBe(`/remote/${fixture.draft.threadId}`);
      expect(router.state.location.search).toEqual({ workbench: true });
      // Navigation only: no Thread is created or started from this path.
      expect(command).not.toHaveBeenCalled();
    } finally {
      await unmount();
      vi.unstubAllGlobals();
    }
  });
  it("still refuses local-only tickets on hosts that cannot store them", async () => {
    await using fixture = setup();
    const { settle, unmount } = await fixture.mount(workspaceEntry);
    try {
      await settle();
      await act(async () => {
        expect(
          await fixture.latestDialogs.submitTicket({
            id: WorkbenchTicketId.make("local-ticket"),
            title: "Keep local",
            markdown: "",
            kind: "story",
            epicId: null,
            primaryT3ProjectId: ProjectId.make("repo"),
            repositoryProjectIds: [ProjectId.make("repo")],
            localOnly: true,
          }),
        ).toBe(false);
      });
      expect(command).not.toHaveBeenCalled();
      expect(fixture.setError).toHaveBeenLastCalledWith(
        "Update this environment before creating local-only Tickets.",
      );
    } finally {
      await unmount();
      vi.unstubAllGlobals();
    }
  });
});
