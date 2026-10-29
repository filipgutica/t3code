import type { WorkbenchEpic, WorkbenchEpicId } from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PencilLineIcon,
  SquareIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import type { Project } from "../types";
import { WorkbenchDiscardDraftDialog } from "./WorkbenchDiscardDraftDialog";
import { getDraftBlockedReason, WorkbenchDraftActions } from "./WorkbenchDraftActions";
import { DraftConflictNotice } from "./WorkbenchTicketConversation";
import {
  WorkbenchTicketDraftFieldsForm,
  type getTicketDraftCreateState,
} from "./WorkbenchTicketDraftPanel";
import type {
  useTicketDraftEditor,
  useTicketDraftTransitions,
} from "./useWorkbenchTicketConversation";
import { readWorkbenchFloatingChatHeight } from "./useWorkbenchFloatingChatSize";
import {
  getDraftBriefPreview,
  getInitialDraftCardMode,
  type WorkbenchDraftCardMode,
} from "./workbenchDraftCard.logic";
import type { WorkbenchConversationDraft } from "./workbenchTicketDraft.logic";
import { DRAFT_CONFLICT_MESSAGE } from "./workbenchTicketDraftSync";

const BRIEF_PREVIEW_LINES = 2;

export interface WorkbenchDraftCardProps {
  readonly draft: WorkbenchConversationDraft;
  readonly editor: ReturnType<typeof useTicketDraftEditor>;
  readonly transitions: ReturnType<typeof useTicketDraftTransitions>;
  readonly createState: ReturnType<typeof getTicketDraftCreateState>;
  readonly canOperate: boolean;
  readonly ticketExists: boolean;
  readonly untouched: boolean;
  /** The agent Thread that last wrote the title or brief, if one did. */
  readonly updatedBy: string | null;
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly epics: ReadonlyArray<WorkbenchEpic>;
  readonly references: ReactNode;
  readonly referenceCount: number;
  readonly onCreateEpic: (onCreated: (epicId: WorkbenchEpicId) => void) => void;
  /** The conversation the card is pinned above; the full view covers it. */
  readonly children: ReactNode;
}

/**
 * The draft pinned above its conversation in the floating chat. Its title edits in place, and
 * Show full brief opens every field over the conversation. A short chat starts collapsed.
 */
export function WorkbenchDraftCard({ children, ...props }: WorkbenchDraftCardProps) {
  const [mode, setMode] = useState<WorkbenchDraftCardMode>(() =>
    getInitialDraftCardMode(readWorkbenchFloatingChatHeight()),
  );
  const [seenRevision, setSeenRevision] = useState(props.draft.revision);
  const show = (next: WorkbenchDraftCardMode) => {
    setSeenRevision(props.draft.revision);
    setMode(next);
  };
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <DraftCardBody
        {...props}
        mode={mode}
        unseen={mode === "collapsed" && props.draft.revision > seenRevision}
        show={show}
      />
      <div inert={mode === "full"} className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  );
}

function DraftCardBody({
  mode,
  unseen,
  show,
  ...props
}: Omit<WorkbenchDraftCardProps, "children"> & {
  readonly mode: WorkbenchDraftCardMode;
  readonly unseen: boolean;
  readonly show: (mode: WorkbenchDraftCardMode) => void;
}) {
  const { draft, editor, transitions, createState, canOperate, ticketExists, untouched } = props;
  const [discardOpen, setDiscardOpen] = useState(false);
  const disabled =
    !editor.editable || editor.conflict !== null || transitions.action !== null || !canOperate;
  const error = transitions.error ?? (editor.conflict ? null : editor.saveError);
  const actions = (
    <WorkbenchDraftActions
      draft={draft}
      editor={editor}
      transitions={transitions}
      createState={createState}
      canOperate={canOperate}
      ticketExists={ticketExists}
      layout="inline"
      onCancel={untouched ? () => void transitions.discard() : null}
      onDiscard={() => setDiscardOpen(true)}
    />
  );
  const notices = (
    <>
      {editor.conflict ? (
        <DraftConflictNotice
          onReload={editor.reload}
          onKeepMine={editor.keepMine}
          canKeepMine={editor.conflict.phase === "draft"}
          fields={editor.fields}
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
  const discardDialog = (
    <WorkbenchDiscardDraftDialog
      open={discardOpen}
      busy={transitions.action !== null}
      error={transitions.error}
      onOpenChange={setDiscardOpen}
      onDiscard={transitions.discard}
    />
  );
  const title = editor.fields.title.trim();

  if (mode === "full") {
    return (
      <div
        role="group"
        aria-label="Ticket draft"
        className="absolute inset-0 z-20 flex min-h-0 flex-col bg-background"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
          <Button size="sm" variant="ghost" onClick={() => show("compact")}>
            <ArrowLeftIcon />
            Back to conversation
          </Button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {notices}
          <WorkbenchTicketDraftFieldsForm
            fields={editor.fields}
            disabled={disabled}
            linkedProjects={props.linkedProjects}
            epics={props.epics}
            updatedBy={props.updatedBy}
            references={props.references}
            onChange={editor.edit}
            onCreateEpic={props.onCreateEpic}
          />
        </div>
        <footer className="shrink-0 border-t border-border px-3 py-2">{actions}</footer>
        {discardDialog}
      </div>
    );
  }

  if (mode === "collapsed") {
    const reason =
      error ??
      getDraftBlockedReason({
        action: transitions.action,
        blocker: editor.conflict ? DRAFT_CONFLICT_MESSAGE : createState.blocker,
        phase: draft.phase,
        ticketExists,
      });
    return (
      <div
        role="group"
        aria-label="Ticket draft"
        className="mx-3 mt-2 shrink-0 rounded-xl border border-border bg-card py-1.5 pr-1.5 pl-3"
      >
        <div className="flex items-center gap-2">
          <PencilLineIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {unseen ? (
            <span className="size-1.5 shrink-0 rounded-full bg-info" aria-label="Updated" />
          ) : null}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm font-medium",
              !title && "text-muted-foreground",
            )}
          >
            {title || "Untitled draft"}
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Expand ticket draft"
            onClick={() => show("compact")}
          >
            <ChevronDownIcon />
          </Button>
          <WorkbenchDraftActions
            draft={draft}
            editor={editor}
            transitions={transitions}
            createState={createState}
            canOperate={canOperate}
            ticketExists={ticketExists}
            layout="button"
            onCancel={untouched ? () => void transitions.discard() : null}
            onDiscard={() => setDiscardOpen(true)}
          />
        </div>
        {reason ? (
          <p role="status" className="mt-0.5 text-xs text-muted-foreground">
            {reason}
          </p>
        ) : null}
      </div>
    );
  }

  const brief = getDraftBriefPreview(editor.fields.markdown, BRIEF_PREVIEW_LINES);
  const repositories = createState.repositories.selectedRepositoryProjectIds.flatMap((id) => {
    const project = props.linkedProjects.find((candidate) => candidate.id === id);
    return project ? [project] : [];
  });
  return (
    <div
      role="group"
      aria-label="Ticket draft"
      className="mx-3 mt-2 flex max-h-[40%] min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="flex shrink-0 items-center gap-2 py-1 pr-1.5 pl-3 text-xs text-muted-foreground">
        <PencilLineIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="font-medium text-foreground">Ticket draft</span>
        {props.updatedBy ? <span className="truncate">Updated by {props.updatedBy}</span> : null}
        <span className="flex-1" />
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Collapse ticket draft"
          onClick={() => show("collapsed")}
        >
          <ChevronUpIcon />
        </Button>
      </header>
      <div className="min-h-0 space-y-2 overflow-y-auto px-3 pb-2">
        {notices}
        <input
          aria-label="Title"
          placeholder="What needs doing?"
          value={editor.fields.title}
          disabled={disabled}
          onChange={(event) => editor.edit({ title: event.currentTarget.value })}
          className="-mx-1.5 w-[calc(100%+0.75rem)] rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground hover:border-border focus-visible:border-ring focus-visible:bg-background disabled:cursor-default disabled:hover:border-transparent"
        />
        {brief.lines.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {brief.lines.map((line) => (
              <li key={line.line} className="flex items-start gap-2">
                {line.checkbox ? (
                  <SquareIcon
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                ) : null}
                <span className={cn("min-w-0", !line.checkbox && "text-muted-foreground")}>
                  {line.text}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No brief yet. Ask the agent, or write one.
          </p>
        )}
        <Button size="xs" variant="link" onClick={() => show("full")}>
          {brief.remaining > 0 ? `+${brief.remaining} more · Show full brief` : "Show full brief"}
        </Button>
        <div className="flex flex-wrap items-center gap-1.5">
          {repositories.map((project) => (
            <Badge key={project.id} variant="outline">
              {project.title}
            </Badge>
          ))}
          <Badge variant="outline">
            {props.referenceCount === 1 ? "1 Reference" : `${props.referenceCount} References`}
          </Badge>
        </div>
      </div>
      <footer className="shrink-0 border-t border-border px-3 py-1.5">{actions}</footer>
      {discardDialog}
    </div>
  );
}
