import { LoaderCircleIcon, PlayIcon, TicketPlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import type {
  useTicketDraftEditor,
  useTicketDraftTransitions,
} from "./useWorkbenchTicketConversation";
import type { getTicketDraftCreateState } from "./WorkbenchTicketDraftPanel";
import {
  canDiscardConversationDraft,
  type WorkbenchConversationDraft,
} from "./workbenchTicketDraft.logic";
import { DRAFT_CONFLICT_MESSAGE } from "./workbenchTicketDraftSync";

interface DraftActionsProps {
  readonly phase: WorkbenchConversationDraft["phase"];
  readonly action: "promote" | "start" | "discard" | null;
  readonly canOperate: boolean;
  readonly blocker: string | null;
  /** The saved ticket exists, so only the ticket (not the draft) can still be changed. */
  readonly ticketExists: boolean;
  readonly saveState: "idle" | "saving" | "saved" | "error";
  readonly onCreate: () => void;
  readonly onStartWork: () => void;
  readonly onDiscard: () => void;
  readonly onRetryDiscard: () => void;
  /** Inline fits the chat's strip; the draft page stacks; button is the collapsed card's pair. */
  readonly layout: "stacked" | "inline" | "button";
  /** Replaces Discard for a draft with nothing to lose, skipping the confirmation. */
  readonly onCancel: (() => void) | null;
}

const SPINNER = <LoaderCircleIcon className="animate-spin" aria-hidden />;

function PlanningActions({ phase, action, canOperate, onStartWork, layout }: DraftActionsProps) {
  const label =
    action === "start"
      ? "Preparing work area…"
      : phase === "starting"
        ? "Retry start work"
        : "Start work";
  const inline = layout === "inline";
  return (
    <div className={inline ? "flex items-center gap-2" : "space-y-2"}>
      <p className={cn("text-xs text-muted-foreground", inline && "line-clamp-2 min-w-0 flex-1")}>
        Start work prepares the work area and continues this conversation there. Nothing is sent
        automatically.
      </p>
      <Button
        className={inline ? "shrink-0" : "w-full"}
        size={inline ? "sm" : "default"}
        disabled={action !== null || !canOperate}
        onClick={onStartWork}
      >
        {action === "start" ? SPINNER : <PlayIcon />}
        {label}
      </Button>
    </div>
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

/** Why Create ticket is disabled, or why it needs a retry. */
export const getDraftBlockedReason = ({
  action,
  blocker,
  phase,
  ticketExists,
}: Pick<DraftActionsProps, "action" | "blocker" | "phase" | "ticketExists">) => {
  if (phase === "promoting" && action === null && !blocker) {
    if (ticketExists)
      return "Linking the ticket to this conversation did not finish. Retry Create ticket.";
    return "Creating the ticket did not finish. Retry Create ticket, or discard the draft.";
  }
  return blocker && phase !== "creating" ? blocker : null;
};

/** The blocked reason, if any; otherwise the line reports autosave. */
const getDraftStatusLine = (
  props: Pick<DraftActionsProps, "action" | "blocker" | "phase" | "saveState" | "ticketExists">,
) => {
  const reason = getDraftBlockedReason(props);
  if (reason) return reason;
  if (props.saveState === "saving") return "Saving…";
  return props.saveState === "saved" ? "Draft saved" : "\u00a0";
};

function DiscardButton({
  action,
  onDiscard,
  layout,
  onCancel,
  disabled,
}: DraftActionsProps & { readonly disabled: boolean }) {
  if (onCancel)
    return (
      <Button size="sm" variant="ghost" disabled={disabled} onClick={onCancel}>
        {action === "discard" ? SPINNER : null}
        Cancel
      </Button>
    );
  return (
    <Button size="sm" variant="ghost" disabled={disabled} onClick={onDiscard}>
      <Trash2Icon /> {layout === "inline" ? "Discard" : "Discard draft"}
    </Button>
  );
}

function CreateTicketButton({
  action,
  phase,
  blocker,
  canOperate,
  onCreate,
  layout,
}: DraftActionsProps) {
  const creating = action === "promote";
  return (
    <Button
      size={layout === "stacked" ? "default" : "sm"}
      disabled={action !== null || phase === "creating" || blocker !== null || !canOperate}
      aria-busy={creating}
      onClick={onCreate}
    >
      {creating ? SPINNER : <TicketPlusIcon />}
      {creating ? "Creating ticket…" : "Create ticket"}
    </Button>
  );
}

function UnsavedDraftActions(props: DraftActionsProps) {
  const { phase, action, canOperate, ticketExists, layout } = props;
  const discardDisabled =
    action !== null || !canDiscardConversationDraft({ phase, ticketExists }) || !canOperate;
  if (layout === "button") {
    return (
      <div className="flex shrink-0 items-center gap-1">
        {props.onCancel ? <DiscardButton {...props} disabled={discardDisabled} /> : null}
        <CreateTicketButton {...props} />
      </div>
    );
  }
  const inline = layout === "inline";
  const statusLine = (
    <p
      role="status"
      className={cn("text-xs text-muted-foreground", inline && "line-clamp-2 min-w-0 flex-1")}
    >
      {getDraftStatusLine(props)}
    </p>
  );
  const discard = <DiscardButton {...props} disabled={discardDisabled} />;
  const create = <CreateTicketButton {...props} />;
  if (inline) {
    return (
      <div className="flex items-center gap-2">
        {statusLine}
        {discard}
        {create}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {statusLine}
      <div className="flex items-center justify-between gap-2">
        {discard}
        {create}
      </div>
    </div>
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
  layout = "stacked",
  onCancel = null,
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
  readonly layout?: DraftActionsProps["layout"];
  readonly onCancel?: DraftActionsProps["onCancel"];
}) {
  return (
    <DraftActions
      layout={layout}
      onCancel={onCancel}
      phase={draft.phase}
      action={transitions.action}
      canOperate={canOperate}
      blocker={editor.conflict ? DRAFT_CONFLICT_MESSAGE : createState.blocker}
      ticketExists={ticketExists}
      saveState={editor.saveState}
      onCreate={() => void transitions.promote(createState.effectiveFields)}
      onStartWork={() => void transitions.startWork()}
      onDiscard={onDiscard}
      onRetryDiscard={() => void transitions.discard()}
    />
  );
}
