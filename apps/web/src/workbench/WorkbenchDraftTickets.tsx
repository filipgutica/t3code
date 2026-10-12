import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ThreadId, WorkbenchProjectId, WorkbenchTicketId } from "@t3tools/contracts";
import { ArrowRightIcon, ChevronRightIcon, FilePenLineIcon } from "lucide-react";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../components/ui/collapsible";
import {
  getConversationDraftTitle,
  type WorkbenchConversationDraft,
} from "./workbenchTicketDraft.logic";

/** Drafts have no workflow status or drag actions until Create ticket succeeds. */
export function WorkbenchDraftTickets({
  drafts,
  threadsById,
  onSelect,
}: {
  readonly drafts: ReadonlyArray<WorkbenchConversationDraft>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly onSelect: (projectId: WorkbenchProjectId, ticketId: WorkbenchTicketId) => void;
}) {
  if (drafts.length === 0) return null;
  return (
    <Collapsible defaultOpen className="mb-4 min-w-0">
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 rounded-md py-2 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
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
            const title = getConversationDraftTitle(draft, threadsById.get(draft.threadId)?.title);
            return (
              <li key={draft.id} className="min-w-0">
                <button
                  type="button"
                  aria-label={`Open draft ${title}`}
                  onClick={() => onSelect(draft.projectId, draft.id)}
                  className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <FilePenLineIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{title}</span>
                    <span className="block text-xs text-muted-foreground">Continue draft</span>
                  </span>
                  <ArrowRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}
