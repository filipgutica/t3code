import { usePrimaryEnvironmentId } from "../state/environments";
import { useWorkbenchPageTicketWorkflow } from "./useWorkbenchPageTicketWorkflow";

import { WorkbenchPageView } from "./WorkbenchPageView";
import { useWorkbenchPageDialogs } from "./useWorkbenchPageDialogs";

import { useWorkbenchBoardData } from "./useWorkbenchBoardData";
import { useWorkbenchPageData } from "./useWorkbenchPageData";

import { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";
import { useWorkbenchPageRefresh } from "./useWorkbenchPageRefresh";
import { useWorkbenchWorkspaceActions } from "./useWorkbenchWorkspaceActions";
import { WorkbenchWorkspaceDeleteDialog } from "./WorkbenchWorkspaceDeleteDialog";

import {
  EnvironmentId,
  WorkbenchEpicId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";

import { useState } from "react";

interface WorkbenchPageProps {
  readonly initialEnvironmentId: EnvironmentId | undefined;
  readonly createWorkspace: boolean;
  readonly createTicket: boolean;
  readonly initialProjectId: WorkbenchProjectId | undefined;
  readonly initialTicketId: WorkbenchTicketId | undefined;
  readonly initialEpicId: WorkbenchEpicId | undefined;
}

export function WorkbenchPage({
  initialEnvironmentId,
  createWorkspace,
  createTicket,
  initialProjectId,
  initialTicketId,
  initialEpicId,
}: WorkbenchPageProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId = initialEnvironmentId ?? primaryEnvironmentId;
  const pageData = useWorkbenchPageData(environmentId);
  const { projects, refreshWorkbenchSnapshot, snapshot, optimisticStatus } = pageData;
  const { error, setError, pendingAction, setPendingAction, workspaceActions, selection } =
    useWorkbenchWorkspaceSelection({
      environmentId,
      snapshot,
      tickets: optimisticStatus.tickets,
      initialProjectId,
      initialTicketId,
      initialEpicId,
    });

  const dialogs = useWorkbenchPageDialogs({
    environmentId,
    snapshot: pageData.snapshot,
    projects,
    canOperate: pageData.canOperate,
    selection,
    setPendingAction,
    setError,
  });

  const boardData = useWorkbenchBoardData({ environmentId, pageData, selection });

  const { ticketActions, threadActions } = useWorkbenchPageTicketWorkflow({
    environmentId,
    pageData,
    selection,
    pendingAction,
    setPendingAction,
    setError,
    initialTicketId,
  });

  useWorkbenchPageRefresh(refreshWorkbenchSnapshot);

  return (
    <>
      <WorkbenchPageDeleteConfirmation
        workspaceActions={workspaceActions}
        pending={pendingAction !== null}
        error={error}
      />
      <WorkbenchPageView
        workspaceActions={workspaceActions}
        environmentId={environmentId}
        createWorkspace={createWorkspace}
        createTicket={createTicket}
        error={error}
        pendingAction={pendingAction}
        setError={setError}
        pageData={pageData}
        selection={selection}
        dialogs={dialogs}
        boardData={boardData}
        ticketActions={ticketActions}
        threadActions={threadActions}
      />
    </>
  );
}

function WorkbenchPageDeleteConfirmation({
  workspaceActions,
  pending,
  error,
}: {
  workspaceActions: ReturnType<typeof useWorkbenchWorkspaceActions>;
  pending: boolean;
  error: string | null;
}) {
  if (workspaceActions.deletion === null) return null;
  return (
    <WorkbenchWorkspaceDeleteDialog
      {...workspaceActions.deletion}
      canDelete={workspaceActions.canDelete}
      pending={pending}
      error={error}
      onClose={workspaceActions.closeDeletion}
      onDelete={workspaceActions.removeWorkspace}
    />
  );
}

function useWorkbenchWorkspaceSelection(
  options: Pick<
    Parameters<typeof useWorkbenchPageSelection>[0],
    | "environmentId"
    | "initialProjectId"
    | "initialTicketId"
    | "initialEpicId"
    | "snapshot"
    | "tickets"
  >,
) {
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const workspaceActions = useWorkbenchWorkspaceActions({
    environmentId: options.environmentId,
    snapshot: options.snapshot,
    pendingAction,
    setPendingAction,
    setError,
  });
  const selection = useWorkbenchPageSelection({
    ...options,
    excludedProjectIds: workspaceActions.deletedProjectIds,
    pendingAction,
    setError,
  });
  return { error, setError, pendingAction, setPendingAction, workspaceActions, selection };
}
