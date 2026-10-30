import {
  EnvironmentId,
  ProjectId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchSnapshot,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useWorkbenchBoardViewStore } from "./workbenchBoardViewState";
import { useWorkbenchDraftStore } from "./workbenchDraftStore";
import { workbenchSnapshotReconciliation } from "./workbenchSnapshotReconciliation";

vi.mock("./state", () => ({
  workbenchEnvironment: {
    snapshot: ({ environmentId }: { environmentId: EnvironmentId }) => snapshots(environmentId),
  },
}));

const snapshots = Atom.family((_environmentId: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<WorkbenchSnapshot>>(AsyncResult.initial()),
);
const environmentId = EnvironmentId.make("snapshot-owner");
const otherEnvironmentId = EnvironmentId.make("other-snapshot-owner");
const projectId = WorkbenchProjectId.make("workspace");
const repositoryId = ProjectId.make("repository");
const timestamp = "2026-10-30T00:00:00.000Z";
const ticket = (id: string): WorkbenchTicket => ({
  id: WorkbenchTicketId.make(id),
  projectId,
  epicId: null,
  kind: "story",
  title: "Saved title",
  markdown: "Saved description",
  primaryT3ProjectId: repositoryId,
  repositoryProjectIds: [repositoryId],
  status: "todo",
  blocked: false,
  revision: 2,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const snapshot = (
  tickets: ReadonlyArray<WorkbenchTicket> = [],
  linkedProjectIds: ReadonlyArray<ProjectId> = [repositoryId],
): WorkbenchSnapshot => ({
  projects: [
    {
      id: projectId,
      title: "Workspace",
      linkedProjectIds,
      revision: 0,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  tickets,
  epics: [],
  assignments: [],
  references: [],
  threadRecaps: [],
  ticketWorkspaces: [],
  reservedThreadIds: [],
});
let registry: AtomRegistry.AtomRegistry;
beforeEach(() => {
  registry = AtomRegistry.make();
  useWorkbenchDraftStore.setState({ drafts: new Map() });
  useWorkbenchBoardViewStore.setState({ views: new Map(), mountedBoards: new Map() });
});
afterEach(() => registry.dispose());

it.each(["projection first", "save first"] as const)(
  "releases projected saved overlays with %s while retaining newer edits and other environments",
  (order) => {
    registry.mount(workbenchSnapshotReconciliation(environmentId));
    const saved = ticket("saved"),
      edited = ticket("edited");
    const submitted = {
      title: saved.title,
      markdown: saved.markdown,
      revision: 1,
      mode: "editing" as const,
    };
    const store = useWorkbenchDraftStore.getState();
    store.setDraft(environmentId, saved.id, submitted);
    store.setDraft(environmentId, edited.id, { ...submitted, title: "Newer typing" });
    store.setDraft(otherEnvironmentId, saved.id, {
      ...submitted,
      mode: "saved",
      savedVersion: { revision: 2 },
    });
    const publish = () =>
      registry.set(snapshots(environmentId), AsyncResult.success(snapshot([saved, edited])));
    if (order === "projection first") publish();
    store.markDraftSaved(environmentId, saved.id, saved, submitted);
    store.markDraftSaved(environmentId, edited.id, edited, submitted);
    if (order === "save first") publish();
    const current = useWorkbenchDraftStore.getState().drafts;
    expect(current.get(environmentId)?.has(saved.id)).toBe(false);
    expect(current.get(environmentId)?.get(edited.id)).toMatchObject({
      title: "Newer typing",
      mode: "editing",
      revision: 2,
    });
    expect(current.get(otherEnvironmentId)?.get(saved.id)?.mode).toBe("saved");
  },
);

it("keeps pre-hydration filters, then clears a removed repository without restoring it on re-add", () => {
  const key = JSON.stringify([environmentId, projectId]);
  const otherKey = JSON.stringify([otherEnvironmentId, projectId]);
  const store = useWorkbenchBoardViewStore.getState();
  const preferences = {
    repositoryId,
    searchText: "welcome",
    groupMode: "epic" as const,
    attentionMode: "attention" as const,
    mobileColumnId: "todo",
  };
  store.update(key, preferences);
  store.update(otherKey, preferences);
  const release = store.mountBoard(key);
  registry.mount(workbenchSnapshotReconciliation(environmentId));
  const view = () => useWorkbenchBoardViewStore.getState().views.get(key);
  expect(view()).toEqual(preferences);
  registry.set(snapshots(environmentId), AsyncResult.success(snapshot()));
  expect(view()?.repositoryId).toBe(repositoryId);
  registry.set(snapshots(environmentId), AsyncResult.success(snapshot([], [])));
  expect(view()).toEqual({ ...preferences, repositoryId: null });
  registry.set(snapshots(environmentId), AsyncResult.success(snapshot()));
  expect(view()).toEqual({ ...preferences, repositoryId: null });
  expect(useWorkbenchBoardViewStore.getState().views.get(otherKey)).toEqual(preferences);
  release();
});

it("retains an inactive Workspace filter when its repository disappears and returns", () => {
  const key = JSON.stringify([environmentId, projectId]);
  const store = useWorkbenchBoardViewStore.getState();
  store.update(key, { repositoryId });
  registry.mount(workbenchSnapshotReconciliation(environmentId));
  registry.set(snapshots(environmentId), AsyncResult.success(snapshot([], [])));
  expect(useWorkbenchBoardViewStore.getState().views.get(key)?.repositoryId).toBe(repositoryId);
  registry.set(snapshots(environmentId), AsyncResult.success(snapshot()));
  const release = store.mountBoard(key);
  expect(useWorkbenchBoardViewStore.getState().views.get(key)?.repositoryId).toBe(repositoryId);
  release();
});
