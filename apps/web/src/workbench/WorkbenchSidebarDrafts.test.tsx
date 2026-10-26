// @vitest-environment jsdom
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
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

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
  },
  createdAt: "2026-10-13T00:00:00.000Z",
  updatedAt: "2026-10-13T00:00:00.000Z",
};
let menu: ReturnType<typeof useWorkbenchSidebarDraftMenu>;
let disclosure: ReturnType<typeof useWorkbenchSidebarDrafts>["disclosure"];
let renderer: ReactTestRenderer;
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
      void router.navigate({ to: "/workbench", search: { workbenchProjectId: id }, replace: true });
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

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.permission = true;
  mocks.discard.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  mocks.refresh.mockReset();
  mocks.show.mockReset().mockResolvedValue("discard");
  mocks.close.mockReset().mockResolvedValue(undefined);
  await router.navigate({
    to: "/workbench",
    search: { workbenchProjectId: workspaceId, ticketId: draft.id },
  });
  act(() => {
    renderer = create(<Harness />);
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("reveals an already-selected Draft explicitly while preserving disclosure on ordinary rerenders", () => {
  act(() => disclosure.toggle(workspaceId));
  expect(disclosure.collapsed.has(workspaceId)).toBe(true);

  act(() => renderer.update(<Harness drafts={[draft]} />));
  expect(disclosure.collapsed.has(workspaceId)).toBe(true);

  act(() => disclosure.reveal(workspaceId));
  expect(disclosure.collapsed.has(workspaceId)).toBe(false);

  act(() => disclosure.reveal(workspaceId));
  expect(disclosure.collapsed.has(workspaceId)).toBe(false);
});

it("returns the current draft to its board when the last filtered row disappears during discard", async () => {
  let finish!: (result: { _tag: "Success"; value: undefined }) => void;
  mocks.discard.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    await request();
  });
  expect(menu.actions.confirmation?.open).toBe(true);
  let pending!: Promise<boolean>;
  act(() => {
    pending = menu.actions.discard();
  });
  act(() => renderer.update(<Harness drafts={[]} />));
  await act(async () => {
    finish({ _tag: "Success", value: undefined });
    await pending;
    await router.load();
  });
  expect(router.state.location.search).toEqual({ workbenchProjectId: workspaceId });
  expect(menu.actions.confirmation?.open).toBe(false);
  expect(menu.confirmationTitle).toBe("A draft");
  expect(mocks.discard).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { id: draft.id, expectedRevision: 4 },
  });
});

it("leaves a newly selected ticket open when a different draft finishes discarding", async () => {
  let finish!: (result: { _tag: "Success"; value: undefined }) => void;
  mocks.discard.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    await request();
  });
  let pending!: Promise<boolean>;
  act(() => {
    pending = menu.actions.discard();
  });
  const other = WorkbenchTicketId.make("other-ticket");
  await router.navigate({
    to: "/workbench",
    search: { workbenchProjectId: workspaceId, ticketId: other },
  });
  act(() => renderer.update(<Harness selectedTicketId={other} />));
  await act(async () => {
    finish({ _tag: "Success", value: undefined });
    await pending;
    await router.load();
  });
  expect(router.state.location.search).toEqual({
    workbenchProjectId: workspaceId,
    ticketId: other,
  });
});

it("dismisses pending draft menus and ignores late choices after the workspace becomes read-only", async () => {
  let choose!: (value: string) => void;
  mocks.show.mockImplementation(
    () =>
      new Promise((resolve) => {
        choose = resolve;
      }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = request();
  });
  act(() => renderer.update(<Harness readOnlyDraftIds={new Set([draft.id])} />));
  await act(async () => {
    choose("discard");
    await pending;
  });
  expect(menu.actions.confirmation).toBeNull();
  expect(mocks.discard).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
});
