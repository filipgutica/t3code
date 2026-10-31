import type { EnvironmentId, WorkbenchTicketId } from "@t3tools/contracts";
import { useWorkbenchDraftStore, type WorkbenchTicketDraft } from "./workbenchDraftStore";
const EMPTY_TICKET_DRAFTS = new Map<WorkbenchTicketId, WorkbenchTicketDraft>();
export function useWorkbenchTicketDrafts({
  environmentId,
}: {
  environmentId: EnvironmentId | null;
}) {
  const ticketDrafts = useWorkbenchDraftStore((state) =>
    environmentId === null
      ? EMPTY_TICKET_DRAFTS
      : (state.drafts.get(environmentId) ?? EMPTY_TICKET_DRAFTS),
  );
  const clearTicketDraft = useWorkbenchDraftStore((state) => state.clearDraft);
  return { ticketDrafts, clearTicketDraft };
}
