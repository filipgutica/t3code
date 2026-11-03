import { useNavigate, type AnyRouter, type ParsedLocation } from "@tanstack/react-router";

import { useEnvironments } from "../state/environments";
import type { WorkbenchSearch } from "./workbenchSearch";

let lastWorkbenchLocation: ParsedLocation<Record<string, unknown>> | null = null;

/** Remembers the last Board location so generic Workbench entries return to it. */
export function startWorkbenchLocationTracking(router: AnyRouter): () => void {
  const record = () => {
    const { pathname, search, hash } = router.state.location;
    if (pathname !== "/workbench") return;
    lastWorkbenchLocation = router.buildLocation({
      to: pathname,
      search: { ...search, create: undefined },
      hash,
    });
  };
  record();
  const unsubscribe = router.subscribe("onResolved", record);
  return () => {
    unsubscribe();
    lastWorkbenchLocation = null;
  };
}

/** Opens the last Workbench location, or `fallback` on the first visit. */
export function useNavigateToLastWorkbench() {
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  return (fallback: WorkbenchSearch = {}) => {
    const location = lastWorkbenchLocation;
    const environmentId = location?.search.environmentId;
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
