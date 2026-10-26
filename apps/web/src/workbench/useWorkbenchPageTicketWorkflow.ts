import type { EnvironmentId, WorkbenchTicketId } from "@t3tools/contracts";
import type { Dispatch, SetStateAction } from "react";
import { useWorkbenchTicketActions } from "./useWorkbenchTicketActions";
import { useWorkbenchThreadActions } from "./useWorkbenchThreadActions";
import { useWorkbenchSidebarActions } from "./useWorkbenchSidebarActions";
import type { useWorkbenchPageData } from "./useWorkbenchPageData";
import type { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";
export function useWorkbenchPageTicketWorkflow({
  environmentId,
  pageData,
  selection,
  pendingAction,
  setPendingAction,
  setError,
  initialTicketId,
}: {
  environmentId: EnvironmentId | null;
  pageData: ReturnType<typeof useWorkbenchPageData>;
  selection: ReturnType<typeof useWorkbenchPageSelection>;
  pendingAction: string | null;
  setPendingAction: Dispatch<SetStateAction<string | null>>;
  setError: (message: string | null) => void;
  initialTicketId: WorkbenchTicketId | undefined;
}) {
  const {
    optimisticStatus,
    ticketDrafts,
    snapshot,
    refreshWorkbenchSnapshot,
    clearTicketDraft,
    threadLookupReady,
  } = pageData;
  const { selectedTicket, closeWorkItem } = selection;
  const ticketActions = useWorkbenchTicketActions({
    environmentId,
    pendingAction,
    setPendingAction,
    setError,
    optimisticStatus,
    ticketDrafts,
    snapshot,
    refreshWorkbenchSnapshot,
    clearTicketDraft,
    closeWorkItem,
  });
  const { changeTicket, setTicketArchived, ticketForBoardAction } = ticketActions;

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
    setTicketArchived,
    setError,
  });

  return { ticketActions, threadActions };
}
