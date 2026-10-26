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
  readonly create?: "workspace" | "ticket";
}

export const parseWorkbenchSearch = (raw: Record<string, unknown>): WorkbenchSearch => {
  // Accept existing links that use the legacy `projectId` key only at this boundary.
  const projectId = raw.workbenchProjectId ?? raw.projectId;
  const ticketId = isWorkbenchTicketId(raw.ticketId) ? raw.ticketId : undefined;
  return {
    ...(isEnvironmentId(raw.environmentId) ? { environmentId: raw.environmentId } : {}),
    ...(isWorkbenchProjectId(projectId) ? { workbenchProjectId: projectId } : {}),
    ...(ticketId ? { ticketId } : isWorkbenchEpicId(raw.epicId) ? { epicId: raw.epicId } : {}),
    ...(raw.create === "workspace" || raw.create === "ticket" ? { create: raw.create } : {}),
  };
};

export const redirectLegacyWorkbenchSearch = (search: Record<string, unknown>) => {
  if ("projectId" in search) {
    throw redirect({ to: "/workbench", search: parseWorkbenchSearch(search), replace: true });
  }
};
