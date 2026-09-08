import { createFileRoute, redirect } from "@tanstack/react-router";
import { parseWorkbenchSearch, redirectLegacyWorkbenchSearch } from "../workbench/workbenchSearch";

import { SidebarInset } from "../components/ui/sidebar";
import { WorkbenchPage } from "../workbench/WorkbenchPage";

function WorkbenchRoute() {
  const search = Route.useSearch();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <WorkbenchPage
        initialEnvironmentId={search.environmentId}
        createWorkspace={search.create === "workspace"}
        initialProjectId={search.workbenchProjectId}
        initialTicketId={search.ticketId}
        initialEpicId={search.epicId}
        jiraOAuthCode={search.jiraOAuthCode}
        jiraOAuthState={search.jiraOAuthState}
        jiraOAuthError={search.jiraOAuthError}
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/workbench")({
  beforeLoad: async ({ context, location }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
    redirectLegacyWorkbenchSearch(location.search);
  },
  validateSearch: parseWorkbenchSearch,
  component: WorkbenchRoute,
});
