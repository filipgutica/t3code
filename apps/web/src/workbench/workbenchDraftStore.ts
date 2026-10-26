import type { EnvironmentId, WorkbenchTicket, WorkbenchTicketId } from "@t3tools/contracts";
import { create } from "zustand";

export interface WorkbenchTicketDraft {
  readonly title: string;
  readonly markdown: string;
  readonly mode: "editing" | "saved";
  /** Ticket revision captured when editing began. */
  readonly revision?: number;
  readonly savedVersion?: WorkbenchTicketSavedVersion;
}

export type WorkbenchTicketSavedVersion = { readonly revision: number };

type DraftContent = Pick<WorkbenchTicketDraft, "title" | "markdown" | "revision">;

const draftMatchesSubmittedVersion = (
  draft: WorkbenchTicketDraft,
  submittedContent: DraftContent,
): boolean => draft.revision === submittedContent.revision;

const getDraftVersion = (content: DraftContent): Pick<WorkbenchTicketDraft, "revision"> =>
  content.revision !== undefined ? { revision: content.revision } : {};

const getSavedVersion = (content: DraftContent): WorkbenchTicketSavedVersion | undefined =>
  content.revision !== undefined ? { revision: content.revision } : undefined;

const mergeSavedDraft = ({
  draft,
  content,
  submittedContent,
}: {
  readonly draft: WorkbenchTicketDraft;
  readonly content: DraftContent;
  readonly submittedContent: DraftContent;
}): WorkbenchTicketDraft => {
  const version = getDraftVersion(content);
  const unchanged =
    draft.title === submittedContent.title && draft.markdown === submittedContent.markdown;
  const savedVersion = getSavedVersion(content);
  return {
    ...draft,
    ...version,
    ...(unchanged
      ? {
          title: content.title,
          markdown: content.markdown,
          mode: "saved" as const,
          ...(savedVersion ? { savedVersion } : {}),
        }
      : {}),
  };
};

export const isWorkbenchDraftProjected = ({
  draft,
  ticket,
}: {
  readonly draft: WorkbenchTicketDraft | undefined;
  readonly ticket: Pick<WorkbenchTicket, "title" | "markdown" | "revision"> | undefined;
}): boolean => {
  if (draft?.mode !== "saved" || ticket === undefined) return false;
  if (draft.savedVersion) return ticket.revision >= draft.savedVersion.revision;
  return ticket.title === draft.title && ticket.markdown === draft.markdown;
};

interface WorkbenchDraftStore {
  readonly drafts: ReadonlyMap<EnvironmentId, ReadonlyMap<WorkbenchTicketId, WorkbenchTicketDraft>>;
  readonly setDraft: (
    environmentId: EnvironmentId,
    ticketId: WorkbenchTicketId,
    draft: WorkbenchTicketDraft,
  ) => void;
  readonly markDraftSaved: (
    environmentId: EnvironmentId,
    ticketId: WorkbenchTicketId,
    content: DraftContent,
    submittedContent: DraftContent,
  ) => void;
  readonly clearDraft: (environmentId: EnvironmentId, ticketId: WorkbenchTicketId) => void;
}

export const useWorkbenchDraftStore = create<WorkbenchDraftStore>()((set) => ({
  drafts: new Map(),
  setDraft: (environmentId, ticketId, draft) =>
    set((state) => {
      const drafts = new Map(state.drafts);
      drafts.set(environmentId, new Map(drafts.get(environmentId) ?? []).set(ticketId, draft));
      return { drafts };
    }),
  markDraftSaved: (environmentId, ticketId, content, submittedContent) =>
    set((state) => {
      const environmentDrafts = state.drafts.get(environmentId);
      const draft = environmentDrafts?.get(ticketId);
      if (!draft) return state;
      if (!draftMatchesSubmittedVersion(draft, submittedContent)) return state;
      const drafts = new Map(state.drafts);
      drafts.set(
        environmentId,
        new Map(environmentDrafts).set(
          ticketId,
          // Newer typing remains editable, but its next save must use the version
          // returned by this successful write rather than its previous base.
          mergeSavedDraft({ draft, content, submittedContent }),
        ),
      );
      return {
        drafts,
      };
    }),
  clearDraft: (environmentId, ticketId) =>
    set((state) => {
      const environmentDrafts = state.drafts.get(environmentId);
      if (!environmentDrafts?.has(ticketId)) return state;
      const drafts = new Map(state.drafts);
      const nextEnvironmentDrafts = new Map(environmentDrafts);
      nextEnvironmentDrafts.delete(ticketId);
      if (nextEnvironmentDrafts.size === 0) drafts.delete(environmentId);
      else drafts.set(environmentId, nextEnvironmentDrafts);
      return { drafts };
    }),
}));
