import { WorkbenchProjectId, WorkbenchTicketId } from "@t3tools/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { SidebarInset } from "../components/ui/sidebar";
import { WorkbenchPage } from "../workbench/WorkbenchPage";

const isWorkbenchProjectId = Schema.is(WorkbenchProjectId);
const isWorkbenchTicketId = Schema.is(WorkbenchTicketId);

// Exported because TanStack's generated route declaration names this type.
// fallow-ignore-next-line unused-type
export interface WorkbenchSearch {
  readonly projectId?: WorkbenchProjectId;
  readonly ticketId?: WorkbenchTicketId;
  readonly create?: "workspace";
  readonly code?: string;
  readonly state?: string;
}

function WorkbenchRoute() {
  const search = Route.useSearch();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <WorkbenchPage
        createWorkspace={search.create === "workspace"}
        initialProjectId={search.projectId}
        initialTicketId={search.ticketId}
        jiraOAuthCode={search.code}
        jiraOAuthState={search.state}
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/workbench")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  validateSearch: (raw: Record<string, unknown>): WorkbenchSearch => ({
    ...(isWorkbenchProjectId(raw.projectId) ? { projectId: raw.projectId } : {}),
    ...(isWorkbenchTicketId(raw.ticketId) ? { ticketId: raw.ticketId } : {}),
    ...(raw.create === "workspace" ? { create: "workspace" as const } : {}),
    ...(typeof raw.code === "string" && raw.code.trim().length > 0 ? { code: raw.code } : {}),
    ...(typeof raw.state === "string" && raw.state.trim().length > 0 ? { state: raw.state } : {}),
  }),
  component: WorkbenchRoute,
});
