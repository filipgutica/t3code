import { redirect } from "@tanstack/react-router";
import {
  EnvironmentId,
  WorkbenchEpicId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isWorkbenchProjectId = Schema.is(WorkbenchProjectId);
const isWorkbenchTicketId = Schema.is(WorkbenchTicketId);
const isWorkbenchEpicId = Schema.is(WorkbenchEpicId);
const isEnvironmentId = Schema.is(EnvironmentId);

export interface WorkbenchSearch {
  readonly environmentId?: EnvironmentId;
  readonly workbenchProjectId?: WorkbenchProjectId;
  readonly ticketId?: WorkbenchTicketId;
  readonly epicId?: WorkbenchEpicId;
  readonly create?: "workspace";
  readonly jiraOAuthCode?: string;
  readonly jiraOAuthState?: string;
  readonly jiraOAuthError?: string;
}

export const parseWorkbenchSearch = (raw: Record<string, unknown>): WorkbenchSearch => {
  // Accept existing links and the standard Jira callback keys only at this boundary.
  const projectId = raw.workbenchProjectId ?? raw.projectId;
  const code = raw.jiraOAuthCode ?? raw.code;
  const state = raw.jiraOAuthState ?? raw.state;
  const error = raw.jiraOAuthError ?? raw.error;
  const ticketId = isWorkbenchTicketId(raw.ticketId) ? raw.ticketId : undefined;
  return {
    ...(isEnvironmentId(raw.environmentId) ? { environmentId: raw.environmentId } : {}),
    ...(isWorkbenchProjectId(projectId) ? { workbenchProjectId: projectId } : {}),
    ...(ticketId ? { ticketId } : isWorkbenchEpicId(raw.epicId) ? { epicId: raw.epicId } : {}),
    ...(raw.create === "workspace" ? { create: "workspace" as const } : {}),
    ...(typeof code === "string" && code.trim().length > 0 ? { jiraOAuthCode: code } : {}),
    ...(typeof state === "string" && state.trim().length > 0 ? { jiraOAuthState: state } : {}),
    ...(typeof error === "string" && error.trim().length > 0 ? { jiraOAuthError: error } : {}),
  };
};

export const redirectLegacyWorkbenchSearch = (search: Record<string, unknown>) => {
  if (["projectId", "code", "state", "error"].some((key) => key in search)) {
    throw redirect({ to: "/workbench", search: parseWorkbenchSearch(search), replace: true });
  }
};
