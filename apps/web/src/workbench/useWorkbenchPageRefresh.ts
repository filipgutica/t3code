import type { EnvironmentId, WorkbenchJiraBinding } from "@t3tools/contracts";
import { useEffect, useRef } from "react";
import { subscribeToWorkbenchRefresh } from "./workbenchRefresh";
import type { useWorkbenchJiraBindings } from "./useWorkbenchJiraBindings";

const JIRA_REFRESH_INTERVAL_MS = 15_000;
// Stay just beyond the server's 15-second background-sync cooldown.
const JIRA_FOREGROUND_SYNC_INTERVAL_MS = 16_000;

export function useWorkbenchPageRefresh({
  environmentId,
  jiraBinding,
  jiraDialogOpen,
  jiraPendingAction,
  jiraSyncBinding,
  pendingJiraMigrationBindingsRef,
  hasLocalMigrationData,
  refreshJiraSnapshot,
  refreshWorkbenchSnapshot,
  setJiraError,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly jiraBinding: WorkbenchJiraBinding | null;
  readonly jiraDialogOpen: boolean;
  readonly jiraPendingAction: string | null;
  readonly jiraSyncBinding: ReturnType<typeof useWorkbenchJiraBindings>["jiraSyncBinding"];
  readonly pendingJiraMigrationBindingsRef: ReturnType<
    typeof useWorkbenchJiraBindings
  >["pendingJiraMigrationBindingsRef"];
  readonly hasLocalMigrationData: boolean;
  readonly refreshJiraSnapshot: () => unknown;
  readonly refreshWorkbenchSnapshot: () => unknown;
  readonly setJiraError: (message: string | null) => void;
}) {
  useEffect(() => {
    const refresh = () => refreshWorkbenchSnapshot();
    return subscribeToWorkbenchRefresh({
      target: window,
      refresh,
      intervalMs: JIRA_REFRESH_INTERVAL_MS,
    });
  }, [refreshWorkbenchSnapshot]);

  useEffect(() => {
    if (!jiraBinding?.active) return;
    const refresh = () => refreshJiraSnapshot();
    return subscribeToWorkbenchRefresh({
      target: window,
      refresh,
      intervalMs: JIRA_REFRESH_INTERVAL_MS,
    });
  }, [jiraBinding?.active, refreshJiraSnapshot]);

  const automaticJiraRequestsRef = useRef(new Set<string>());
  const automaticJiraBindingId = jiraBinding?.active ? jiraBinding.id : null;
  const automaticJiraProjectId = jiraBinding?.projectId ?? null;
  const hasPendingLocalMigrationData =
    jiraBinding?.localMigrationPending === true && hasLocalMigrationData;
  useEffect(() => {
    if (
      environmentId === null ||
      automaticJiraBindingId === null ||
      automaticJiraProjectId === null ||
      jiraDialogOpen ||
      jiraPendingAction !== null
    )
      return;
    let disposed = false;
    const requestKey = `${environmentId}:${automaticJiraBindingId}`;
    const migrationKey = `${environmentId}:${automaticJiraProjectId}`;
    const requests = automaticJiraRequestsRef.current;
    const refresh = () => {
      if (
        requests.has(requestKey) ||
        pendingJiraMigrationBindingsRef.current.get(migrationKey)?.migrationComplete === false ||
        hasPendingLocalMigrationData
      )
        return;
      requests.add(requestKey);
      void jiraSyncBinding({
        environmentId,
        input: { bindingId: automaticJiraBindingId, background: true },
      })
        .then(async (result) => {
          if (disposed) return;
          // Jira persists sync failures on the binding. Refresh that status
          // without producing recurring banners for background requests.
          await refreshJiraSnapshot();
          if (result._tag === "Success") await refreshWorkbenchSnapshot();
        })
        .catch((cause: unknown) => {
          if (!disposed)
            setJiraError(cause instanceof Error ? cause.message : "Jira refresh failed.");
        })
        .finally(() => requests.delete(requestKey));
    };
    const unsubscribe = subscribeToWorkbenchRefresh({
      target: window,
      refresh,
      intervalMs: JIRA_FOREGROUND_SYNC_INTERVAL_MS,
      immediate: true,
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [
    environmentId,
    automaticJiraBindingId,
    automaticJiraProjectId,
    automaticJiraRequestsRef,
    hasPendingLocalMigrationData,
    jiraDialogOpen,
    jiraPendingAction,
    jiraSyncBinding,
    pendingJiraMigrationBindingsRef,
    setJiraError,
    refreshJiraSnapshot,
    refreshWorkbenchSnapshot,
  ]);
}
