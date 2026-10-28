import {
  useNavigate,
  type AnyRouter,
  type ParsedLocation,
  type RouterHistory,
} from "@tanstack/react-router";

import { useEnvironments } from "../state/environments";
import type { WorkbenchSearch } from "./workbenchSearch";

let lastWorkbenchLocation: ParsedLocation<Record<string, unknown>> | null = null;
let lastBoardLocation: ParsedLocation<Record<string, unknown>> | null = null;

/** Remembers the last Board or Workbench Thread so generic Workbench entries return to it. */
export function startWorkbenchLocationTracking(router: AnyRouter): () => void {
  const history: RouterHistory = router.history;
  let previousHref = router.parseLocation(history.location).href;
  let rememberedThreadHref: string | null = null;
  const record = () => {
    const { pathname, search, href, hash } = router.state.location;
    if (pathname !== "/workbench" && search.workbench !== true) return;
    lastWorkbenchLocation = router.buildLocation({
      to: pathname,
      search: { ...search, create: undefined },
      hash,
    });
    if (pathname === "/workbench") lastBoardLocation = lastWorkbenchLocation;
    rememberedThreadHref = pathname === "/workbench" ? null : href;
  };
  record();
  const unsubscribe = router.subscribe("onResolved", record);
  const unsubscribeHistory = history.subscribe(({ location, action }) => {
    const fromHref = previousHref;
    const next = router.parseLocation(location);
    previousHref = next.href;
    if (
      action.type === "REPLACE" &&
      fromHref === rememberedThreadHref &&
      next.pathname !== "/workbench" &&
      next.search.workbench !== true
    ) {
      lastWorkbenchLocation = lastBoardLocation;
      rememberedThreadHref = null;
    }
  });
  return () => {
    unsubscribe();
    unsubscribeHistory();
    lastWorkbenchLocation = null;
    lastBoardLocation = null;
  };
}

/** Opens the last Workbench location, or `fallback` on the first visit. */
export function useNavigateToLastWorkbench() {
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  return (fallback: WorkbenchSearch = {}) => {
    const location = lastWorkbenchLocation;
    const environmentId =
      location?.pathname === "/workbench"
        ? location.search.environmentId
        : location?.pathname.split("/")[1];
    const unavailable =
      environmentId !== undefined &&
      !environments.some(
        (environment) =>
          environment.environmentId === environmentId &&
          environment.connection.phase === "connected",
      );
    return location === null || unavailable
      ? navigate({ to: "/workbench", search: fallback })
      : navigate({ href: location.href });
  };
}
