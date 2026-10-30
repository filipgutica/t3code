import type { WorkbenchEpic, WorkbenchEpicId } from "@t3tools/contracts";
import { ChevronDownIcon, ChevronUpIcon, PencilLineIcon, SquareIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import type { Project } from "../types";
import { WorkbenchDescription } from "./WorkbenchDescription";
import { WorkbenchProgressCount } from "./WorkbenchProgressCount";
import { WorkbenchProgress, WorkbenchProgressChecklist } from "./WorkbenchProgress";
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
  getDraftProgressPreview,
  getInitialDraftCardMode,
  type DraftBriefPreviewLine,
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
  /** The conversation the card is pinned above. */
  readonly children: ReactNode;
}

/**
 * The draft pinned above its conversation in the floating chat. Its title edits in place, and
 * Show full brief expands every field in the card while the conversation stays usable below.
 * A short chat starts collapsed.
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
    <div className="flex min-h-0 flex-1 flex-col">
      <DraftCardBody
        {...props}
        mode={mode}
        unseen={mode === "collapsed" && props.draft.revision > seenRevision}
        show={show}
      />
      {children}
    </div>
  );
}

type DraftCardBodyProps = Omit<WorkbenchDraftCardProps, "children"> & {
  readonly mode: WorkbenchDraftCardMode;
  readonly unseen: boolean;
  readonly show: (mode: WorkbenchDraftCardMode) => void;
};

type DraftCardModeProps = DraftCardBodyProps & { readonly onDiscard: () => void };

function DraftCardBody(props: DraftCardBodyProps) {
  const [discardOpen, setDiscardOpen] = useState(false);
  const Mode =
    props.mode === "expanded"
      ? ExpandedDraftCard
      : props.mode === "collapsed"
        ? CollapsedDraftCard
        : CompactDraftCard;
  return (
    <>
      <Mode {...props} onDiscard={() => setDiscardOpen(true)} />
      <WorkbenchDiscardDraftDialog
        open={discardOpen}
        busy={props.transitions.action !== null}
        error={props.transitions.error}
        onOpenChange={setDiscardOpen}
        onDiscard={props.transitions.discard}
      />
    </>
  );
}

const isFormDisabled = ({ editor, transitions, canOperate }: DraftCardModeProps) =>
  !editor.editable || editor.conflict !== null || transitions.action !== null || !canOperate;

// A conflict explains itself in the conflict notice or the blocked reason.
const getCardError = ({ editor, transitions }: DraftCardModeProps) =>
  transitions.error ?? (editor.conflict ? null : editor.saveError);

function CardActions({
  layout,
  ...props
}: DraftCardModeProps & { readonly layout: "inline" | "button" }) {
  return (
    <WorkbenchDraftActions
      draft={props.draft}
      editor={props.editor}
      transitions={props.transitions}
      createState={props.createState}
      canOperate={props.canOperate}
      ticketExists={props.ticketExists}
      layout={layout}
      onCancel={props.untouched ? () => void props.transitions.discard() : null}
      onDiscard={props.onDiscard}
    />
  );
}

function CardNotices(props: DraftCardModeProps) {
  const { editor } = props;
  const error = getCardError(props);
  return (
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
}

function ExpandedDraftCard(props: DraftCardModeProps) {
  return (
    <div
      role="group"
      aria-label="Ticket draft"
      className="mx-3 mt-2 flex max-h-[60%] min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      {/* The description's label already says who updated it. */}
      <CardHeader {...props} updatedBy={null} toggle="Show less" next="compact" />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pt-1 pb-3">
        <CardNotices {...props} />
        <WorkbenchTicketDraftFieldsForm
          fields={props.editor.fields}
          disabled={isFormDisabled(props)}
          linkedProjects={props.linkedProjects}
          epics={props.epics}
          updatedBy={props.updatedBy}
          brief="rendered"
          references={
            <>
              {props.draft.progress?.trim() ? (
                <WorkbenchProgress progress={props.draft.progress} />
              ) : null}
              {props.references}
            </>
          }
          onChange={props.editor.edit}
          onCreateEpic={props.onCreateEpic}
        />
      </div>
      <footer className="shrink-0 border-t border-border px-3 py-1.5">
        <CardActions {...props} layout="inline" />
      </footer>
    </div>
  );
}

function CardHeader({
  updatedBy,
  show,
  toggle,
  next,
}: DraftCardModeProps & {
  readonly toggle: "Show less" | "Collapse ticket draft";
  readonly next: WorkbenchDraftCardMode;
}) {
  return (
    <header className="flex shrink-0 items-center gap-2 py-1 pr-1.5 pl-3 text-xs text-muted-foreground">
      <PencilLineIcon className="size-3.5 shrink-0" aria-hidden />
      <span className="font-medium text-foreground">Ticket draft</span>
      {updatedBy ? <span className="truncate">Updated by {updatedBy}</span> : null}
      <span className="flex-1" />
      <Button size="icon-xs" variant="ghost" aria-label={toggle} onClick={() => show(next)}>
        <ChevronUpIcon />
      </Button>
    </header>
  );
}

function CollapsedDraftCard(props: DraftCardModeProps) {
  const { editor, transitions } = props;
  const title = editor.fields.title.trim();
  const reason =
    getCardError(props) ??
    getDraftBlockedReason({
      action: transitions.action,
      blocker: editor.conflict ? DRAFT_CONFLICT_MESSAGE : props.createState.blocker,
      phase: props.draft.phase,
      ticketExists: props.ticketExists,
    });
  return (
    <div
      role="group"
      aria-label="Ticket draft"
      className="mx-3 mt-2 shrink-0 rounded-xl border border-border bg-card py-1.5 pr-1.5 pl-3"
    >
      <div className="flex items-center gap-2">
        <PencilLineIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {props.unseen ? (
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
          onClick={() => props.show("compact")}
        >
          <ChevronDownIcon />
        </Button>
        <CardActions {...props} layout="button" />
      </div>
      {reason ? (
        <p role="status" className="mt-0.5 text-xs text-muted-foreground">
          {reason}
        </p>
      ) : null}
    </div>
  );
}

function CompactDraftCard(props: DraftCardModeProps) {
  const { editor } = props;
  const brief = getDraftBriefPreview(editor.fields.markdown, BRIEF_PREVIEW_LINES);
  const progress = getDraftProgressPreview({
    markdown: editor.fields.markdown,
    progress: props.draft.progress ?? "",
    limit: BRIEF_PREVIEW_LINES,
  });
  const remaining = progress?.remaining ?? brief.remaining;
  return (
    <div
      role="group"
      aria-label="Ticket draft"
      className="mx-3 mt-2 flex max-h-[40%] min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      <CardHeader {...props} toggle="Collapse ticket draft" next="collapsed" />
      <div className="min-h-0 space-y-2 overflow-y-auto px-3 pb-2">
        <CardNotices {...props} />
        <input
          aria-label="Title"
          placeholder="What needs doing?"
          value={editor.fields.title}
          disabled={isFormDisabled(props)}
          onChange={(event) => editor.edit({ title: event.currentTarget.value })}
          className="-mx-1.5 w-[calc(100%+0.75rem)] rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground hover:border-border focus-visible:border-ring focus-visible:bg-background disabled:cursor-default disabled:hover:border-transparent"
        />
        {progress ? (
          <>
            {progress.goal ? <WorkbenchDescription markdown={progress.goal} /> : null}
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold">Progress</h3>
              <WorkbenchProgressCount done={progress.done} total={progress.total} />
            </div>
            <WorkbenchProgressChecklist
              progress={props.draft.progress ?? ""}
              limit={BRIEF_PREVIEW_LINES}
            />
          </>
        ) : (
          <BriefPreview lines={brief.lines} />
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pb-2">
        <Button
          size="xs"
          variant="link"
          className="-ml-2 mr-auto"
          onClick={() => props.show("expanded")}
        >
          {remaining > 0 ? `+${remaining} more · Show full brief` : "Show full brief"}
        </Button>
        <CardChips {...props} />
      </div>
      <footer className="shrink-0 border-t border-border px-3 py-1.5">
        <CardActions {...props} layout="inline" />
      </footer>
    </div>
  );
}

function BriefPreview({ lines }: { readonly lines: ReadonlyArray<DraftBriefPreviewLine> }) {
  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No brief yet. Ask the agent to write one.</p>
    );
  }
  return (
    <ul className="space-y-1 text-sm">
      {lines.map((line) => (
        <li key={line.line} className="flex items-start gap-2">
          {line.checkbox ? (
            <SquareIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          ) : null}
          <span className={cn("min-w-0 truncate", !line.checkbox && "text-muted-foreground")}>
            {line.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CardChips({ createState, linkedProjects, referenceCount }: DraftCardModeProps) {
  const repositories = createState.repositories.selectedRepositoryProjectIds.flatMap((id) => {
    const project = linkedProjects.find((candidate) => candidate.id === id);
    return project ? [project] : [];
  });
  return (
    <>
      {repositories.map((project) => (
        <Badge key={project.id} variant="outline">
          {project.title}
        </Badge>
      ))}
      <Badge variant="outline">
        {referenceCount === 1 ? "1 Reference" : `${referenceCount} References`}
      </Badge>
    </>
  );
}
