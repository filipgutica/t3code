// @vitest-environment jsdom

import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchEpicId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type ModelSelection,
  type WorkbenchTicketDraft,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { act, useEffect } from "react";
import { create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  useTicketDraftBegin,
  useTicketDraftEditor,
  useTicketDraftTransitions,
} from "./useWorkbenchTicketConversation";

const commands = vi.hoisted(() => ({
  begin: vi.fn(),
  update: vi.fn(),
  promote: vi.fn(),
  startWork: vi.fn(),
  discard: vi.fn(),
}));
const toast = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("./state", () => ({
  workbenchEnvironment: {
    beginTicketDraft: "begin",
    updateTicketDraft: "update",
    promoteTicketDraft: "promote",
    startTicketDraftWork: "startWork",
    discardTicketDraft: "discard",
  },
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: keyof typeof commands) => commands[command],
}));
vi.mock("../components/ui/toast", () => ({ toastManager: toast }));

const environmentId = EnvironmentId.make("environment");
const workspaceId = WorkbenchProjectId.make("workspace");
const epicId = WorkbenchEpicId.make("epic");
const modelSelection = { instanceId: "codex", model: "gpt" } as ModelSelection;
const time = "2026-10-09T00:00:00.000Z";

const makeDraft = (overrides: Partial<WorkbenchTicketDraft> = {}): WorkbenchTicketDraft => ({
  id: WorkbenchTicketId.make("ticket"),
  projectId: workspaceId,
  threadId: ThreadId.make("thread"),
  anchorProjectId: ProjectId.make("repo"),
  modelSelection,
  revision: 1,
  phase: "draft",
  fields: {
    title: "",
    markdown: "",
    kind: "story",
    epicId: null,
    repositoryProjectIds: [],
    primaryT3ProjectId: null,
    localOnly: false,
    jiraSprintId: null,
  },
  createdAt: time,
  updatedAt: time,
  ...overrides,
});

type BeginHook = ReturnType<typeof useTicketDraftBegin>;
type BeginOptions = Parameters<typeof useTicketDraftBegin>[0];

const mountBegin = async (options: Partial<BeginOptions> = {}) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onDraft = vi.fn();
  const refreshSnapshot = vi.fn();
  let latest: BeginHook | undefined;
  let currentOptions = options;
  function Harness({ options }: { readonly options: Partial<BeginOptions> }) {
    const hook = useTicketDraftBegin({
      environmentId,
      workspaceId,
      enabled: true,
      modelSelection,
      draft: null,
      initialEpicId: null,
      onDraft,
      refreshSnapshot,
      ...options,
    });
    useEffect(() => {
      latest = hook;
    });
    return null;
  }
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(<Harness options={currentOptions} />);
  });
  return {
    onDraft,
    refreshSnapshot,
    state: () => latest?.state,
    retry: () => act(async () => latest?.retry()),
    /** Navigates the mounted hook to another scope without remounting it. */
    rerender: async (next: Partial<BeginOptions>) => {
      currentOptions = { ...currentOptions, ...next };
      await act(async () => renderer?.update(<Harness options={currentOptions} />));
    },
    unmount: () => act(async () => renderer?.unmount()),
  };
};

afterEach(() => {
  for (const command of Object.values(commands)) command.mockReset();
  toast.add.mockReset();
  vi.unstubAllGlobals();
});

describe("useTicketDraftBegin", () => {
  it("hands the editor a draft that already carries the seeded Epic", async () => {
    const created = makeDraft({ revision: 1 });
    const seeded = makeDraft({ revision: 2, fields: { ...created.fields, epicId } });
    commands.begin.mockResolvedValueOnce(AsyncResult.success(created));
    commands.update.mockResolvedValueOnce(AsyncResult.success(seeded));
    const harness = await mountBegin({ initialEpicId: epicId });
    try {
      expect(commands.begin).toHaveBeenCalledWith({
        environmentId,
        input: expect.objectContaining({ projectId: workspaceId, modelSelection }),
      });
      expect(commands.update).toHaveBeenCalledWith({
        environmentId,
        input: expect.objectContaining({
          id: created.id,
          expectedRevision: 1,
          fields: expect.objectContaining({ epicId }),
        }),
      });
      // One hand-off, after the seed: an earlier one would let the first edit save epicId null.
      expect(harness.onDraft).toHaveBeenCalledTimes(1);
      expect(harness.onDraft).toHaveBeenCalledWith(seeded);
    } finally {
      await harness.unmount();
      vi.unstubAllGlobals();
      commands.begin.mockReset();
      commands.update.mockReset();
    }
  });

  it("keeps the created draft when the Epic seed fails", async () => {
    const created = makeDraft();
    commands.begin.mockResolvedValueOnce(AsyncResult.success(created));
    commands.update.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("changed"))));
    const harness = await mountBegin({ initialEpicId: epicId });
    try {
      expect(harness.onDraft).toHaveBeenCalledOnce();
      expect(harness.onDraft).toHaveBeenCalledWith(created);
    } finally {
      await harness.unmount();
      vi.unstubAllGlobals();
      commands.begin.mockReset();
      commands.update.mockReset();
    }
  });

  it.each(["switch", "unmount"] as const)(
    "does not deliver a late begin after %s",
    async (action) => {
      let resolveBegin: (
        value: ReturnType<typeof AsyncResult.success<WorkbenchTicketDraft>>,
      ) => void = () => {};
      commands.begin.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveBegin = resolve;
        }),
      );
      const harness = await mountBegin();
      try {
        const input = commands.begin.mock.calls[0]![0].input;
        if (action === "switch")
          await harness.rerender({
            requestedDraftId: WorkbenchTicketId.make("selected-other"),
            draft: makeDraft({ id: WorkbenchTicketId.make("selected-other") }),
          });
        else await harness.unmount();
        await act(async () =>
          resolveBegin(AsyncResult.success(makeDraft({ id: input.id, threadId: input.threadId }))),
        );
        expect(harness.onDraft).not.toHaveBeenCalled();
        expect(commands.begin).toHaveBeenCalledOnce();
      } finally {
        if (action === "switch") await harness.unmount();
      }
    },
  );

  it("repeats a failed begin with the same ids and refreshes the snapshot", async () => {
    commands.begin.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("A ticket draft already exists."))),
    );
    commands.begin.mockResolvedValueOnce(AsyncResult.success(makeDraft()));
    const harness = await mountBegin();
    try {
      expect(harness.state()).toEqual({
        status: "failed",
        message: "A ticket draft already exists.",
      });
      expect(harness.refreshSnapshot).toHaveBeenCalledOnce();
      expect(harness.onDraft).not.toHaveBeenCalled();
      await harness.retry();
      const [first, second] = commands.begin.mock.calls.map(([call]) => call.input);
      expect(second.id).toBe(first.id);
      expect(second.threadId).toBe(first.threadId);
      expect(harness.onDraft).toHaveBeenCalledOnce();
    } finally {
      await harness.unmount();
      vi.unstubAllGlobals();
      commands.begin.mockReset();
    }
  });

  it("finishes an interrupted begin with the draft's own ids instead of opening another", async () => {
    const interrupted = makeDraft({ phase: "creating", revision: 0 });
    commands.begin.mockResolvedValueOnce(
      AsyncResult.success({ ...interrupted, phase: "draft", revision: 1 }),
    );
    const harness = await mountBegin({ draft: interrupted, modelSelection: null });
    try {
      expect(commands.begin).toHaveBeenCalledOnce();
      expect(commands.begin).toHaveBeenCalledWith({
        environmentId,
        input: {
          id: interrupted.id,
          threadId: interrupted.threadId,
          projectId: workspaceId,
          modelSelection: interrupted.modelSelection,
        },
      });
    } finally {
      await harness.unmount();
      vi.unstubAllGlobals();
      commands.begin.mockReset();
    }
  });

  it("recovers a persisted creating draft after a failed begin without replacing its ids", async () => {
    commands.begin.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("The reply was lost."))),
    );
    const harness = await mountBegin();
    try {
      const first = commands.begin.mock.calls[0]![0].input;
      const persisted = makeDraft({
        id: first.id,
        threadId: first.threadId,
        phase: "creating",
        revision: 0,
      });
      const recovered = { ...persisted, phase: "draft" as const, revision: 1 };
      commands.begin.mockResolvedValueOnce(AsyncResult.success(recovered));
      await harness.rerender({ draft: persisted, modelSelection: null });
      expect(commands.begin).toHaveBeenCalledOnce();
      expect(harness.state()).toEqual({ status: "failed", message: "The reply was lost." });
      await harness.retry();
      expect(commands.begin).toHaveBeenCalledTimes(2);
      expect(commands.begin.mock.calls[1]![0]).toEqual({
        environmentId,
        input: {
          id: persisted.id,
          threadId: persisted.threadId,
          projectId: workspaceId,
          modelSelection: persisted.modelSelection,
        },
      });
      expect(harness.onDraft).toHaveBeenCalledOnce();
      expect(harness.onDraft).toHaveBeenCalledWith(recovered);
      expect(harness.state()).toEqual({ status: "idle" });
    } finally {
      await harness.unmount();
    }
  });

  it("does not begin until a planning model is available", async () => {
    const harness = await mountBegin({ modelSelection: null });
    try {
      expect(commands.begin).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      vi.unstubAllGlobals();
    }
  });
  it("never calls the RPC on a host that predates conversation drafts", async () => {
    const harness = await mountBegin({ enabled: false });
    try {
      expect(commands.begin).not.toHaveBeenCalled();
      expect(harness.state()).toEqual({ status: "idle" });
    } finally {
      await harness.unmount();
    }
  });

  it("begins again with fresh ids for another environment's Workspace and drops the old reply", async () => {
    const otherEnvironment = EnvironmentId.make("other-environment");
    const resolvers: Array<(value: unknown) => void> = [];
    commands.begin.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    const harness = await mountBegin();
    try {
      await harness.rerender({ environmentId: otherEnvironment });
      expect(commands.begin).toHaveBeenCalledTimes(2);
      const [first, second] = commands.begin.mock.calls.map(([call]) => call);
      expect(second.environmentId).toBe(otherEnvironment);
      expect(second.input.projectId).toBe(first.input.projectId);
      expect(second.input.id).not.toBe(first.input.id);
      expect(second.input.threadId).not.toBe(first.input.threadId);
      const stale = makeDraft({ id: first.input.id });
      const current = makeDraft({ id: second.input.id });
      await act(async () => resolvers[1]!(AsyncResult.success(current)));
      await act(async () => resolvers[0]!(AsyncResult.success(stale)));
      expect(harness.onDraft).toHaveBeenCalledOnce();
      expect(harness.onDraft).toHaveBeenCalledWith(current);
    } finally {
      await harness.unmount();
    }
  });
});

type EditorOptions = Parameters<typeof useTicketDraftEditor>[0];
type TransitionOptions = Parameters<typeof useTicketDraftTransitions>[0];

const mountEditor = async (initial: WorkbenchTicketDraft = makeDraft()) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onDraft = vi.fn();
  const onClose = vi.fn();
  const onCreateManually = vi.fn();
  const onDiscarded = vi.fn();
  const refreshSnapshot = vi.fn();
  let latest:
    | {
        editor: ReturnType<typeof useTicketDraftEditor>;
        transitions: ReturnType<typeof useTicketDraftTransitions>;
      }
    | undefined;
  function Harness({ draft }: { readonly draft: WorkbenchTicketDraft }) {
    const editorOptions: EditorOptions = { environmentId, draft, onDraft, refreshSnapshot };
    const editor = useTicketDraftEditor(editorOptions);
    const transitionOptions: TransitionOptions = {
      environmentId,
      draft,
      editor,
      onDraft,
      onTicketCreated: vi.fn(),
      onWorkStarted: vi.fn(),
      onDiscarded,
      onClose,
      onCreateManually,
      refreshSnapshot,
    };
    const transitions = useTicketDraftTransitions(transitionOptions);
    useEffect(() => {
      latest = { editor, transitions };
    });
    return null;
  }
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(<Harness draft={initial} />);
  });
  return {
    onDraft,
    onClose,
    onCreateManually,
    onDiscarded,
    refreshSnapshot,
    editor: () => latest!.editor,
    transitions: () => latest!.transitions,
    /** Delivers a draft the way the snapshot or another command reply does. */
    receive: async (next: WorkbenchTicketDraft) => {
      await act(async () => renderer?.update(<Harness draft={next} />));
    },
    run: <A,>(step: () => Promise<A>) => act(step),
    unmount: () => act(async () => renderer?.unmount()),
  };
};

describe("useTicketDraftEditor", () => {
  it("adopts a draft changed elsewhere, so the next edit saves on top of it", async () => {
    commands.update.mockResolvedValue(AsyncResult.success(makeDraft({ revision: 3 })));
    const harness = await mountEditor(makeDraft({ revision: 1 }));
    try {
      const remote = makeDraft({
        revision: 2,
        fields: { ...makeDraft().fields, markdown: "written elsewhere" },
      });
      await harness.receive(remote);
      expect(harness.editor().fields.markdown).toBe("written elsewhere");
      await harness.run(async () => harness.editor().edit({ title: "mine" }));
      await harness.run(() => harness.editor().flush());
      expect(commands.update).toHaveBeenCalledWith({
        environmentId,
        input: {
          id: remote.id,
          expectedRevision: 2,
          fields: { ...remote.fields, title: "mine" },
        },
      });
    } finally {
      await harness.unmount();
    }
  });

  it("offers a conflict instead of overwriting when unsaved edits meet a newer draft", async () => {
    const harness = await mountEditor(makeDraft({ revision: 1 }));
    try {
      await harness.run(async () => harness.editor().edit({ title: "mine" }));
      const remote = makeDraft({
        revision: 2,
        fields: { ...makeDraft().fields, title: "theirs" },
      });
      await harness.receive(remote);
      expect(harness.editor().conflict?.revision).toBe(2);
      expect(harness.editor().fields.title).toBe("mine");
      await harness.run(() => harness.editor().flush());
      expect(commands.update).not.toHaveBeenCalled();
      await harness.run(async () => harness.editor().reload());
      expect(harness.editor().conflict).toBeNull();
      expect(harness.editor().fields.title).toBe("theirs");
    } finally {
      await harness.unmount();
    }
  });

  it("refreshes the snapshot when a save is rejected and keeps the edit", async () => {
    commands.update.mockResolvedValue(
      AsyncResult.failure(Cause.fail(new Error("This ticket draft changed."))),
    );
    const harness = await mountEditor();
    try {
      await harness.run(async () => harness.editor().edit({ title: "mine" }));
      await harness.run(() => harness.editor().flush());
      expect(harness.refreshSnapshot).toHaveBeenCalled();
      expect(harness.editor().saveError).toBe("This ticket draft changed.");
      expect(harness.editor().fields.title).toBe("mine");
    } finally {
      await harness.unmount();
    }
  });

  it("becomes editable again when a Jira failure that wrote nothing restores the draft phase", async () => {
    commands.update.mockResolvedValue(AsyncResult.success(makeDraft({ revision: 4 })));
    const harness = await mountEditor(makeDraft({ revision: 1 }));
    try {
      await harness.receive(makeDraft({ revision: 2, phase: "promoting" }));
      expect(harness.editor().editable).toBe(false);
      await harness.receive(makeDraft({ revision: 3, phase: "draft" }));
      expect(harness.editor().editable).toBe(true);
      await harness.run(async () => harness.editor().edit({ title: "again" }));
      await harness.run(() => harness.editor().flush());
      expect(commands.update.mock.calls[0]![0].input.expectedRevision).toBe(3);
    } finally {
      await harness.unmount();
    }
  });
});

describe("useTicketDraftTransitions", () => {
  it.each(["close", "createManually"] as const)(
    "%s keeps the editor open with the edits when saving fails, and proceeds once it succeeds",
    async (step) => {
      commands.update.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Offline."))));
      commands.update.mockResolvedValueOnce(AsyncResult.success(makeDraft({ revision: 2 })));
      const harness = await mountEditor();
      const proceeded = () => (step === "close" ? harness.onClose : harness.onCreateManually);
      try {
        await harness.run(async () => harness.editor().edit({ title: "keep me" }));
        expect(await harness.run(() => harness.transitions()[step]())).toBe(false);
        expect(proceeded()).not.toHaveBeenCalled();
        expect(harness.transitions().error).toBe("Offline.");
        expect(toast.add).toHaveBeenCalledOnce();
        expect(harness.editor().fields.title).toBe("keep me");
        expect(await harness.run(() => harness.transitions()[step]())).toBe(true);
        expect(proceeded()).toHaveBeenCalledOnce();
      } finally {
        await harness.unmount();
      }
    },
  );

  it("discards against the newest saved revision when a conflict is open", async () => {
    commands.discard.mockResolvedValue(AsyncResult.success(undefined));
    const harness = await mountEditor(makeDraft({ revision: 1 }));
    try {
      await harness.run(async () => harness.editor().edit({ title: "mine" }));
      await harness.receive(makeDraft({ revision: 5 }));
      expect(await harness.run(() => harness.transitions().discard())).toBe(true);
      expect(commands.update).not.toHaveBeenCalled();
      expect(commands.discard).toHaveBeenCalledWith({
        environmentId,
        input: { id: makeDraft().id, expectedRevision: 5 },
      });
      expect(harness.onDiscarded).toHaveBeenCalledOnce();
    } finally {
      await harness.unmount();
    }
  });

  it("reports a failed discard so the dialog stays open", async () => {
    commands.discard.mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("Busy."))));
    const harness = await mountEditor();
    try {
      expect(await harness.run(() => harness.transitions().discard())).toBe(false);
      expect(harness.transitions().error).toBe("Busy.");
      expect(harness.onDiscarded).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  it("does not save abandoned fields on unmount after a successful discard", async () => {
    commands.update.mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("Offline."))));
    commands.discard.mockResolvedValue(AsyncResult.success(undefined));
    const harness = await mountEditor();
    await harness.run(async () => harness.editor().edit({ title: "discard me" }));
    expect(await harness.run(() => harness.transitions().discard())).toBe(true);
    expect(harness.editor().hasPendingEdits()).toBe(false);
    expect(harness.onDiscarded).toHaveBeenCalledOnce();
    await harness.unmount();
    expect(commands.update).toHaveBeenCalledOnce();
  });
});
