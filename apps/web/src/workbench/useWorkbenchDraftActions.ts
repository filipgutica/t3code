import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, WorkbenchTicketId } from "@t3tools/contracts";
import { useLayoutEffect, useRef, useState } from "react";

import { useAtomCommand } from "../state/use-atom-command";
import { failureMessage } from "./workbenchPageCommands";
import { workbenchEnvironment } from "./state";
import {
  canDiscardConversationDraft,
  type WorkbenchConversationDraft,
} from "./workbenchTicketDraft.logic";

// A failed Thread deletion can leave this phase behind; the service supports resuming it.
const canDiscardBoardDraft = (draft: WorkbenchConversationDraft) =>
  canDiscardConversationDraft({ phase: draft.phase, ticketExists: false }) ||
  draft.phase === "discarding";

export function useWorkbenchDraftActions({
  environmentId,
  readOnly,
  drafts,
}: {
  readonly environmentId: EnvironmentId;
  readonly readOnly?: boolean;
  readonly drafts: ReadonlyArray<WorkbenchConversationDraft>;
}) {
  const permission = useAtomValue(
    workbenchEnvironment.discardTicketDraft.permissionAtom(environmentId),
  );
  const discardDraft = useAtomCommand(workbenchEnvironment.discardTicketDraft, {
    reportFailure: false,
  });
  const refresh = useAtomRefresh(workbenchEnvironment.snapshot({ environmentId, input: {} }));
  const canMutate = !readOnly && permission;
  const eligibility = useRef(canMutate);
  useLayoutEffect(() => {
    eligibility.current = canMutate;
  }, [canMutate]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<WorkbenchTicketId>>(new Set());
  const [confirmation, setConfirmation] = useState<{
    environmentId: EnvironmentId;
    open: boolean;
    drafts: ReadonlyArray<WorkbenchConversationDraft>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [discardSucceeded, setDiscardSucceeded] = useState(false);
  const eligibleDrafts = drafts.filter(canDiscardBoardDraft);
  // Hidden drafts are never included by Select all or by the confirmation.
  const selectedDrafts = eligibleDrafts.filter((draft) => selectedIds.has(draft.id));
  const select = (draft: WorkbenchConversationDraft, checked: boolean) => {
    if (!canMutate || busy || !canDiscardBoardDraft(draft)) return;
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(draft.id);
      else next.delete(draft.id);
      return next;
    });
  };
  const confirm = (requested: ReadonlyArray<WorkbenchConversationDraft>) => {
    if (!canMutate || busy) return;
    const ids = new Set(requested.map((draft) => draft.id));
    const targets = eligibleDrafts.filter((draft) => ids.has(draft.id));
    if (targets.length === 0) return;
    setError(null);
    setDiscardSucceeded(false);
    setConfirmation({ environmentId, drafts: targets, open: true });
  };
  const discard = async () => {
    if (!confirmation?.open || running.current) return false;
    running.current = true;
    setBusy(true);
    setError(null);
    const failed: WorkbenchConversationDraft[] = [];
    const messages: string[] = [];
    try {
      for (const draft of confirmation.drafts) {
        if (!eligibility.current) {
          failed.push(draft);
          messages.push("This workspace is read-only or your permission changed.");
          continue;
        }
        const result = await discardDraft({
          environmentId: confirmation.environmentId,
          input: { id: draft.id, expectedRevision: draft.revision },
        });
        if (result._tag === "Failure") {
          failed.push(draft);
          messages.push(failureMessage(result));
        }
      }
      // Each new attempt gets a new confirmation with the refreshed revisions. Successful
      // drafts are not retained for retry, even when the rest of the batch fails.
      setConfirmation({ ...confirmation, open: false });
      setSelectedIds((previous) => {
        const next = new Set(previous);
        for (const draft of confirmation.drafts) next.delete(draft.id);
        for (const draft of failed) next.add(draft.id);
        return next;
      });
      setDiscardSucceeded(failed.length === 0);
      if (failed.length > 0) {
        const removed = confirmation.drafts.length - failed.length;
        setError(
          `${removed > 0 ? `${removed} discarded. ` : ""}${failed.length} ${failed.length === 1 ? "draft could" : "drafts could"} not be discarded. ${[...new Set(messages)].join(" ") || "This workspace is read-only or your permission changed."} Check the remaining drafts and try again.`,
        );
        refresh();
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
    return false;
  };
  return {
    canMutate,
    busy,
    error,
    discardSucceeded,
    selectedIds,
    selectedDrafts,
    confirmation,
    canDiscard: canDiscardBoardDraft,
    select,
    confirm,
    discard,
    closeConfirmation: () => {
      if (!busy)
        setConfirmation((previous) => (previous?.open ? { ...previous, open: false } : previous));
    },
    clearSelection: () => {
      if (!busy) {
        setSelectedIds(new Set());
        setError(null);
      }
    },
    selectAll: () => {
      if (canMutate && !busy) setSelectedIds(new Set(eligibleDrafts.map((draft) => draft.id)));
    },
  };
}
