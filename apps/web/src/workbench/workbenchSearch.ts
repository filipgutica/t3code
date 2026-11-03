import { redirect } from "@tanstack/react-router";
import { EnvironmentId, WorkbenchProjectId, WorkbenchTicketId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isWorkbenchProjectId = Schema.is(WorkbenchProjectId);
const isWorkbenchTicketId = Schema.is(WorkbenchTicketId);
const isEnvironmentId = Schema.is(EnvironmentId);

export interface WorkbenchSearch {
  readonly environmentId?: EnvironmentId;
  readonly workbenchProjectId?: WorkbenchProjectId;
  readonly ticketId?: WorkbenchTicketId;
  readonly create?: "workspace" | "ticket";
}

export const parseWorkbenchSearch = (raw: Record<string, unknown>): WorkbenchSearch => {
  // Accept existing links that use the legacy `projectId` key only at this boundary.
  const projectId = raw.workbenchProjectId ?? raw.projectId;
  return {
    ...(isEnvironmentId(raw.environmentId) ? { environmentId: raw.environmentId } : {}),
    ...(isWorkbenchProjectId(projectId) ? { workbenchProjectId: projectId } : {}),
    ...(isWorkbenchTicketId(raw.ticketId) ? { ticketId: raw.ticketId } : {}),
    ...(raw.create === "workspace" || raw.create === "ticket" ? { create: raw.create } : {}),
  };
};

export const redirectLegacyWorkbenchSearch = (search: Record<string, unknown>) => {
  if ("projectId" in search) {
    throw redirect({ to: "/workbench", search: parseWorkbenchSearch(search), replace: true });
  }
};
