import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { ArrowRightIcon, ChevronRightIcon, Trash2Icon } from "lucide-react";
import { useRef, type RefObject } from "react";

import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../components/ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { WorkbenchDiscardDraftDialog } from "./WorkbenchDiscardDraftDialog";
import { WorkbenchInlineError } from "./WorkbenchForms";
import { useWorkbenchDraftActions } from "./useWorkbenchDraftActions";
import {
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
  const actions = useWorkbenchDraftActions({ environmentId, readOnly: readOnly === true, drafts });
  const returnFocus = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLButtonElement>(null);
  const bulkButtonRef = useRef<HTMLButtonElement>(null);
  const count = actions.selectedDrafts.length;
  return (
    <>
      {drafts.length > 0 && (
        <Collapsible defaultOpen className="mb-4 min-w-0">
          <CollapsibleTrigger
            ref={headingRef}
            className="group flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md py-2 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronRightIcon
              aria-hidden
              className="size-3.5 shrink-0 group-data-panel-open:rotate-90"
            />
            Drafts{" "}
            <span className="text-xs text-muted-foreground tabular-nums">{drafts.length}</span>
          </CollapsibleTrigger>
          {count > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span role="status" className="text-xs text-muted-foreground">
                {count} selected
              </span>
              <Button
                variant="ghost"
                size="xs"
                disabled={!actions.canMutate || actions.busy}
                onClick={actions.selectAll}
              >
                Select all
              </Button>
              <Button
                ref={bulkButtonRef}
                variant="destructive"
                size="xs"
                disabled={!actions.canMutate || actions.busy}
                onClick={(event) => {
                  returnFocus.current = event.currentTarget;
                  actions.confirm(actions.selectedDrafts);
                }}
              >
                Discard selected ({count})
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={actions.busy}
                onClick={() => {
                  actions.clearSelection();
                  headingRef.current?.focus();
                }}
              >
                Clear selection
              </Button>
            </div>
          )}
          <WorkbenchInlineError message={actions.error} />
          <CollapsiblePanel>
            {count === 0 && (
              <p className="mb-2 text-xs text-muted-foreground">
                Continue planning before creating a ticket.
              </p>
            )}
            <ul
              aria-label="Drafts"
              className="grid max-h-24 min-w-0 gap-2 overflow-y-auto overscroll-contain sm:grid-cols-2 lg:grid-cols-3"
            >
              {drafts.map((draft) => {
                const title = getConversationDraftTitle(
                  draft,
                  threadsById.get(draft.threadId)?.title,
                );
                const disabled = actions.busy || !actions.canMutate || !actions.canDiscard(draft);
                return (
                  <li
                    key={draft.id}
                    data-selected={actions.selectedIds.has(draft.id) || undefined}
                    className="flex h-11 min-w-0 items-center rounded-lg border border-border bg-card hover:bg-accent/50 data-selected:bg-accent"
                  >
                    <label className="flex h-full w-11 shrink-0 cursor-pointer items-center justify-center">
                      <Checkbox
                        aria-label={`Select draft ${title}`}
                        checked={actions.selectedIds.has(draft.id)}
                        disabled={disabled}
                        onCheckedChange={(checked) => actions.select(draft, checked)}
                      />
                    </label>
                    <button
                      type="button"
                      aria-label={`Open draft ${title}`}
                      onClick={() => onSelect(draft.projectId, draft.id)}
                      className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg pr-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    >
                      <Tooltip>
                        <TooltipTrigger
                          render={<span className="min-w-0 flex-1 truncate text-sm font-medium" />}
                        >
                          {title}
                        </TooltipTrigger>
                        <TooltipPopup>{title}</TooltipPopup>
                      </Tooltip>
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
                              disabled={disabled}
                              onClick={(event) => {
                                returnFocus.current = event.currentTarget;
                                actions.confirm([draft]);
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
          actions.confirmation?.drafts.length === 1
            ? getConversationDraftTitle(
                actions.confirmation.drafts[0]!,
                threadsById.get(actions.confirmation.drafts[0]!.threadId)?.title,
              )
            : ""
        }
        count={actions.confirmation?.drafts.length ?? 1}
        finalFocus={() => {
          if (actions.discardSucceeded) return boardRef.current;
          const trigger = returnFocus.current;
          if (trigger?.isConnected && !trigger.hasAttribute("disabled")) return trigger;
          if (bulkButtonRef.current && !bulkButtonRef.current.disabled)
            return bulkButtonRef.current;
          return headingRef.current ?? boardRef.current;
        }}
        open={actions.confirmation?.open === true}
        busy={actions.busy}
        error={null}
        onOpenChange={(open) => {
          if (!open) actions.closeConfirmation();
        }}
        onDiscard={actions.discard}
      />
    </>
  );
}
