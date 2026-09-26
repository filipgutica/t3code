import type {
  EnvironmentId,
  WorkbenchTicketId,
  WorkbenchSnapshot,
  WorkbenchJiraSnapshot,
} from "@t3tools/contracts";
import { useEffect } from "react";
import {
  isWorkbenchDraftProjected,
  useWorkbenchDraftStore,
  type WorkbenchTicketDraft,
} from "./workbenchDraftStore";
const EMPTY_TICKET_DRAFTS = new Map<WorkbenchTicketId, WorkbenchTicketDraft>();
export function useWorkbenchTicketDrafts({
  environmentId,
  snapshot,
  jiraSnapshot,
}: {
  environmentId: EnvironmentId | null;
  snapshot: WorkbenchSnapshot | null;
  jiraSnapshot: WorkbenchJiraSnapshot | null;
}) {
  const ticketDrafts = useWorkbenchDraftStore((state) =>
    environmentId === null
      ? EMPTY_TICKET_DRAFTS
      : (state.drafts.get(environmentId) ?? EMPTY_TICKET_DRAFTS),
  );
  const clearTicketDraft = useWorkbenchDraftStore((state) => state.clearDraft);
  useEffect(() => {
    for (const [ticketId, draft] of ticketDrafts) {
      if (draft.mode !== "saved") continue;
      const projectedTicket = snapshot?.tickets.find((ticket) => ticket.id === ticketId);
      if (
        isWorkbenchDraftProjected({
          draft,
          ticket: projectedTicket,
          jiraRemoteUpdatedAt: jiraSnapshot?.issueLinks.find((link) => link.ticketId === ticketId)
            ?.issue.remoteUpdatedAt,
        })
      ) {
        if (environmentId !== null) clearTicketDraft(environmentId, ticketId);
      }
    }
  }, [clearTicketDraft, environmentId, jiraSnapshot?.issueLinks, snapshot?.tickets, ticketDrafts]);

  return { ticketDrafts, clearTicketDraft };
}
