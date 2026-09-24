import { useParams, useSearch } from "@tanstack/react-router";

import { useEnvironmentQuery } from "../state/query";
import { resolveThreadRouteRef } from "../threadRoutes";
import { workbenchEnvironment } from "./state";
import { getWorkbenchContextForThread } from "./workbench.logic";
import { shouldShowWorkbenchSidebar } from "./workbenchNavigation";

export function useWorkbenchSidebar(pathname: string) {
  const search = useSearch({ strict: false });
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const snapshot = useEnvironmentQuery(
    routeThreadRef === null || search.workbench !== true
      ? null
      : workbenchEnvironment.snapshot({ environmentId: routeThreadRef.environmentId, input: {} }),
  ).data;
  const threadContext =
    routeThreadRef === null
      ? null
      : getWorkbenchContextForThread(snapshot, routeThreadRef.threadId);
  const context =
    routeThreadRef && threadContext
      ? {
          environmentId: routeThreadRef.environmentId,
          threadId: routeThreadRef.threadId,
          workspaceId: threadContext.workspace.id,
          ticketId: threadContext.ticket.id,
        }
      : undefined;

  return {
    isOnWorkbench: shouldShowWorkbenchSidebar({
      pathname,
      search,
      hasTicketContext: context !== undefined,
    }),
    context,
  };
}
