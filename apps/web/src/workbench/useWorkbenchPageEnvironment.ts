import type { EnvironmentId } from "@t3tools/contracts";
import { useEnvironmentHttpBaseUrl, usePrimaryEnvironmentId } from "../state/environments";
import { readPendingJiraEnvironmentId } from "./useWorkbenchJiraAuthorization";
export function useWorkbenchPageEnvironment({
  initialEnvironmentId,
  jiraOAuthCode,
  jiraOAuthState,
  jiraOAuthError,
}: {
  initialEnvironmentId: EnvironmentId | undefined;
  jiraOAuthCode: string | undefined;
  jiraOAuthState: string | undefined;
  jiraOAuthError: string | undefined;
}) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const hasJiraOAuthCallback =
    jiraOAuthCode !== undefined || jiraOAuthState !== undefined || jiraOAuthError !== undefined;
  const environmentId =
    initialEnvironmentId ??
    (hasJiraOAuthCallback ? readPendingJiraEnvironmentId() : null) ??
    primaryEnvironmentId;
  const environmentHttpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  return { environmentId, environmentHttpBaseUrl };
}
