import { useWorkbenchPageEnvironment } from "./useWorkbenchPageEnvironment";
import { useWorkbenchPageJira } from "./useWorkbenchPageJira";
import { useWorkbenchPageTicketWorkflow } from "./useWorkbenchPageTicketWorkflow";

import { WorkbenchPageView } from "./WorkbenchPageView";
import { useWorkbenchPageDialogs } from "./useWorkbenchPageDialogs";

import { useWorkbenchBoardData } from "./useWorkbenchBoardData";
import { useWorkbenchPageData } from "./useWorkbenchPageData";

import { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";
import { useWorkbenchPageRefresh } from "./useWorkbenchPageRefresh";

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
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const selection = useWorkbenchPageSelection({
    environmentId,
    initialProjectId,
    initialTicketId,
    initialEpicId,
    snapshot,
    tickets: optimisticStatus.tickets,
    pendingAction,
    setError,
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

  useWorkbenchPageRefresh({
    environmentId,
    jiraBinding,
    jiraDialogOpen,
    jiraPendingAction,
    jiraSyncBinding,
    pendingJiraMigrationBindingsRef,
    hasLocalMigrationData:
      localTicketsForJiraMigration.length > 0 || localEpicsForJiraMigration.length > 0,
    refreshJiraSnapshot,
    refreshWorkbenchSnapshot,
    setJiraError,
  });

  return (
    <WorkbenchPageView
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
  );
}
