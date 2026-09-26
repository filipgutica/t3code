import type { EnvironmentId, WorkbenchTicketId, WorkbenchSnapshot } from "@t3tools/contracts";
import { useEffect } from "react";
import {
  peekWorkbenchSidebarTicketAction,
  subscribeWorkbenchSidebarTicketActions,
  takeWorkbenchSidebarTicketAction,
} from "./workbenchSidebarTicketAction";
import type { useWorkbenchThreadActions } from "./useWorkbenchThreadActions";
import type { useWorkbenchTicketActions } from "./useWorkbenchTicketActions";

export function useWorkbenchSidebarActions({
  environmentId,
  initialTicketId,
  snapshot,
  pending,
  threadLookupReady,
  requestNewThread,
  changeTicket,
  changeJiraTransition,
  setTicketArchived,
  setError,
}: {
  environmentId: EnvironmentId | null;
  initialTicketId: WorkbenchTicketId | undefined;
  snapshot: WorkbenchSnapshot | null;
  pending: boolean;
  threadLookupReady: boolean;
  requestNewThread: ReturnType<typeof useWorkbenchThreadActions>["requestNewThread"];
  changeTicket: ReturnType<typeof useWorkbenchTicketActions>["changeTicket"];
  changeJiraTransition: ReturnType<typeof useWorkbenchTicketActions>["changeJiraTransition"];
  setTicketArchived: ReturnType<typeof useWorkbenchTicketActions>["setTicketArchived"];
  setError: (message: string | null) => void;
}) {
  useEffect(() => {
    const runSidebarAction = () => {
      if (environmentId === null || initialTicketId === undefined || snapshot === null || pending)
        return;
      const queued = peekWorkbenchSidebarTicketAction(environmentId);
      if (queued?.ticketId !== initialTicketId) return;
      if (queued.kind === "new-thread" && !threadLookupReady) return;
      const action = takeWorkbenchSidebarTicketAction(environmentId, initialTicketId);
      if (!action) return;
      const ticket = snapshot.tickets.find((candidate) => candidate.id === action.ticketId);
      if (!ticket) {
        setError("This Ticket is no longer available.");
        return;
      }
      switch (action.kind) {
        case "new-thread":
          requestNewThread(ticket);
          break;
        case "status":
          changeTicket(ticket, { status: action.status });
          break;
        case "jira-transition":
          void changeJiraTransition({
            ticket,
            transitionId: action.transitionId,
            destination: action.destination,
            expectedRemoteUpdatedAt: action.expectedRemoteUpdatedAt,
          });
          break;
        case "archive":
          void setTicketArchived(ticket, action.archived ? new Date().toISOString() : null);
          break;
      }
    };
    const unsubscribe = subscribeWorkbenchSidebarTicketActions(runSidebarAction);
    runSidebarAction();
    return unsubscribe;
  }, [
    environmentId,
    initialTicketId,
    snapshot,
    pending,
    threadLookupReady,
    requestNewThread,
    changeTicket,
    changeJiraTransition,
    setTicketArchived,
    setError,
  ]);
}
