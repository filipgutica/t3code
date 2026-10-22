import { act, render as renderUI, type Screen } from "../../test/render";
import { useLayoutEffect, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import { useWorkbenchDraftActions } from "./useWorkbenchDraftActions";
import type { WorkbenchConversationDraft } from "./workbenchTicketDraft.logic";
const mocks = vi.hoisted(() => ({
  permission: true,
  discard: vi.fn(),
  refresh: vi.fn(),
  refreshPreparations: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => mocks.permission,
  useAtomRefresh: (atom: string) =>
    atom === "snapshot" ? mocks.refresh : mocks.refreshPreparations,
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => mocks.discard }));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    discardTicketDraftInBatch: { permissionAtom: () => null },
    snapshot: () => "snapshot",
    ticketPreparations: () => "preparations",
  },
}));
const environmentId = EnvironmentId.make("draft-host");
const draft = (id: string, revision = 0): WorkbenchConversationDraft => ({
  id: WorkbenchTicketId.make(id),
  projectId: WorkbenchProjectId.make("workspace"),
  threadId: ThreadId.make(id),
  anchorProjectId: ProjectId.make("anchor"),
  modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt"),
  revision,
  phase: "draft",
  fields: {
    title: id,
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
});
const first = draft("first");
const second = draft("second", 3);
const success = { _tag: "Success", value: undefined };
function setup() {
  const resources = new AsyncDisposableStack();
  let actions: ReturnType<typeof useWorkbenchDraftActions>;
  function Harness({
    onCommit,
    ...props
  }: Parameters<typeof useWorkbenchDraftActions>[0] & {
    onCommit?: () => void;
  }) {
    const result = useWorkbenchDraftActions(props);
    useLayoutEffect(() => {
      actions = result;
      onCommit?.();
    });
    return null;
  }
  let renderer: Screen;
  const mount = async (props: Partial<ComponentProps<typeof Harness>> = {}) => {
    renderer = resources.use(
      await renderUI(<Harness environmentId={environmentId} drafts={[first, second]} {...props} />),
    );
  };
  mocks.permission = true;
  mocks.discard.mockReset().mockResolvedValue(success);
  mocks.refresh.mockReset();
  mocks.refreshPreparations.mockReset();
  return {
    get actions() {
      return actions;
    },
    get renderer() {
      return renderer;
    },
    mount,
    Harness,
    async [Symbol.asyncDispose]() {
      await resources.disposeAsync();
    },
  };
}
describe("board draft discard", () => {
  it("does not discard on selection or confirmation cancellation", async () => {
    await using fixture = setup();
    await fixture.mount();
    await act(() => fixture.actions.selectAll());
    await act(() => fixture.actions.confirm(fixture.actions.selectedDrafts));
    expect(fixture.actions.confirmation?.drafts).toEqual([first, second]);
    await act(() => fixture.actions.closeConfirmation());
    expect(fixture.actions.selectedDrafts).toEqual([first, second]);
    expect(mocks.discard).not.toHaveBeenCalled();
    await act(() => fixture.actions.clearSelection());
    expect(fixture.actions.selectedDrafts).toEqual([]);
  });
  it("refreshes both queries once when the whole batch settles", async () => {
    await using fixture = setup();
    let finishSecond!: (value: typeof success) => void;
    mocks.discard.mockResolvedValueOnce(success).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSecond = resolve;
        }),
    );
    await fixture.mount();
    await act(() => fixture.actions.confirm([first, second]));
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = fixture.actions.discard();
    });
    expect(mocks.discard).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.refreshPreparations).not.toHaveBeenCalled();
    await act(async () => {
      finishSecond(success);
      await pending;
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.refreshPreparations).toHaveBeenCalledOnce();
  });
  it("never confirms hidden drafts or already saved ticket conversations", async () => {
    await using fixture = setup();
    await fixture.mount();
    await act(() => fixture.actions.selectAll());
    const saved = { ...first, phase: "planning" as const };
    await fixture.renderer.rerender(
      <fixture.Harness environmentId={environmentId} drafts={[second, saved]} />,
    );
    expect(fixture.actions.selectedDrafts).toEqual([second]);
    await act(() => fixture.actions.confirm([first, second, saved]));
    await act(async () => {
      await fixture.actions.discard();
    });
    expect(mocks.discard).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { id: second.id, expectedRevision: 3 },
    });
  });
  it("retries only failed drafts with their refreshed revision, including interrupted deletion", async () => {
    await using fixture = setup();
    mocks.discard.mockResolvedValueOnce(success).mockResolvedValueOnce({
      _tag: "Failure",
      cause: Cause.fail(new Error("Thread deletion failed")),
    });
    await fixture.mount();
    await act(() => fixture.actions.selectAll());
    await act(() => fixture.actions.confirm(fixture.actions.selectedDrafts));
    await act(async () => {
      await fixture.actions.discard();
    });
    expect(fixture.actions.confirmation?.open).toBe(false);
    expect(fixture.actions.selectedIds).toEqual(new Set([second.id]));
    expect(fixture.actions.error).toContain("1 discarded. 1 draft could not be discarded.");
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.refreshPreparations).toHaveBeenCalledOnce();
    const interrupted = { ...second, phase: "discarding" as const, revision: 4 };
    await fixture.renderer.rerender(
      <fixture.Harness environmentId={environmentId} drafts={[interrupted]} />,
    );
    await act(() => fixture.actions.confirm(fixture.actions.selectedDrafts));
    await act(async () => {
      await fixture.actions.discard();
    });
    expect(mocks.discard.mock.calls.map(([input]) => input.input)).toEqual([
      { id: first.id, expectedRevision: 0 },
      { id: second.id, expectedRevision: 3 },
      { id: second.id, expectedRevision: 4 },
    ]);
    expect(fixture.actions.selectedDrafts).toEqual([]);
    expect(fixture.actions.error).toBeNull();
    expect(fixture.actions.discardSucceeded).toBe(true);
  });
  it("stops the remainder when the view becomes read-only and prevents a duplicate batch", async () => {
    await using fixture = setup();
    let finishFirst!: (value: typeof success) => void;
    mocks.discard.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    await fixture.mount();
    await act(() => fixture.actions.confirm([first, second]));
    let pending!: Promise<boolean>;
    await act(() => {
      pending = fixture.actions.discard();
    });
    expect(fixture.actions.busy).toBe(true);
    await act(async () => {
      await fixture.actions.discard();
      fixture.actions.closeConfirmation();
    });
    expect(fixture.actions.confirmation).not.toBeNull();
    await fixture.renderer.rerender(
      <fixture.Harness environmentId={environmentId} drafts={[first, second]} readOnly />,
    );
    await act(async () => {
      finishFirst(success);
      await pending;
    });
    expect(mocks.discard).toHaveBeenCalledTimes(1);
    expect(fixture.actions.selectedIds).toEqual(new Set([second.id]));
    expect(fixture.actions.error).toContain("read-only or your permission changed");
  });
  it("honors a read-only commit before passive effects run", async () => {
    await using fixture = setup();
    await fixture.mount();
    await act(() => fixture.actions.confirm([first, second]));
    let pending!: Promise<boolean>;
    await fixture.renderer.rerender(
      <fixture.Harness
        environmentId={environmentId}
        drafts={[first, second]}
        readOnly
        onCommit={() => {
          if (!pending) pending = fixture.actions.discard();
        }}
      />,
    );
    await act(async () => {
      await pending;
    });
    expect(mocks.discard).not.toHaveBeenCalled();
    expect(fixture.actions.selectedIds).toEqual(new Set([first.id, second.id]));
    expect(fixture.actions.error).toContain("read-only or your permission changed");
  });
  it("stops a confirmed discard when its target workspace becomes read-only", async () => {
    await using fixture = setup();
    await fixture.mount();
    await act(() => fixture.actions.confirm([first, second]));
    await fixture.renderer.rerender(
      <fixture.Harness
        environmentId={environmentId}
        drafts={[first, second]}
        readOnlyDraftIds={new Set([second.id])}
      />,
    );
    await act(async () => {
      await fixture.actions.discard();
    });
    expect(mocks.discard).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { id: first.id, expectedRevision: 0 },
    });
    expect(fixture.actions.selectedIds).toEqual(new Set([second.id]));
    expect(fixture.actions.error).toContain("read-only or your permission changed");
    await act(() => fixture.actions.confirm([second]));
    expect(fixture.actions.confirmation?.open).toBe(false);
  });
  it("keeps confirmed records and revisions bound to their owning environment", async () => {
    await using fixture = setup();
    await fixture.mount();
    await act(() => fixture.actions.confirm([first]));
    const otherEnvironment = EnvironmentId.make("other-host");
    await fixture.renderer.rerender(
      <fixture.Harness environmentId={otherEnvironment} drafts={[draft("first", 9)]} />,
    );
    await act(async () => {
      await fixture.actions.discard();
    });
    expect(mocks.discard).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { id: first.id, expectedRevision: 0 },
    });
  });
  it("preserves other checked drafts when discarding one card individually", async () => {
    await using fixture = setup();
    await fixture.mount();
    await act(() => fixture.actions.selectAll());
    await act(() => fixture.actions.confirm([first]));
    await act(async () => {
      await fixture.actions.discard();
    });
    expect(fixture.actions.selectedIds).toEqual(new Set([second.id]));
    expect(mocks.discard).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { id: first.id, expectedRevision: 0 },
    });
  });
});
