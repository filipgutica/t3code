import { act, render as renderBrowser } from "../../test/render";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useLayoutEffect } from "react";
import { expect, it, vi } from "vite-plus/test";

import {
  useWorkbenchSidebarDraftMenu,
  useWorkbenchSidebarDrafts,
  type WorkbenchSidebarDraft,
} from "./WorkbenchSidebarDrafts";

const mocks = vi.hoisted(() => ({
  permission: true,
  discard: vi.fn(),
  refresh: vi.fn(),
  show: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => mocks.permission,
  useAtomRefresh: () => mocks.refresh,
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => mocks.discard }));
vi.mock("../localApi", () => ({
  readLocalApi: () => ({ contextMenu: { show: mocks.show, close: mocks.close } }),
}));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    discardTicketDraftInBatch: { permissionAtom: () => null },
    snapshot: () => null,
    ticketPreparations: () => null,
  },
}));

const environmentId = EnvironmentId.make("sidebar-host");
const workspaceId = WorkbenchProjectId.make("workspace");
const draft: WorkbenchSidebarDraft = {
  id: WorkbenchTicketId.make("draft"),
  title: "A draft",
  projectId: workspaceId,
  threadId: ThreadId.make("planning"),
  anchorProjectId: ProjectId.make("anchor"),
  modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt"),
  revision: 4,
  phase: "draft",
  fields: {
    title: "A draft",
    markdown: "",
    kind: "story",
    epicId: null,
    repositoryProjectIds: [],
    primaryT3ProjectId: null,
    localOnly: true,
    jiraSprintId: null,
  },
  createdAt: "2026-10-13T00:00:00.000Z",
  updatedAt: "2026-10-13T00:00:00.000Z",
};
async function setup() {
  let menu: ReturnType<typeof useWorkbenchSidebarDraftMenu>;
  let disclosure: ReturnType<typeof useWorkbenchSidebarDrafts>["disclosure"];
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: "/workbench" });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: ["/workbench?workbenchProjectId=workspace&ticketId=draft"],
    }),
  });
  const defaultDrafts = [draft];
  const noReadOnlyDrafts = new Set<WorkbenchTicketId>();
  function Harness({
    drafts = defaultDrafts,
    readOnlyDraftIds = noReadOnlyDrafts,
    selectedTicketId = draft.id,
  }: {
    drafts?: ReadonlyArray<WorkbenchSidebarDraft>;
    readOnlyDraftIds?: ReadonlySet<WorkbenchTicketId>;
    selectedTicketId?: WorkbenchTicketId;
  }) {
    const result = useWorkbenchSidebarDrafts({
      environmentId,
      drafts,
      writableWorkspaceIds: readOnlyDraftIds.has(draft.id) ? new Set() : new Set([workspaceId]),
      selectedWorkspaceId: workspaceId,
      selectedTicketId,
      selectedDraft: drafts.find((candidate) => candidate.id === selectedTicketId),
      onSelectWorkspace: (id) => {
        void router.navigate({
          to: "/workbench",
          search: { workbenchProjectId: id },
          replace: true,
        });
      },
    });
    useLayoutEffect(() => {
      menu = result.menu;
      disclosure = result.disclosure;
    });
    return null;
  }
  const request = () =>
    menu.openMenu({
      draftId: draft.id,
      trigger: document.createElement("button"),
      workspaceButton: null,
      position: { x: 10, y: 20 },
    });

  mocks.permission = true;
  mocks.discard.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  mocks.refresh.mockReset();
  mocks.show.mockReset().mockResolvedValue("discard");
  mocks.close.mockReset().mockResolvedValue(undefined);
  await router.navigate({
    to: "/workbench",
    search: { workbenchProjectId: workspaceId, ticketId: draft.id },
  });
  // This hook drives its own memory-router callback and does not consume router context.
  const screen = await renderBrowser(<Harness />, { router: false });
  return {
    get menu() {
      return menu;
    },
    get disclosure() {
      return disclosure;
    },
    router,
    request,
    rerender: (props: Parameters<typeof Harness>[0] = {}) =>
      screen.rerender(<Harness {...props} />),
    [Symbol.asyncDispose]: () => screen[Symbol.asyncDispose](),
  };
}

it("reveals an already-selected Draft explicitly while preserving disclosure on ordinary rerenders", async () => {
  await using context = await setup();
  await act(() => context.disclosure.toggle(workspaceId));
  expect(context.disclosure.collapsed.has(workspaceId)).toBe(true);

  await act(() => context.rerender({ drafts: [draft] }));
  expect(context.disclosure.collapsed.has(workspaceId)).toBe(true);

  await act(() => context.disclosure.reveal(workspaceId));
  expect(context.disclosure.collapsed.has(workspaceId)).toBe(false);

  await act(() => context.disclosure.reveal(workspaceId));
  expect(context.disclosure.collapsed.has(workspaceId)).toBe(false);
});

it("returns the current draft to its board when the last filtered row disappears during discard", async () => {
  await using context = await setup();
  let finish!: (result: { _tag: "Success"; value: undefined }) => void;
  mocks.discard.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    await context.request();
  });
  expect(context.menu.actions.confirmation?.open).toBe(true);
  let pending!: Promise<boolean>;
  await act(() => {
    pending = context.menu.actions.discard();
  });
  await act(() => context.rerender({ drafts: [] }));
  await act(async () => {
    finish({ _tag: "Success", value: undefined });
    await pending;
    await context.router.load();
  });
  expect(context.router.state.location.search).toEqual({ workbenchProjectId: workspaceId });
  expect(context.menu.actions.confirmation?.open).toBe(false);
  expect(context.menu.confirmationTitle).toBe("A draft");
  expect(mocks.discard).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { id: draft.id, expectedRevision: 4 },
  });
});

it("leaves a newly selected ticket open when a different draft finishes discarding", async () => {
  await using context = await setup();
  let finish!: (result: { _tag: "Success"; value: undefined }) => void;
  mocks.discard.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    await context.request();
  });
  let pending!: Promise<boolean>;
  await act(() => {
    pending = context.menu.actions.discard();
  });
  const other = WorkbenchTicketId.make("other-ticket");
  await context.router.navigate({
    to: "/workbench",
    search: { workbenchProjectId: workspaceId, ticketId: other },
  });
  await act(() => context.rerender({ selectedTicketId: other }));
  await act(async () => {
    finish({ _tag: "Success", value: undefined });
    await pending;
    await context.router.load();
  });
  expect(context.router.state.location.search).toEqual({
    workbenchProjectId: workspaceId,
    ticketId: other,
  });
});

it("dismisses pending draft menus and ignores late choices after the workspace becomes read-only", async () => {
  await using context = await setup();
  let choose!: (value: string) => void;
  mocks.show.mockImplementation(
    () =>
      new Promise((resolve) => {
        choose = resolve;
      }),
  );
  let pending!: Promise<void>;
  await act(() => {
    pending = context.request();
  });
  await act(() => context.rerender({ readOnlyDraftIds: new Set([draft.id]) }));
  await act(async () => {
    choose("discard");
    await pending;
  });
  expect(context.menu.actions.confirmation).toBeNull();
  expect(mocks.discard).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
});
