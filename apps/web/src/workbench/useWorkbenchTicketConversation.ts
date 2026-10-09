import type {
  EnvironmentId,
  ModelSelection,
  WorkbenchEpicId,
  WorkbenchProjectId,
  WorkbenchTicketDraftFields,
} from "@t3tools/contracts";
import { ThreadId, WorkbenchTicketId } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { toastManager } from "../components/ui/toast";
import { randomUUID } from "../lib/utils";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { failureMessage } from "./workbenchPageCommands";
import type { WorkbenchConversationDraft } from "./workbenchTicketDraft.logic";
import { createTicketDraftFieldSync } from "./workbenchTicketDraftSync";

const SAVE_DELAY_MS = 600;

type BeginState =
  | { readonly status: "idle" | "pending" }
  | { readonly status: "failed"; readonly message: string };

type BeginRequest = { scope: string; id: WorkbenchTicketId; threadId: ThreadId };

/** Reuses this scope's request so a retry repeats the same begin; another scope gets fresh ids. */
const beginRequestFor = ({
  existing,
  scope,
  recoverable,
}: {
  readonly existing: BeginRequest | null;
  readonly scope: string;
  readonly recoverable: Pick<WorkbenchConversationDraft, "id" | "threadId"> | null;
}): BeginRequest => {
  if (existing?.scope === scope && (recoverable === null || existing.id === recoverable.id))
    return existing;
  return recoverable
    ? { scope, id: recoverable.id, threadId: recoverable.threadId }
    : {
        scope,
        id: WorkbenchTicketId.make(randomUUID()),
        threadId: ThreadId.make(randomUUID()),
      };
};

/**
 * Starts the Workspace's planning conversation once per environment and Workspace. The request
 * ids are kept so a retry after a lost reply repeats the same begin instead of opening a second
 * draft; they belong to one scope, so another environment's Workspace with the same id never
 * reuses them, and a reply that arrives after the scope changed is dropped. A draft stuck in
 * `creating` (the page closed mid-begin) is recovered with its own ids. `enabled` is false for a
 * host that predates conversation drafts, which never receives the RPC.
 */
export function useTicketDraftBegin({
  environmentId,
  workspaceId,
  enabled,
  modelSelection,
  draft,
  initialEpicId,
  onDraft,
  refreshSnapshot,
  requestedDraftId = null,
}: {
  readonly requestedDraftId?: WorkbenchTicketId | null;
  readonly environmentId: EnvironmentId;
  readonly workspaceId: WorkbenchProjectId;
  readonly enabled: boolean;
  readonly modelSelection: ModelSelection | null;
  readonly draft: WorkbenchConversationDraft | null;
  readonly initialEpicId: WorkbenchEpicId | null;
  readonly onDraft: (draft: WorkbenchConversationDraft) => void;
  readonly refreshSnapshot: () => void;
}) {
  const beginDraft = useAtomCommand(workbenchEnvironment.beginTicketDraft, {
    reportFailure: false,
  });
  const updateDraft = useAtomCommand(workbenchEnvironment.updateTicketDraft, {
    reportFailure: false,
  });
  const [state, setState] = useState<BeginState>({ status: "idle" });
  const scope = `${environmentId}:${workspaceId}:${requestedDraftId ?? "new"}`;
  const scopeRef = useRef<string | null>(scope);
  useEffect(() => {
    scopeRef.current = scope;
    return () => {
      scopeRef.current = null;
    };
  }, [scope]);
  const requestRef = useRef<BeginRequest | null>(null);
  const startedScopeRef = useRef<string | null>(null);

  const begin = useCallback(async () => {
    const recovering = draft !== null && draft.phase === "creating";
    const selection = recovering ? draft.modelSelection : modelSelection;
    if (!enabled || selection === null) return;
    const request = beginRequestFor({
      existing: requestRef.current,
      scope,
      recoverable: recovering ? draft : null,
    });
    requestRef.current = request;
    startedScopeRef.current = `${scope}:${request.id}`;
    setState({ status: "pending" });
    const result = await beginDraft({
      environmentId,
      input: {
        id: request.id,
        threadId: request.threadId,
        projectId: workspaceId,
        modelSelection: selection,
      },
    });
    if (scopeRef.current !== scope) return;
    if (result._tag === "Failure") {
      // A draft created elsewhere is the usual cause; the refreshed snapshot resumes it.
      refreshSnapshot();
      setState({ status: "failed", message: failureMessage(result) });
      return;
    }
    // Seed before handing the draft to the editor, so its first save cannot clear the Epic.
    // A failed seed leaves a valid draft; the Epic remains editable in the form.
    const seeded =
      !recovering && initialEpicId !== null
        ? await updateDraft({
            environmentId,
            input: {
              id: result.value.id,
              expectedRevision: result.value.revision,
              fields: { ...result.value.fields, epicId: initialEpicId },
            },
          })
        : null;
    if (scopeRef.current !== scope) return;
    onDraft(seeded?._tag === "Success" ? seeded.value : result.value);
    setState({ status: "idle" });
  }, [
    beginDraft,
    draft,
    enabled,
    environmentId,
    initialEpicId,
    modelSelection,
    onDraft,
    refreshSnapshot,
    scope,
    updateDraft,
    workspaceId,
  ]);

  const needsBegin =
    enabled && (draft === null ? modelSelection !== null : draft.phase === "creating");
  const beginScope = `${scope}:${draft?.id ?? "new"}`;
  useEffect(() => {
    if (!needsBegin || startedScopeRef.current === beginScope) return;
    startedScopeRef.current = beginScope;
    void begin();
  }, [begin, needsBegin, beginScope]);

  const retry = useCallback(() => {
    void begin();
  }, [begin]);
  return { state, retry };
}

/**
 * Keeps the editable fields locally and saves them with the server's revision, so typing never
 * waits on the network. Create ticket, Start work, Close, and unmount all flush first. A save the
 * server rejects refreshes the snapshot, so a draft that changed elsewhere surfaces as `conflict`.
 */
export function useTicketDraftEditor({
  environmentId,
  draft,
  onDraft,
  refreshSnapshot,
}: {
  readonly environmentId: EnvironmentId;
  readonly draft: WorkbenchConversationDraft;
  readonly onDraft: (draft: WorkbenchConversationDraft) => void;
  readonly refreshSnapshot: () => void;
}) {
  const updateDraft = useAtomCommand(workbenchEnvironment.updateTicketDraft, {
    reportFailure: false,
  });
  const [sync] = useState(() =>
    createTicketDraftFieldSync({
      initial: draft,
      onSaved: onDraft,
      save: async ({ expectedRevision, fields }) => {
        const result = await updateDraft({
          environmentId,
          input: { id: draft.id, expectedRevision, fields },
        });
        return result._tag === "Failure"
          ? { ok: false, message: failureMessage(result) }
          : { ok: true, draft: result.value };
      },
    }),
  );
  const { fields, conflict } = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const editable = draft.phase === "draft";

  const clearTimer = useCallback(() => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const flush = useCallback(async () => {
    clearTimer();
    if (!sync.hasPendingEdits()) return sync.flush();
    setSaveState("saving");
    const outcome = await sync.flush();
    setSaveState(outcome.ok ? "saved" : "error");
    setSaveError(outcome.ok ? null : outcome.message);
    // The server may have rejected the revision; the refreshed snapshot reveals a conflict.
    if (!outcome.ok) refreshSnapshot();
    return outcome;
  }, [clearTimer, refreshSnapshot, sync]);
  const edit = useCallback(
    (patch: Partial<WorkbenchTicketDraftFields>) => {
      if (!editable) return;
      sync.edit(patch);
      clearTimer();
      // A conflict blocks saving, so a timer would only repeat the conflict message.
      if (sync.getSnapshot().conflict !== null) return;
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [clearTimer, editable, flush, sync],
  );
  const reload = useCallback(() => {
    sync.reload();
    setSaveState("idle");
    setSaveError(null);
  }, [sync]);
  const keepMine = useCallback(() => {
    sync.keepMine();
    void flush();
  }, [flush, sync]);

  useEffect(() => {
    sync.adopt(draft);
  }, [draft, sync]);
  // Leaving the page by any route still saves the last edits; the command outlives the component.
  useEffect(
    () => () => {
      clearTimer();
      void sync.flush();
    },
    [clearTimer, sync],
  );
  return {
    fields,
    conflict,
    edit,
    flush,
    reload,
    keepMine,
    revision: sync.revision,
    latestRevision: sync.latestRevision,
    hasPendingEdits: sync.hasPendingEdits,
    abandon: sync.abandon,
    saveState,
    saveError,
    editable,
  };
}

type DraftAction = "promote" | "start" | "discard";

/**
 * The Create ticket, Start work, Discard, Close, and Create manually steps. Every step that
 * keeps the draft is ordered after a successful field flush, so none of them can drop an edit.
 */
export function useTicketDraftTransitions({
  environmentId,
  draft,
  editor,
  onDraft,
  onTicketCreated,
  onWorkStarted,
  onDiscarded,
  onClose,
  onCreateManually,
  refreshSnapshot,
}: {
  readonly environmentId: EnvironmentId;
  readonly draft: WorkbenchConversationDraft;
  readonly editor: Pick<
    ReturnType<typeof useTicketDraftEditor>,
    "edit" | "flush" | "revision" | "latestRevision" | "abandon"
  >;
  readonly onDraft: (draft: WorkbenchConversationDraft) => void;
  readonly onTicketCreated: (draft: WorkbenchConversationDraft) => void;
  readonly onWorkStarted: (draft: WorkbenchConversationDraft) => void;
  readonly onDiscarded: () => void;
  readonly onClose: () => void;
  readonly onCreateManually: () => void;
  readonly refreshSnapshot: () => void;
}) {
  const promoteDraft = useAtomCommand(workbenchEnvironment.promoteTicketDraft, {
    reportFailure: false,
  });
  const startWorkDraft = useAtomCommand(workbenchEnvironment.startTicketDraftWork, {
    reportFailure: false,
  });
  const discardDraft = useAtomCommand(workbenchEnvironment.discardTicketDraft, {
    reportFailure: false,
  });
  const [action, setAction] = useState<DraftAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { edit, flush, revision, latestRevision, abandon } = editor;

  const flushed = useCallback(async () => {
    const outcome = await flush();
    if (!outcome.ok) setError(outcome.message);
    return outcome.ok;
  }, [flush]);

  // Every transition ends the same way: clear the busy state, then either show the failure
  // (and refresh, since the server may have moved on) or hand the new draft to the caller.
  const settle = useCallback(
    <A>(result: AtomCommandResult<A, unknown>, onSuccess: (value: A) => void) => {
      setAction(null);
      if (result._tag === "Failure") {
        refreshSnapshot();
        setError(failureMessage(result));
        return;
      }
      onSuccess(result.value);
    },
    [refreshSnapshot],
  );

  const promote = useCallback(
    async (effectiveFields: WorkbenchTicketDraftFields) => {
      setAction("promote");
      setError(null);
      // A draft already in `promoting` has frozen content; only its first attempt saves edits.
      if (draft.phase === "draft") {
        edit(effectiveFields);
        if (!(await flushed())) return setAction(null);
      }
      const result = await promoteDraft({
        environmentId,
        input: { id: draft.id, expectedRevision: revision() },
      });
      settle(result, (created) => {
        onDraft(created);
        onTicketCreated(created);
      });
    },
    [
      draft.id,
      draft.phase,
      edit,
      environmentId,
      flushed,
      onDraft,
      onTicketCreated,
      promoteDraft,
      revision,
      settle,
    ],
  );

  const startWork = useCallback(async () => {
    setAction("start");
    setError(null);
    const result = await startWorkDraft({
      environmentId,
      input: { id: draft.id, expectedRevision: revision() },
    });
    settle(result, (started) => {
      onDraft(started);
      // The same native Thread continues in its prepared work area; nothing is sent automatically.
      onWorkStarted(started);
    });
  }, [draft.id, environmentId, onDraft, onWorkStarted, revision, settle, startWorkDraft]);

  // Discard throws the edits away, so a failed flush is not a reason to stop; it only needs the
  // newest revision, which a conflicting saved draft may have advanced.
  const discard = useCallback(async () => {
    setAction("discard");
    setError(null);
    await flush();
    const result = await discardDraft({
      environmentId,
      input: { id: draft.id, expectedRevision: latestRevision() },
    });
    settle(result, () => {
      abandon();
      onDiscarded();
    });
    return result._tag === "Success";
  }, [abandon, discardDraft, draft.id, environmentId, flush, latestRevision, onDiscarded, settle]);

  // Leaving keeps the draft, so a failed flush keeps the editor open with the edits and the
  // error instead of closing over them. The toast reaches a person on the other tab.
  const leaveAfterFlush = useCallback(
    async (leave: () => void) => {
      const outcome = await flush();
      if (!outcome.ok) {
        setError(outcome.message);
        toastManager.add({
          type: "warning",
          title: "Your edits are not saved yet",
          description: outcome.message,
        });
        return false;
      }
      leave();
      return true;
    },
    [flush],
  );
  const close = useCallback(() => leaveAfterFlush(onClose), [leaveAfterFlush, onClose]);
  const createManually = useCallback(
    () => leaveAfterFlush(onCreateManually),
    [leaveAfterFlush, onCreateManually],
  );

  return { action, error, setError, promote, startWork, discard, close, createManually };
}
