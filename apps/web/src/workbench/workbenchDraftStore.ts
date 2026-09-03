import type { WorkbenchTicketId } from "@t3tools/contracts";
import { create } from "zustand";

export interface WorkbenchTicketDraft {
  readonly title: string;
  readonly markdown: string;
  readonly mode: "editing" | "saved";
}

interface WorkbenchDraftStore {
  readonly drafts: ReadonlyMap<WorkbenchTicketId, WorkbenchTicketDraft>;
  readonly setDraft: (ticketId: WorkbenchTicketId, draft: WorkbenchTicketDraft) => void;
  readonly markDraftSaved: (
    ticketId: WorkbenchTicketId,
    content: Pick<WorkbenchTicketDraft, "title" | "markdown">,
  ) => void;
  readonly clearDraft: (ticketId: WorkbenchTicketId) => void;
}

export const useWorkbenchDraftStore = create<WorkbenchDraftStore>()((set) => ({
  drafts: new Map(),
  setDraft: (ticketId, draft) =>
    set((state) => ({ drafts: new Map(state.drafts).set(ticketId, draft) })),
  markDraftSaved: (ticketId, content) =>
    set((state) => {
      const draft = state.drafts.get(ticketId);
      if (!draft) return state;
      return {
        drafts: new Map(state.drafts).set(ticketId, { ...content, mode: "saved" }),
      };
    }),
  clearDraft: (ticketId) =>
    set((state) => {
      if (!state.drafts.has(ticketId)) return state;
      const drafts = new Map(state.drafts);
      drafts.delete(ticketId);
      return { drafts };
    }),
}));
