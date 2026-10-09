import { useWorkbenchPageEnvironment } from "./useWorkbenchPageEnvironment";
import { useWorkbenchPageJira } from "./useWorkbenchPageJira";
import { useWorkbenchPageTicketWorkflow } from "./useWorkbenchPageTicketWorkflow";

import { LinkPullRequestDialogHost } from "../components/pullRequest/LinkPullRequestDialog";
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
  readonly initialProjectId: WorkbenchProjectId | undefined;
  readonly initialTicketId: WorkbenchTicketId | undefined;
  readonly initialEpicId: WorkbenchEpicId | undefined;
  readonly jiraOAuthCode: string | undefined;
  readonly jiraOAuthState: string | undefined;
  readonly jiraOAuthError: string | undefined;
}

export function WorkbenchPage({
  initialEnvironmentId,
  createWorkspace,
  initialProjectId,
  initialTicketId,
  initialEpicId,
  jiraOAuthCode,
  jiraOAuthState,
  jiraOAuthError,
}: WorkbenchPageProps) {
  const { environmentId, environmentHttpBaseUrl } = useWorkbenchPageEnvironment({
    initialEnvironmentId,
    jiraOAuthCode,
    jiraOAuthState,
    jiraOAuthError,
  });
  const pageData = useWorkbenchPageData(environmentId);
  const { projects, refreshWorkbenchSnapshot, refreshJiraSnapshot, snapshot, optimisticStatus } =
    pageData;
  const { error, setError, pendingAction, setPendingAction, workspaceActions, selection } =
    useWorkbenchWorkspaceSelection({
      environmentId,
      snapshot,
      tickets: optimisticStatus.tickets,
      initialProjectId,
      initialTicketId,
      initialEpicId,
    });

  const {
    jiraBindings,
    jiraDialogOpen,
    beginJiraAuthFlow,
    openJiraDialog,
    handleJiraDialogOpenChange,
  } = useWorkbenchPageJira({
    environmentId,
    environmentHttpBaseUrl,
    pageData,
    selection,
    jiraOAuthCode,
    jiraOAuthState,
    jiraOAuthError,
  });
  const {
    setJiraError,
    jiraPendingAction,
    jiraSyncNotice,
    pendingJiraMigrationBindingsRef,
    jiraSyncBinding,
  } = jiraBindings;

  const dialogs = useWorkbenchPageDialogs({
    environmentId,
    projects,
    localOnlySupported: pageData.jiraSnapshot?.supportsLocalOnlyTickets === true,
    selection,
    setPendingAction,
    setError,
  });

  const boardData = useWorkbenchBoardData({ environmentId, pageData, selection, jiraSyncNotice });
  const { jiraBinding, localTicketsForJiraMigration, localEpicsForJiraMigration } = boardData;

  const { ticketActions, threadActions } = useWorkbenchPageTicketWorkflow({
    environmentId,
    pageData,
    selection,
    jiraBindings,
    boardData,
    pendingAction,
    setPendingAction,
    setError,
    initialTicketId,
  });

  const refreshBinding = getWorkbenchRefreshBinding(selection.selectedProject, jiraBinding);
  const hasLocalMigrationData =
    localTicketsForJiraMigration.length > 0 || localEpicsForJiraMigration.length > 0;
  useWorkbenchPageRefresh({
    environmentId,
    jiraBinding: refreshBinding,
    jiraDialogOpen,
    jiraPendingAction,
    jiraSyncBinding,
    pendingJiraMigrationBindingsRef,
    hasLocalMigrationData,
    refreshJiraSnapshot,
    refreshWorkbenchSnapshot,
    setJiraError,
  });

  return (
    <>
      <LinkPullRequestDialogHost />
      <WorkbenchPageDeleteConfirmation
        workspaceActions={workspaceActions}
        pending={pendingAction !== null}
        error={error}
      />
      <WorkbenchPageView
        workspaceActions={workspaceActions}
        environmentId={environmentId}
        createWorkspace={createWorkspace}
        jiraDialogOpen={jiraDialogOpen}
        error={error}
        pendingAction={pendingAction}
        setError={setError}
        beginJiraAuthFlow={beginJiraAuthFlow}
        openJiraDialog={openJiraDialog}
        handleJiraDialogOpenChange={handleJiraDialogOpenChange}
        pageData={pageData}
        selection={selection}
        jiraBindings={jiraBindings}
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

function getWorkbenchRefreshBinding(
  workspace: ReturnType<typeof useWorkbenchPageSelection>["selectedProject"],
  binding: ReturnType<typeof useWorkbenchBoardData>["jiraBinding"],
) {
  return workspace?.archivedAt != null ? null : binding;
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
