import type { WorkbenchTicketDraftFields } from "@t3tools/contracts";

import type { WorkbenchConversationDraft } from "./workbenchTicketDraft.logic";

type SaveResult =
  | { readonly ok: true; readonly draft: WorkbenchConversationDraft }
  | { readonly ok: false; readonly message: string };

type FlushOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

interface TicketDraftSyncSnapshot {
  /** What the form shows: the saved fields plus every edit the person has made since. */
  readonly fields: WorkbenchTicketDraftFields;
  /** A newer saved draft that local edits cannot be applied on top of; null when none. */
  readonly conflict: WorkbenchConversationDraft | null;
}

export const DRAFT_CONFLICT_MESSAGE =
  "This draft changed elsewhere. Reload the saved draft or keep your edits.";

/**
 * Owns the editable fields of one conversation draft and keeps them consistent with the
 * server's revisions. Saves run one at a time with the revision the server last returned, and
 * Create ticket, Start work, and Close wait for `flush()` before they use `revision()`.
 *
 * A newer revision never replaces local edits. With nothing unsaved it is adopted into the
 * fields; with unsaved edits it becomes a `conflict` that the person resolves with `reload()`
 * (take the saved draft) or `keepMine()` (overwrite it). A snapshot that arrives while a save
 * is running is held back: it is either that save's own echo or, if the save fails, a foreign
 * write. Content is never compared, because the server trims fields.
 */
export const createTicketDraftFieldSync = ({
  initial,
  save,
  onSaved,
}: {
  readonly initial: Pick<WorkbenchConversationDraft, "revision" | "fields">;
  readonly save: (input: {
    readonly expectedRevision: number;
    readonly fields: WorkbenchTicketDraftFields;
  }) => Promise<SaveResult>;
  /** Called for each accepted save, after `revision()` already reflects it. */
  readonly onSaved?: (draft: WorkbenchConversationDraft) => void;
}) => {
  let revision = initial.revision;
  let local = initial.fields;
  let pending: WorkbenchTicketDraftFields | null = null;
  let inflight: WorkbenchTicketDraftFields | null = null;
  let conflict: WorkbenchConversationDraft | null = null;
  let deferred: WorkbenchConversationDraft | null = null;
  let queue: Promise<FlushOutcome> = Promise.resolve({ ok: true });
  let snapshot: TicketDraftSyncSnapshot = { fields: local, conflict };
  const listeners = new Set<() => void>();

  const emit = () => {
    snapshot = { fields: local, conflict };
    for (const listener of listeners) listener();
  };

  /** A saved draft newer than `revision` that no save of ours explains. */
  const takeRemote = (remote: WorkbenchConversationDraft) => {
    if (remote.revision <= revision) return;
    if (conflict !== null && remote.revision <= conflict.revision) return;
    if (pending !== null) {
      conflict = remote;
    } else {
      revision = remote.revision;
      local = remote.fields;
    }
    emit();
  };

  const drain = async (): Promise<FlushOutcome> => {
    while (pending !== null) {
      if (conflict !== null) return { ok: false, message: DRAFT_CONFLICT_MESSAGE };
      const fields = pending;
      pending = null;
      inflight = fields;
      const result = await save({ expectedRevision: revision, fields });
      inflight = null;
      const held = deferred;
      deferred = null;
      if (!result.ok) {
        // Keep the edit so the next flush retries it, unless a newer edit already replaced it.
        pending ??= fields;
        if (held !== null) takeRemote(held);
        return { ok: false, message: result.message };
      }
      revision = result.draft.revision;
      onSaved?.(result.draft);
      if (held !== null) takeRemote(held);
    }
    return { ok: true };
  };

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    edit: (patch: Partial<WorkbenchTicketDraftFields>) => {
      local = { ...local, ...patch };
      pending = local;
      emit();
    },
    flush: (): Promise<FlushOutcome> => {
      queue = queue.then(drain);
      return queue;
    },
    revision: () => revision,
    /** The revision a discard or other whole-draft action must name: the newest one known. */
    latestRevision: () => conflict?.revision ?? revision,
    hasPendingEdits: () => pending !== null || inflight !== null,
    /** Explicitly abandon edits before leaving or after deleting their draft. */
    abandon: () => {
      pending = null;
      conflict = null;
      deferred = null;
      emit();
    },
    /** Offers a draft from the snapshot or another command reply. */
    adopt: (draft: WorkbenchConversationDraft) => {
      if (draft.revision <= revision) return;
      if (inflight !== null) {
        if (deferred === null || draft.revision > deferred.revision) deferred = draft;
        return;
      }
      takeRemote(draft);
    },
    /** Drops the unsaved edits and shows the saved draft instead. */
    reload: () => {
      if (conflict === null) return;
      revision = conflict.revision;
      local = conflict.fields;
      pending = null;
      conflict = null;
      emit();
    },
    /** Keeps the unsaved edits, which now overwrite the saved draft on the next flush. */
    keepMine: () => {
      if (conflict === null || conflict.phase !== "draft") return;
      revision = conflict.revision;
      conflict = null;
      emit();
    },
  };
};
