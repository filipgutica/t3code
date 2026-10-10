import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ThreadId, WorkbenchProjectId, WorkbenchTicketId } from "@t3tools/contracts";
import { ChevronDownIcon, FilePenLineIcon } from "lucide-react";

import { Badge } from "../components/ui/badge";
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
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-2 text-left text-sm font-medium">
        <ChevronDownIcon className="size-3.5 shrink-0" />
        Drafts
        <span className="text-xs text-muted-foreground tabular-nums">{drafts.length}</span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ul className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {drafts.map((draft) => {
            const title = getConversationDraftTitle(draft, threadsById.get(draft.threadId)?.title);
            return (
              <li key={draft.id} className="min-w-0">
                <button
                  type="button"
                  aria-label={`Open draft ${title}`}
                  onClick={() => onSelect(draft.projectId, draft.id)}
                  className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-dashed border-border bg-card px-3 py-2.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <FilePenLineIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
                  <Badge variant="outline">Draft</Badge>
                </button>
              </li>
            );
          })}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}
