import { LoaderCircleIcon, PlayIcon, TicketPlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "../components/ui/button";
import type {
  useTicketDraftEditor,
  useTicketDraftTransitions,
} from "./useWorkbenchTicketConversation";
import type { getTicketDraftCreateState } from "./WorkbenchTicketDraftPanel";
import {
  canDiscardConversationDraft,
  type WorkbenchConversationDraft,
  type WorkbenchTicketDraftSuggestion,
} from "./workbenchTicketDraft.logic";
import { DRAFT_CONFLICT_MESSAGE } from "./workbenchTicketDraftSync";

interface DraftActionsProps {
  readonly phase: WorkbenchConversationDraft["phase"];
  readonly action: "promote" | "start" | "discard" | null;
  readonly canOperate: boolean;
  readonly blocker: string | null;
  /** The saved ticket exists, so only the ticket (not the draft) can still be changed. */
  readonly ticketExists: boolean;
  readonly createsInJira: boolean;
  readonly saveState: "idle" | "saving" | "saved" | "error";
  readonly onCreate: () => void;
  readonly onStartWork: () => void;
  readonly onDiscard: () => void;
  readonly onRetryDiscard: () => void;
}

const SPINNER = <LoaderCircleIcon className="animate-spin" aria-hidden />;

function PlanningActions({ phase, action, canOperate, onStartWork }: DraftActionsProps) {
  const label =
    action === "start"
      ? "Preparing work area…"
      : phase === "starting"
        ? "Retry start work"
        : "Start work";
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Start work prepares the work area and continues this conversation there. Nothing is sent
        automatically.
      </p>
      <Button className="w-full" disabled={action !== null || !canOperate} onClick={onStartWork}>
        {action === "start" ? SPINNER : <PlayIcon />}
        {label}
      </Button>
    </>
  );
}

function DiscardingActions({ action, canOperate, onRetryDiscard }: DraftActionsProps) {
  return (
    <Button className="w-full" disabled={action !== null || !canOperate} onClick={onRetryDiscard}>
      {action === "discard" ? SPINNER : <Trash2Icon />}
      {action === "discard" ? "Discarding…" : "Retry discard"}
    </Button>
  );
}

/** The blocker explains a disabled Create ticket; otherwise the line reports autosave. */
const getDraftStatusLine = ({
  action,
  blocker,
  createsInJira,
  phase,
  saveState,
  ticketExists,
}: Pick<
  DraftActionsProps,
  "action" | "blocker" | "createsInJira" | "phase" | "saveState" | "ticketExists"
>) => {
  if (phase === "promoting" && action === null && !blocker) {
    if (ticketExists)
      return "Linking the ticket to this conversation did not finish. Retry Create ticket.";
    return createsInJira
      ? "Creating the ticket did not finish. Retry Create ticket, or check Jira and discard the draft."
      : "Creating the ticket did not finish. Retry Create ticket, or discard the draft.";
  }
  if (blocker && phase !== "creating") return blocker;
  if (saveState === "saving") return "Saving…";
  return saveState === "saved" ? "Draft saved" : "\u00a0";
};

function UnsavedDraftActions({
  phase,
  action,
  canOperate,
  blocker,
  ticketExists,
  createsInJira,
  saveState,
  onCreate,
  onDiscard,
}: DraftActionsProps) {
  const busy = action !== null;
  const creating = action === "promote";
  const createLabel = creating
    ? createsInJira
      ? "Creating in Jira…"
      : "Creating ticket…"
    : "Create ticket";
  const status = getDraftStatusLine({
    action,
    blocker,
    createsInJira,
    phase,
    saveState,
    ticketExists,
  });
  return (
    <>
      <p role="status" className="text-xs text-muted-foreground">
        {status}
      </p>
      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !canDiscardConversationDraft({ phase, ticketExists }) || !canOperate}
          onClick={onDiscard}
        >
          <Trash2Icon /> Discard draft
        </Button>
        <Button
          disabled={busy || phase === "creating" || blocker !== null || !canOperate}
          aria-busy={creating}
          onClick={onCreate}
        >
          {creating ? SPINNER : <TicketPlusIcon />}
          {createLabel}
        </Button>
      </div>
    </>
  );
}

function DraftActions(props: DraftActionsProps) {
  if (props.phase === "planning" || props.phase === "starting")
    return <PlanningActions {...props} />;
  if (props.phase === "discarding") return <DiscardingActions {...props} />;
  return <UnsavedDraftActions {...props} />;
}

type DraftEditor = Pick<
  ReturnType<typeof useTicketDraftEditor>,
  "conflict" | "saveState" | "edit" | "flush"
>;

/** Create ticket, Start work, or Retry discard for the draft's phase, with its status line. */
export function WorkbenchDraftActions({
  draft,
  editor,
  transitions,
  createState,
  canOperate,
  ticketExists,
  onDiscard,
}: {
  readonly draft: WorkbenchConversationDraft;
  readonly editor: DraftEditor;
  readonly transitions: Pick<
    ReturnType<typeof useTicketDraftTransitions>,
    "action" | "promote" | "startWork" | "discard"
  >;
  readonly createState: ReturnType<typeof getTicketDraftCreateState>;
  readonly canOperate: boolean;
  readonly ticketExists: boolean;
  readonly onDiscard: () => void;
}) {
  return (
    <DraftActions
      phase={draft.phase}
      action={transitions.action}
      canOperate={canOperate}
      blocker={editor.conflict ? DRAFT_CONFLICT_MESSAGE : createState.blocker}
      ticketExists={ticketExists}
      createsInJira={createState.createsInJira}
      saveState={editor.saveState}
      onCreate={() => void transitions.promote(createState.effectiveFields)}
      onStartWork={() => void transitions.startWork()}
      onDiscard={onDiscard}
      onRetryDiscard={() => void transitions.discard()}
    />
  );
}

/** Applies an agent's proposal to the draft and saves it at once. */
export const applyTicketProposal =
  (editor: Pick<DraftEditor, "edit" | "flush">) => (suggestion: WorkbenchTicketDraftSuggestion) => {
    editor.edit({
      title: suggestion.title,
      markdown: suggestion.markdown,
      repositoryProjectIds: [...suggestion.repositoryProjectIds],
      primaryT3ProjectId: suggestion.primaryT3ProjectId,
    });
    void editor.flush();
  };
