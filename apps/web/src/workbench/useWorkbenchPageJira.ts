import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import { useWorkbenchJiraBindings } from "./useWorkbenchJiraBindings";
import { useWorkbenchJiraAuthorization } from "./useWorkbenchJiraAuthorization";
import type { useWorkbenchPageData } from "./useWorkbenchPageData";
import type { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";

export function useWorkbenchPageJira({
  environmentId,
  environmentHttpBaseUrl,
  pageData,
  selection,
  jiraOAuthCode,
  jiraOAuthState,
  jiraOAuthError,
}: {
  environmentId: EnvironmentId | null;
  environmentHttpBaseUrl: string | null;
  pageData: ReturnType<typeof useWorkbenchPageData>;
  selection: ReturnType<typeof useWorkbenchPageSelection>;
  jiraOAuthCode: string | undefined;
  jiraOAuthState: string | undefined;
  jiraOAuthError: string | undefined;
}) {
  const navigate = useNavigate({ from: "/workbench" });
  const [jiraDialogOpen, setJiraDialogOpen] = useState(false);
  const { selectedProjectId, selectedProject, setSelectedProjectId } = selection;
  const { snapshotProjects, refreshJiraSnapshot, refreshWorkbenchSnapshot } = pageData;
  const jiraBindings = useWorkbenchJiraBindings({
    environmentId,
    selectedProjectId,
    selectedProject,
    refreshJiraSnapshot,
    refreshWorkbenchSnapshot,
  });
  const { setJiraError, setJiraPendingAction } = jiraBindings;

  const { beginJiraAuthFlow } = useWorkbenchJiraAuthorization({
    environmentId,
    environmentHttpBaseUrl,
    selectedProjectId: selectedProject?.id ?? null,
    snapshotProjects,
    jiraOAuthCode,
    jiraOAuthState,
    jiraOAuthError,
    jiraDialogOpen,
    setSelectedProjectId,
    setJiraDialogOpen,
    setJiraError,
    setJiraPendingAction,
    refreshJiraSnapshot,
    navigate,
  });

  const openJiraDialog = () => {
    setJiraError(null);
    setJiraDialogOpen(true);
  };
  const handleJiraDialogOpenChange = (open: boolean) => {
    setJiraDialogOpen(open);
    if (!open) setJiraError(null);
  };

  return {
    jiraBindings,
    jiraDialogOpen,
    beginJiraAuthFlow,
    openJiraDialog,
    handleJiraDialogOpenChange,
  };
}
