import { act, useLayoutEffect, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
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
let actions: ReturnType<typeof useWorkbenchDraftActions>;
function Harness({
  onCommit,
  ...props
}: Parameters<typeof useWorkbenchDraftActions>[0] & { onCommit?: () => void }) {
  const result = useWorkbenchDraftActions(props);
  useLayoutEffect(() => {
    actions = result;
    onCommit?.();
  });
  return null;
}
let renderer: ReactTestRenderer;
const mount = (props: Partial<ComponentProps<typeof Harness>> = {}) => {
  act(() => {
    renderer = create(
      <Harness environmentId={environmentId} drafts={[first, second]} {...props} />,
    );
  });
};

describe("board draft discard", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.permission = true;
    mocks.discard.mockReset().mockResolvedValue(success);
    mocks.refresh.mockReset();
    mocks.refreshPreparations.mockReset();
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  });

  it("does not discard on selection or confirmation cancellation", () => {
    mount();
    act(() => actions.selectAll());
    act(() => actions.confirm(actions.selectedDrafts));
    expect(actions.confirmation?.drafts).toEqual([first, second]);
    act(() => actions.closeConfirmation());
    expect(actions.selectedDrafts).toEqual([first, second]);
    expect(mocks.discard).not.toHaveBeenCalled();
    act(() => actions.clearSelection());
    expect(actions.selectedDrafts).toEqual([]);
  });

  it("refreshes both queries once when the whole batch settles", async () => {
    let finishSecond!: (value: typeof success) => void;
    mocks.discard.mockResolvedValueOnce(success).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSecond = resolve;
        }),
    );
    mount();
    act(() => actions.confirm([first, second]));
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = actions.discard();
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
    mount();
    act(() => actions.selectAll());
    const saved = { ...first, phase: "planning" as const };
    act(() => renderer.update(<Harness environmentId={environmentId} drafts={[second, saved]} />));
    expect(actions.selectedDrafts).toEqual([second]);
    act(() => actions.confirm([first, second, saved]));
    await act(async () => {
      await actions.discard();
    });
    expect(mocks.discard).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { id: second.id, expectedRevision: 3 },
    });
  });

  it("retries only failed drafts with their refreshed revision, including interrupted deletion", async () => {
    mocks.discard.mockResolvedValueOnce(success).mockResolvedValueOnce({
      _tag: "Failure",
      cause: Cause.fail(new Error("Thread deletion failed")),
    });
    mount();
    act(() => actions.selectAll());
    act(() => actions.confirm(actions.selectedDrafts));
    await act(async () => {
      await actions.discard();
    });
    expect(actions.confirmation?.open).toBe(false);
    expect(actions.selectedIds).toEqual(new Set([second.id]));
    expect(actions.error).toContain("1 discarded. 1 draft could not be discarded.");
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.refreshPreparations).toHaveBeenCalledOnce();
    const interrupted = { ...second, phase: "discarding" as const, revision: 4 };
    act(() => renderer.update(<Harness environmentId={environmentId} drafts={[interrupted]} />));
    act(() => actions.confirm(actions.selectedDrafts));
    await act(async () => {
      await actions.discard();
    });
    expect(mocks.discard.mock.calls.map(([input]) => input.input)).toEqual([
      { id: first.id, expectedRevision: 0 },
      { id: second.id, expectedRevision: 3 },
      { id: second.id, expectedRevision: 4 },
    ]);
    expect(actions.selectedDrafts).toEqual([]);
    expect(actions.error).toBeNull();
    expect(actions.discardSucceeded).toBe(true);
  });

  it("stops the remainder when the view becomes read-only and prevents a duplicate batch", async () => {
    let finishFirst!: (value: typeof success) => void;
    mocks.discard.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    mount();
    act(() => actions.confirm([first, second]));
    let pending!: Promise<boolean>;
    act(() => {
      pending = actions.discard();
    });
    expect(actions.busy).toBe(true);
    await act(async () => {
      await actions.discard();
      actions.closeConfirmation();
    });
    expect(actions.confirmation).not.toBeNull();
    act(() =>
      renderer.update(<Harness environmentId={environmentId} drafts={[first, second]} readOnly />),
    );
    await act(async () => {
      finishFirst(success);
      await pending;
    });
    expect(mocks.discard).toHaveBeenCalledTimes(1);
    expect(actions.selectedIds).toEqual(new Set([second.id]));
    expect(actions.error).toContain("read-only or your permission changed");
  });

  it("honors a read-only commit before passive effects run", async () => {
    mount();
    act(() => actions.confirm([first, second]));
    let pending!: Promise<boolean>;
    act(() =>
      renderer.update(
        <Harness
          environmentId={environmentId}
          drafts={[first, second]}
          readOnly
          onCommit={() => {
            if (!pending) pending = actions.discard();
          }}
        />,
      ),
    );
    await act(async () => {
      await pending;
    });
    expect(mocks.discard).not.toHaveBeenCalled();
    expect(actions.selectedIds).toEqual(new Set([first.id, second.id]));
    expect(actions.error).toContain("read-only or your permission changed");
  });

  it("keeps confirmed records and revisions bound to their owning environment", async () => {
    mount();
    act(() => actions.confirm([first]));
    const otherEnvironment = EnvironmentId.make("other-host");
    act(() =>
      renderer.update(<Harness environmentId={otherEnvironment} drafts={[draft("first", 9)]} />),
    );
    await act(async () => {
      await actions.discard();
    });
    expect(mocks.discard).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { id: first.id, expectedRevision: 0 },
    });
  });
  it("preserves other checked drafts when discarding one card individually", async () => {
    mount();
    act(() => actions.selectAll());
    act(() => actions.confirm([first]));
    await act(async () => {
      await actions.discard();
    });
    expect(actions.selectedIds).toEqual(new Set([second.id]));
    expect(mocks.discard).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { id: first.id, expectedRevision: 0 },
    });
  });
});
