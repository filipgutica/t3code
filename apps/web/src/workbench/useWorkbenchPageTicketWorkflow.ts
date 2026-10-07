import type { EnvironmentId, WorkbenchTicketId } from "@t3tools/contracts";
import type { Dispatch, SetStateAction } from "react";
import { useWorkbenchTicketActions } from "./useWorkbenchTicketActions";
import { useWorkbenchThreadActions } from "./useWorkbenchThreadActions";
import { useWorkbenchSidebarActions } from "./useWorkbenchSidebarActions";
import type { useWorkbenchPageData } from "./useWorkbenchPageData";
import type { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";
import type { useWorkbenchJiraBindings } from "./useWorkbenchJiraBindings";
import type { useWorkbenchBoardData } from "./useWorkbenchBoardData";
export function useWorkbenchPageTicketWorkflow({
  environmentId,
  pageData,
  selection,
  jiraBindings,
  boardData,
  pendingAction,
  setPendingAction,
  setError,
  initialTicketId,
}: {
  environmentId: EnvironmentId | null;
  pageData: ReturnType<typeof useWorkbenchPageData>;
  selection: ReturnType<typeof useWorkbenchPageSelection>;
  jiraBindings: ReturnType<typeof useWorkbenchJiraBindings>;
  boardData: ReturnType<typeof useWorkbenchBoardData>;
  pendingAction: string | null;
  setPendingAction: Dispatch<SetStateAction<string | null>>;
  setError: (message: string | null) => void;
  initialTicketId: WorkbenchTicketId | undefined;
}) {
  const {
    optimisticStatus,
    ticketDrafts,
    snapshot,
    jiraSnapshot,
    refreshWorkbenchSnapshot,
    refreshJiraSnapshot,
    clearTicketDraft,
    threadLookupReady,
  } = pageData;
  const { selectedTicket, closeWorkItem } = selection;
  const { statusEnvironmentRef, syncJiraBinding } = jiraBindings;
  const { jiraOwnershipKnown, jiraIssueLinksByTicketId, jiraManagedTicketIds } = boardData;
  const ticketActions = useWorkbenchTicketActions({
    environmentId,
    selectedProjectId: selection.selectedProject?.id ?? null,
    pendingAction,
    setPendingAction,
    setError,
    optimisticStatus,
    jiraOwnershipKnown,
    ticketDrafts,
    jiraIssueLinksByTicketId,
    jiraManagedTicketIds,
    statusEnvironmentRef,
    snapshot,
    jiraSnapshot,
    refreshWorkbenchSnapshot,
    refreshJiraSnapshot,
    syncJiraBinding,
    clearTicketDraft,
    closeWorkItem,
  });
  const { changeTicket, changeJiraTransition, setTicketArchived, ticketForBoardAction } =
    ticketActions;

  const threadActions = useWorkbenchThreadActions({
    environmentId,
    pageData,
    selectedTicket,
    pendingAction,
    setPendingAction,
    setError,
    ticketForBoardAction,
    repositoryScopeDraft: ticketActions.repositoryScopeDraft,
    clearRepositoryScope: ticketActions.clearRepositoryScope,
    acceptSavedRepositoryScope: ticketActions.acceptSavedRepositoryScope,
    onEditRepositories: (ticket) => {
      ticketActions.editRepositories({ ticket, prepare: false });
      selection.setSelectedProjectId(ticket.projectId);
      selection.setSelectedTicketId(ticket.id);
      selection.setSelectedEpicId(null);
      void selection.updateRouteSelection(ticket.projectId, ticket.id);
    },
  });
  const { requestNewThread } = threadActions;

  const pending = pendingAction !== null;

  useWorkbenchSidebarActions({
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
  });

  return { ticketActions, threadActions };
}
