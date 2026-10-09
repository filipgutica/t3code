import {
  ProjectId,
  type ModelSelection,
  type ProviderInstanceId,
  type WorkbenchProjectId,
  type WorkbenchSnapshot,
  type WorkbenchTicketDraft as WorkbenchConversationDraft,
  type WorkbenchTicketId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Schema from "effect/Schema";

// "Conversation draft" is the backend-owned planning record. It is unrelated to the local
// edit buffers that WorkbenchForms calls "ticket drafts".
export type { WorkbenchConversationDraft };

/** Phases before Create ticket completes; the planning Thread is an internal anchor. */
const UNSAVED_PHASES: ReadonlySet<WorkbenchConversationDraft["phase"]> = new Set([
  "creating",
  "draft",
  "promoting",
  "discarding",
]);

/** `ticketDrafts` is an optional snapshot key, so older hosts omit it. */
const draftsOf = (snapshot: WorkbenchSnapshot | null): ReadonlyArray<WorkbenchConversationDraft> =>
  snapshot?.ticketDrafts ?? [];

/** Hosts that predate conversation drafts never send the key, and reject their RPCs. */
export const supportsConversationDrafts = (snapshot: WorkbenchSnapshot | null) =>
  snapshot?.ticketDrafts !== undefined;

const isUnsavedConversationDraft = (draft: WorkbenchConversationDraft) =>
  UNSAVED_PHASES.has(draft.phase);

/** Unsaved preparations belong in the board and sidebar, separate from real tickets. */
export const getUnsavedConversationDrafts = (
  snapshot: WorkbenchSnapshot | null,
  workspaceId: WorkbenchProjectId,
): ReadonlyArray<WorkbenchConversationDraft> => {
  const ticketIds = new Set(snapshot?.tickets.map((ticket) => ticket.id) ?? []);
  return draftsOf(snapshot).filter(
    (draft) =>
      draft.projectId === workspaceId &&
      isUnsavedConversationDraft(draft) &&
      !ticketIds.has(draft.id),
  );
};

export const getConversationDraftTitle = (
  draft: WorkbenchConversationDraft,
  threadTitle?: string,
) =>
  draft.fields.title.trim() ||
  (threadTitle === "Prepare ticket" ? "" : threadTitle?.trim()) ||
  "Untitled draft";

/**
 * The conversation a selected ticket id opens. After Create ticket the id is selected before the
 * snapshot holds the ticket, and a stale snapshot still reports the draft as `draft` or
 * `promoting`, so every phase before `working` keeps the same view.
 */
const getConversationDraftForTicket = (
  snapshot: WorkbenchSnapshot | null,
  ticketId: WorkbenchTicketId,
): WorkbenchConversationDraft | null =>
  draftsOf(snapshot).find(
    (draft) =>
      draft.id === ticketId &&
      (draft.phase === "creating" ||
        draft.phase === "discarding" ||
        draft.phase === "draft" ||
        draft.phase === "promoting" ||
        draft.phase === "planning" ||
        draft.phase === "starting"),
  ) ?? null;

/** Prefers whichever record of the same draft has the higher revision; command replies beat a stale snapshot. */
export const pickNewestConversationDraft = (
  fromSnapshot: WorkbenchConversationDraft | null,
  fromCommand: WorkbenchConversationDraft | null,
): WorkbenchConversationDraft | null => {
  if (fromSnapshot === null || fromCommand === null || fromSnapshot.id !== fromCommand.id) {
    return fromSnapshot ?? fromCommand;
  }
  return fromCommand.revision > fromSnapshot.revision ? fromCommand : fromSnapshot;
};

/**
 * Discard is offered before Create ticket and while it is uncertain (`promoting`), but never once
 * the saved ticket exists: the draft is then the ticket's planning Thread and the server refuses.
 */
export const canDiscardConversationDraft = ({
  phase,
  ticketExists,
}: {
  readonly phase: WorkbenchConversationDraft["phase"];
  readonly ticketExists: boolean;
}) => (phase === "creating" || phase === "draft" || phase === "promoting") && !ticketExists;

export type WorkbenchWorkItemView =
  | { readonly kind: "conversation"; readonly draft: WorkbenchConversationDraft | null }
  | { readonly kind: "ticket" }
  | { readonly kind: "epic" }
  | { readonly kind: "board" };

/**
 * Chooses the Workspace's main-content view. `create=ticket` stays in the URL while the
 * conversation is open so reload and history resume it; a planning ticket reuses the same view.
 */
export const resolveWorkbenchWorkItemView = ({
  snapshot,
  workspaceId,
  selectedTicketId,
  ticketExists,
  hasSelectedEpic,
  createTicket,
  awaitingTicketId,
}: {
  readonly snapshot: WorkbenchSnapshot | null;
  readonly workspaceId: WorkbenchProjectId | null;
  /** The route's ticket id, which can name a ticket the snapshot does not hold yet. */
  readonly selectedTicketId: WorkbenchTicketId | null;
  readonly ticketExists: boolean;
  readonly hasSelectedEpic: boolean;
  readonly createTicket: boolean;
  readonly awaitingTicketId?: WorkbenchTicketId | null;
}): WorkbenchWorkItemView => {
  const planning =
    selectedTicketId === null ? null : getConversationDraftForTicket(snapshot, selectedTicketId);
  if (planning?.projectId === workspaceId) return { kind: "conversation", draft: planning };
  if (selectedTicketId !== null && selectedTicketId === awaitingTicketId && !ticketExists) {
    return { kind: "conversation", draft: null };
  }
  if (selectedTicketId !== null && ticketExists) return { kind: "ticket" };
  if (hasSelectedEpic) return { kind: "epic" };
  if (createTicket && workspaceId !== null) {
    return { kind: "conversation", draft: null };
  }
  return { kind: "board" };
};

export interface WorkbenchTicketDraftSuggestion {
  /** Assistant message that carried the proposal; keys Apply and Dismiss state. */
  readonly messageId: string;
  readonly sourceOffset: number;
  readonly title: string;
  readonly markdown: string;
  readonly repositoryProjectIds: ReadonlyArray<ProjectId>;
  readonly primaryT3ProjectId: ProjectId;
}

const SuggestionPayload = Schema.Struct({
  title: Schema.String,
  markdown: Schema.String,
  repositoryProjectIds: Schema.Array(Schema.String),
  primaryT3ProjectId: Schema.String,
});
const decodeSuggestionPayload = Schema.decodeUnknownOption(
  Schema.fromJsonString(SuggestionPayload),
);

// Field limits mirror WorkbenchTicketDraftFields so Apply never fails server validation.
const MAX_TITLE_LENGTH = 240;
const MAX_MARKDOWN_LENGTH = 120_000;
const FENCE =
  /^([ ]{0,3})([`~])(\2{2,})[ \t]*workbench-ticket-draft[ \t]*\r?\n([\s\S]*?)^ {0,3}\2\3\2*[ \t]*\r?$/gm;

/** The last labeled block wins, so a corrected proposal replaces an earlier one. */
const lastFencedPayload = (text: string): { code: string; sourceOffset: number } | null => {
  let block: { code: string; sourceOffset: number } | null = null;
  for (const match of text.matchAll(FENCE)) {
    block = { code: match[4] ?? "", sourceOffset: match.index + (match[1]?.length ?? 0) };
  }
  return block;
};

/** Validates a rendered proposal with the same constraints as the draft's Apply action. */
export const readTicketDraftSuggestion = ({
  code,
  messageId,
  sourceOffset,
  knownRepositoryProjectIds,
}: {
  readonly code: string;
  readonly messageId: string;
  readonly sourceOffset: number;
  readonly knownRepositoryProjectIds: ReadonlySet<string>;
}): WorkbenchTicketDraftSuggestion | null => {
  const decoded = decodeSuggestionPayload(code);
  if (decoded._tag === "None") return null;
  const { title, markdown, repositoryProjectIds, primaryT3ProjectId } = decoded.value;
  const repositories = [...new Set(repositoryProjectIds)];
  if (
    title.trim().length === 0 ||
    title.trim().length > MAX_TITLE_LENGTH ||
    markdown.trim().length > MAX_MARKDOWN_LENGTH ||
    repositories.length === 0 ||
    !repositories.every((id) => knownRepositoryProjectIds.has(id)) ||
    !repositories.includes(primaryT3ProjectId)
  ) {
    return null;
  }
  return {
    messageId,
    sourceOffset,
    title: title.trim(),
    markdown: markdown.trim(),
    repositoryProjectIds: repositories.map((id) => ProjectId.make(id)),
    primaryT3ProjectId: ProjectId.make(primaryT3ProjectId),
  };
};

export interface WorkbenchSuggestionMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly streaming: boolean;
}

/**
 * Reads the newest completed assistant message that carries a proposal. Repository IDs must
 * belong to the Workspace and the primary must be selected; anything else is ignored rather
 * than partly applied.
 */
export const findTicketDraftSuggestion = ({
  messages,
  knownRepositoryProjectIds,
}: {
  readonly messages: ReadonlyArray<WorkbenchSuggestionMessage>;
  readonly knownRepositoryProjectIds: ReadonlySet<string>;
}): WorkbenchTicketDraftSuggestion | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "assistant" || message.streaming) continue;
    const block = lastFencedPayload(message.text);
    if (block === null) continue;
    return readTicketDraftSuggestion({
      ...block,
      messageId: message.id,
      knownRepositoryProjectIds,
    });
  }
  return null;
};

/** Planning enforces read-only access only for these provider drivers. */
const PLANNING_DRIVERS: ReadonlySet<string> = new Set(["codex", "claudeAgent"]);
export const supportsEnforcedTicketPlanning = (driverKind: string | undefined) =>
  driverKind !== undefined && PLANNING_DRIVERS.has(driverKind);

export interface PlanningModelCandidate {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: string;
  readonly ready: boolean;
  readonly defaultModel: string | null;
}

/**
 * Picks the model a new planning conversation starts with: the first preferred selection that
 * the server can restrict to read-only, else the first ready supported provider. Null means no
 * configured provider can plan, and the UI offers manual entry instead.
 */
export const resolveTicketPlanningModelSelection = ({
  candidates,
  preferred,
}: {
  readonly candidates: ReadonlyArray<PlanningModelCandidate>;
  readonly preferred: ReadonlyArray<ModelSelection | null | undefined>;
}): ModelSelection | null => {
  const usable = candidates.filter(
    (candidate) => candidate.ready && supportsEnforcedTicketPlanning(candidate.driverKind),
  );
  for (const selection of preferred) {
    if (
      selection &&
      selection.model.length > 0 &&
      usable.some((candidate) => candidate.instanceId === selection.instanceId)
    ) {
      return selection;
    }
  }
  const fallback = usable.find((candidate) => candidate.defaultModel !== null);
  return fallback && fallback.defaultModel
    ? createModelSelection(fallback.instanceId, fallback.defaultModel)
    : null;
};
