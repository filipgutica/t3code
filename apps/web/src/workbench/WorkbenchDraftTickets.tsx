import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { ArrowRightIcon, ChevronRightIcon, FilePenLineIcon, Trash2Icon } from "lucide-react";
import { useRef, useState, type RefObject } from "react";

import { Button } from "../components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../components/ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useAtomCommand } from "../state/use-atom-command";
import { WorkbenchDiscardDraftDialog } from "./WorkbenchDiscardDraftDialog";
import { failureMessage } from "./workbenchPageCommands";
import { workbenchEnvironment } from "./state";
import {
  canDiscardConversationDraft,
  getConversationDraftTitle,
  type WorkbenchConversationDraft,
} from "./workbenchTicketDraft.logic";

/** Drafts have no workflow status or drag actions until Create ticket succeeds. */
export function WorkbenchDraftTickets({
  environmentId,
  readOnly,
  boardRef,
  drafts,
  threadsById,
  onSelect,
}: {
  readonly environmentId: EnvironmentId;
  readonly readOnly?: boolean;
  readonly boardRef: RefObject<HTMLElement | null>;
  readonly drafts: ReadonlyArray<WorkbenchConversationDraft>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly onSelect: (projectId: WorkbenchProjectId, ticketId: WorkbenchTicketId) => void;
}) {
  const canOperate = useAtomValue(
    workbenchEnvironment.discardTicketDraft.permissionAtom(environmentId),
  );
  const discardDraft = useAtomCommand(workbenchEnvironment.discardTicketDraft, {
    reportFailure: false,
  });
  const [selected, setSelected] = useState<WorkbenchConversationDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const discarded = useRef(false);
  const discard = async () => {
    if (!selected || busy || readOnly || !canOperate) return false;
    setBusy(true);
    setError(null);
    const result = await discardDraft({
      environmentId,
      input: { id: selected.id, expectedRevision: selected.revision },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      setError(failureMessage(result));
      return false;
    }
    discarded.current = true;
    return true;
  };
  return (
    <>
      {drafts.length > 0 && (
        <Collapsible defaultOpen className="mb-4 min-w-0">
          <CollapsibleTrigger
            ref={headingRef}
            className="group flex w-full cursor-pointer items-center gap-2 rounded-md py-2 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronRightIcon
              aria-hidden
              className="size-3.5 shrink-0 group-data-panel-open:rotate-90"
            />
            Drafts
            <span className="text-xs text-muted-foreground tabular-nums">{drafts.length}</span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <p className="mb-3 text-xs text-muted-foreground">
              Continue planning before creating a ticket.
            </p>
            <ul className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {drafts.map((draft) => {
                const title = getConversationDraftTitle(
                  draft,
                  threadsById.get(draft.threadId)?.title,
                );
                return (
                  <li
                    key={draft.id}
                    className="flex min-w-0 items-center rounded-lg border border-border bg-card"
                  >
                    <button
                      type="button"
                      aria-label={`Open draft ${title}`}
                      onClick={() => onSelect(draft.projectId, draft.id)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <FilePenLineIcon
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{title}</span>
                        <span className="block text-xs text-muted-foreground">Continue draft</span>
                      </span>
                      <ArrowRightIcon
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    </button>
                    <div className="pr-2">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Discard draft ${title}`}
                              disabled={
                                busy ||
                                readOnly ||
                                !canOperate ||
                                !canDiscardConversationDraft({
                                  phase: draft.phase,
                                  ticketExists: false,
                                })
                              }
                              onClick={(event) => {
                                returnFocus.current = event.currentTarget;
                                discarded.current = false;
                                setError(null);
                                setSelected(draft);
                              }}
                            />
                          }
                        >
                          <Trash2Icon aria-hidden />
                        </TooltipTrigger>
                        <TooltipPopup>Discard draft</TooltipPopup>
                      </Tooltip>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CollapsiblePanel>
        </Collapsible>
      )}
      <WorkbenchDiscardDraftDialog
        title={
          selected
            ? getConversationDraftTitle(selected, threadsById.get(selected.threadId)?.title)
            : ""
        }
        finalFocus={() =>
          discarded.current ? (headingRef.current ?? boardRef.current) : returnFocus.current
        }
        open={selected !== null}
        busy={busy}
        creationUncertain={selected?.phase === "promoting"}
        error={error}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onDiscard={discard}
      />
    </>
  );
}
