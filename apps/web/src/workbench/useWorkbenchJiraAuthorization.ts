import { EnvironmentId, type WorkbenchProjectId, type WorkbenchProject } from "@t3tools/contracts";
import type { NavigateFn } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { isElectron } from "../env";
import { readLocalApi } from "../localApi";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import type { WorkbenchSearch } from "./workbenchSearch";
import { reportWorkbenchCommandFailure } from "./workbenchPageCommands";
import {
  decodePendingJiraBrokerAuth,
  serializePendingJiraBrokerAuth,
  type JiraBrokerAuthState,
} from "./jiraBrokerAuth";
import {
  resolveWorkbenchJiraOAuthCallback,
  resolveWorkbenchJiraRedirectUri,
} from "./workbenchJira.logic";

const JIRA_OAUTH_WORKSPACE_STORAGE_KEY = "t3code:workbench:jira-oauth-workspace";
const JIRA_OAUTH_ENVIRONMENT_STORAGE_KEY = "t3code:workbench:jira-oauth-environment";
const JIRA_OAUTH_STATE_STORAGE_KEY = "t3code:workbench:jira-oauth-state";
const isEnvironmentId = Schema.is(EnvironmentId);
export const readPendingJiraEnvironmentId = (): EnvironmentId | null => {
  try {
    const value = sessionStorage.getItem(JIRA_OAUTH_ENVIRONMENT_STORAGE_KEY);
    return value !== null && isEnvironmentId(value) ? value : null;
  } catch {
    return null;
  }
};

const readPendingJiraBrokerAuth = (): JiraBrokerAuthState | null => {
  try {
    const serialized = sessionStorage.getItem(JIRA_OAUTH_STATE_STORAGE_KEY);
    if (serialized === null) return null;
    const state = decodePendingJiraBrokerAuth({ serialized, nowEpochMs: Date.now() });
    if (state === null) sessionStorage.removeItem(JIRA_OAUTH_STATE_STORAGE_KEY);
    return state;
  } catch {
    try {
      sessionStorage.removeItem(JIRA_OAUTH_STATE_STORAGE_KEY);
    } catch {
      // Ignore storage failures while restoring an optional pending flow.
    }
    return null;
  }
};

const writePendingJiraBrokerAuth = (state: JiraBrokerAuthState): void => {
  try {
    sessionStorage.setItem(JIRA_OAUTH_STATE_STORAGE_KEY, serializePendingJiraBrokerAuth(state));
  } catch {
    // The in-memory state still lets the current tab finish authorization.
  }
};

const jiraOAuthRedirectUri = ({ serverHttpUrl }: { readonly serverHttpUrl: string }) =>
  resolveWorkbenchJiraRedirectUri({
    desktop: isElectron,
    browserOrigin: window.location.origin,
    serverHttpUrl,
  });

const launchJiraAuthorization = async ({
  authorizationUrl,
  environmentId,
  selectedProjectId,
  broker,
  brokerWindow,
  setError,
}: {
  readonly authorizationUrl: string;
  readonly environmentId: EnvironmentId;
  readonly selectedProjectId: WorkbenchProjectId | null;
  readonly broker: boolean;
  readonly brokerWindow: Window | null;
  readonly setError: (message: string) => void;
}) => {
  if (isElectron) {
    try {
      const api = readLocalApi();
      if (!api) throw new Error("The desktop browser launcher is unavailable.");
      await api.shell.openExternal(authorizationUrl);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not open Jira authorization.");
    }
    return;
  }
  if (selectedProjectId !== null) {
    sessionStorage.setItem(JIRA_OAUTH_WORKSPACE_STORAGE_KEY, selectedProjectId);
  }
  sessionStorage.setItem(JIRA_OAUTH_ENVIRONMENT_STORAGE_KEY, environmentId);
  if (broker) {
    if (brokerWindow === null || brokerWindow.closed) {
      setError("Could not open Jira authorization. Allow pop-ups and try again.");
      return;
    }
    try {
      brokerWindow.location.assign(authorizationUrl);
    } catch {
      setError("Could not open Jira authorization. Allow pop-ups and try again.");
    }
    return;
  }
  brokerWindow?.close();
  window.location.assign(authorizationUrl);
};

const resolveJiraOAuthReturnSearch = ({
  previous,
  environmentId,
  storedEnvironmentId,
  projectId,
}: {
  readonly previous: WorkbenchSearch;
  readonly environmentId: EnvironmentId;
  readonly storedEnvironmentId: EnvironmentId | null;
  readonly projectId: WorkbenchProjectId | undefined;
}): WorkbenchSearch => {
  const nextEnvironmentId = environmentId ?? storedEnvironmentId ?? previous.environmentId;
  const nextProjectId = projectId ?? previous.workbenchProjectId;
  return {
    ...(nextEnvironmentId ? { environmentId: nextEnvironmentId } : {}),
    ...(nextProjectId ? { workbenchProjectId: nextProjectId } : {}),
    ...(previous.ticketId
      ? { ticketId: previous.ticketId }
      : previous.epicId
        ? { epicId: previous.epicId }
        : {}),
    ...(previous.create ? { create: previous.create } : {}),
  };
};

export function useWorkbenchJiraAuthorization({
  environmentId,
  environmentHttpBaseUrl,
  selectedProjectId,
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
}: {
  readonly environmentId: EnvironmentId | null;
  readonly environmentHttpBaseUrl: string | null;
  readonly selectedProjectId: WorkbenchProjectId | null;
  readonly snapshotProjects: ReadonlyArray<WorkbenchProject> | null;
  readonly jiraOAuthCode: string | undefined;
  readonly jiraOAuthState: string | undefined;
  readonly jiraOAuthError: string | undefined;
  readonly jiraDialogOpen: boolean;
  readonly setSelectedProjectId: (id: WorkbenchProjectId) => void;
  readonly setJiraDialogOpen: (open: boolean) => void;
  readonly setJiraError: (message: string | null) => void;
  readonly setJiraPendingAction: (action: string | null) => void;
  readonly refreshJiraSnapshot: () => unknown;
  readonly navigate: NavigateFn;
}) {
  const jiraBeginAuth = useAtomCommand(workbenchEnvironment.jiraBeginAuth, {
    reportFailure: false,
  });
  const jiraCompleteAuth = useAtomCommand(workbenchEnvironment.jiraCompleteAuth, {
    reportFailure: false,
  });
  const jiraClaimAuth = useAtomCommand(workbenchEnvironment.jiraClaimAuth, {
    reportFailure: false,
  });
  const [jiraBrokerAuth, setJiraBrokerAuth] = useState<JiraBrokerAuthState | null>(
    readPendingJiraBrokerAuth,
  );
  const handledJiraOAuthCallbackRef = useRef<string | null>(null);
  const resolveJiraOAuthRedirectUri = useCallback(() => {
    if (isElectron && environmentHttpBaseUrl === null) return null;
    return jiraOAuthRedirectUri({
      // Web callbacks use the browser origin. Desktop requires the selected
      // environment's server URL; never redirect a secondary environment to
      // the primary server by fallback.
      serverHttpUrl: environmentHttpBaseUrl ?? window.location.origin,
    });
  }, [environmentHttpBaseUrl]);
  const beginJiraAuthFlow = async () => {
    if (environmentId === null) return;
    const redirectUri = resolveJiraOAuthRedirectUri();
    if (redirectUri === null) {
      setJiraError("The selected environment URL is unavailable. Reconnect it and try again.");
      return;
    }
    // Open the broker window during the click gesture. The authorization RPC is
    // asynchronous, so opening it after the response can be blocked by browsers.
    const brokerWindow = isElectron ? null : window.open("about:blank", "_blank");
    if (brokerWindow !== null) brokerWindow.opener = null;
    setJiraBrokerAuth(null);
    try {
      sessionStorage.removeItem(JIRA_OAUTH_STATE_STORAGE_KEY);
    } catch {
      // The in-memory state is authoritative for this tab.
    }
    setJiraPendingAction("authorize");
    setJiraError(null);
    const result = await jiraBeginAuth({
      environmentId,
      input: { redirectUri },
    });
    setJiraPendingAction(null);
    if (reportWorkbenchCommandFailure(result, setJiraError)) {
      brokerWindow?.close();
      return;
    }
    if (result.value.mode === "broker") {
      const brokerAuth = {
        environmentId,
        state: result.value.state,
        expiresAt: result.value.expiresAt,
      } satisfies JiraBrokerAuthState;
      writePendingJiraBrokerAuth(brokerAuth);
      setJiraBrokerAuth(brokerAuth);
    }
    await launchJiraAuthorization({
      authorizationUrl: result.value.authorizationUrl,
      environmentId,
      selectedProjectId,
      broker: result.value.mode === "broker",
      brokerWindow,
      setError: setJiraError,
    });
  };

  useEffect(() => {
    if (!isElectron || !jiraDialogOpen) return;
    const refresh = () => refreshJiraSnapshot();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [jiraDialogOpen, refreshJiraSnapshot]);

  useEffect(() => {
    if (jiraBrokerAuth === null || environmentId === null) return;
    if (jiraBrokerAuth.environmentId !== environmentId) {
      // A pending state is bound to the server that created it; discard it when
      // the selected environment changes so it cannot be claimed elsewhere.
      // oxlint-disable-next-line react/set-state-in-effect
      setJiraBrokerAuth(null);
      sessionStorage.removeItem(JIRA_OAUTH_STATE_STORAGE_KEY);
      setJiraPendingAction(null);
      return;
    }
    let stopped = false;
    let inFlight = false;
    const clearBrokerAuth = () => {
      setJiraBrokerAuth(null);
      sessionStorage.removeItem(JIRA_OAUTH_STATE_STORAGE_KEY);
      setJiraPendingAction(null);
    };
    const poll = async () => {
      if (stopped || inFlight) return;
      const expiresAt = Date.parse(jiraBrokerAuth.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        clearBrokerAuth();
        setJiraError("Jira authorization expired. Connect Jira again.");
        return;
      }
      inFlight = true;
      setJiraPendingAction("complete-auth");
      try {
        const result = await jiraClaimAuth({
          environmentId: jiraBrokerAuth.environmentId,
          input: { state: jiraBrokerAuth.state },
        });
        if (stopped) return;
        if (reportWorkbenchCommandFailure(result, setJiraError)) {
          clearBrokerAuth();
          return;
        }
        if (result.value.status === "pending") return;
        clearBrokerAuth();
        if (result.value.status === "failed") {
          setJiraError(result.value.error);
          return;
        }
        setJiraError(null);
        setJiraDialogOpen(true);
        await refreshJiraSnapshot();
      } catch (error) {
        if (stopped) return;
        clearBrokerAuth();
        setJiraError(
          error instanceof Error ? error.message : "Jira authorization could not be completed.",
        );
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 1_500);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [
    environmentId,
    jiraBrokerAuth,
    jiraClaimAuth,
    refreshJiraSnapshot,
    setJiraDialogOpen,
    setJiraError,
    setJiraPendingAction,
  ]);

  const completeAuthorization = useCallback(
    async ({
      environmentId,
      callback,
    }: {
      environmentId: EnvironmentId;
      callback: NonNullable<ReturnType<typeof resolveWorkbenchJiraOAuthCallback>>;
    }) => {
      setJiraPendingAction("complete-auth");
      setJiraError(null);
      try {
        if ("error" in callback) {
          setJiraError(callback.error);
          return false;
        }
        const redirectUri = resolveJiraOAuthRedirectUri();
        if (redirectUri === null) {
          setJiraError("The selected environment URL is unavailable. Reconnect it and try again.");
          return false;
        }
        const result = await jiraCompleteAuth({
          environmentId,
          input: {
            code: callback.code,
            state: callback.state,
            redirectUri,
          },
        });
        return !reportWorkbenchCommandFailure(result, setJiraError);
      } finally {
        setJiraPendingAction(null);
      }
    },
    [jiraCompleteAuth, resolveJiraOAuthRedirectUri, setJiraError, setJiraPendingAction],
  );

  useEffect(() => {
    const callback = resolveWorkbenchJiraOAuthCallback({
      code: jiraOAuthCode,
      state: jiraOAuthState,
      error: jiraOAuthError,
    });
    if (callback === null) return;
    if (environmentId === null) return;
    if (snapshotProjects === null) return;
    const callbackKey = `${jiraOAuthCode ?? ""}:${jiraOAuthState ?? ""}:${jiraOAuthError ?? ""}`;
    if (handledJiraOAuthCallbackRef.current === callbackKey) return;
    handledJiraOAuthCallbackRef.current = callbackKey;

    void (async () => {
      const succeeded = await completeAuthorization({ environmentId, callback });

      const storedProjectId = sessionStorage.getItem(JIRA_OAUTH_WORKSPACE_STORAGE_KEY);
      const storedEnvironmentId = readPendingJiraEnvironmentId();
      sessionStorage.removeItem(JIRA_OAUTH_WORKSPACE_STORAGE_KEY);
      sessionStorage.removeItem(JIRA_OAUTH_ENVIRONMENT_STORAGE_KEY);
      const callbackProject = snapshotProjects.find((project) => project.id === storedProjectId);
      if (callbackProject) setSelectedProjectId(callbackProject.id);
      await navigate({
        to: "/workbench",
        search: (previous: WorkbenchSearch) =>
          resolveJiraOAuthReturnSearch({
            previous,
            environmentId,
            storedEnvironmentId,
            projectId: callbackProject?.id,
          }),
        replace: true,
      });
      if (succeeded || callbackProject) setJiraDialogOpen(true);
    })();
  }, [
    environmentId,
    completeAuthorization,
    jiraOAuthCode,
    jiraOAuthError,
    jiraOAuthState,
    navigate,
    snapshotProjects,
    setJiraDialogOpen,
    setSelectedProjectId,
  ]);

  return { beginJiraAuthFlow };
}
