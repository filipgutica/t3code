import {
  type ModelSelection,
  type ProjectId,
  type ProviderInstanceId,
  type WorkbenchProjectId,
  type WorkbenchSnapshot,
  type WorkbenchTicketDraft as WorkbenchConversationDraft,
  type WorkbenchTicketId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import {
  resolveProjectSettings,
  type LegacyProjectSettingsFields,
} from "@t3tools/shared/projectSettings";

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

export const isUnsavedConversationDraft = (draft: WorkbenchConversationDraft) =>
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
 * `promoting`, so those phases keep the conversation until the saved ticket arrives.
 */
const getConversationDraftForTicket = (
  snapshot: WorkbenchSnapshot | null,
  ticketId: WorkbenchTicketId,
  ticketExists: boolean,
): WorkbenchConversationDraft | null =>
  draftsOf(snapshot).find(
    (draft) =>
      draft.id === ticketId &&
      (draft.phase === "creating" ||
        draft.phase === "discarding" ||
        draft.phase === "draft" ||
        draft.phase === "promoting" ||
        (!ticketExists && (draft.phase === "planning" || draft.phase === "starting"))),
  ) ?? null;

/** A saved ticket whose planning Thread has not started work yet; its page offers Start work. */
export const getPlanningTicketDraft = (
  snapshot: WorkbenchSnapshot | null,
  ticketId: WorkbenchTicketId,
): WorkbenchConversationDraft | null =>
  draftsOf(snapshot).find(
    (draft) => draft.id === ticketId && (draft.phase === "planning" || draft.phase === "starting"),
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
 * conversation is open so reload and history resume it; a saved ticket opens its own page.
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
    selectedTicketId === null
      ? null
      : getConversationDraftForTicket(snapshot, selectedTicketId, ticketExists);
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

/**
 * The model a native new Thread in this project starts on: the project's override, else the
 * environment default. Null leaves the choice to the caller's sticky model and fallback.
 */
export const resolveWorkbenchDefaultModelSelection = ({
  settings,
  projectId,
  project,
}: {
  readonly settings: Parameters<typeof resolveProjectSettings>[0];
  readonly projectId: ProjectId | null;
  readonly project: LegacyProjectSettingsFields | null | undefined;
}): ModelSelection | null =>
  resolveProjectSettings(settings, projectId, project).settings.defaultModelSelection;

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
