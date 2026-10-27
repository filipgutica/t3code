import { useNavigate, type AnyRouter } from "@tanstack/react-router";

import type { WorkbenchSearch } from "./workbenchSearch";

let lastWorkbenchHref: string | null = null;

/** Remembers the last Board or Workbench Thread so generic Workbench entries return to it. */
export function startWorkbenchLocationTracking(router: AnyRouter): () => void {
  const record = () => {
    const { pathname, search, href } = router.state.location;
    if (pathname === "/workbench" || search.workbench === true) lastWorkbenchHref = href;
  };
  record();
  const unsubscribe = router.subscribe("onResolved", record);
  return () => {
    unsubscribe();
    lastWorkbenchHref = null;
  };
}

/** Opens the last Workbench location, or `fallback` on the first visit. */
export function useNavigateToLastWorkbench() {
  const navigate = useNavigate();
  return (fallback: WorkbenchSearch = {}) =>
    lastWorkbenchHref === null
      ? navigate({ to: "/workbench", search: fallback })
      : navigate({ href: lastWorkbenchHref });
}
