import type { AnyRouter } from "@tanstack/react-router";

let lastWorkbenchHref: string | null = null;

/** Remembers the last Board or Workbench Thread so the sidebar entry can return to it. */
export function startWorkbenchLocationTracking(router: AnyRouter): () => void {
  const record = () => {
    const { pathname, search, href } = router.state.location;
    if (pathname === "/workbench" || search.workbench === true) lastWorkbenchHref = href;
  };
  record();
  return router.subscribe("onResolved", record);
}

export const readLastWorkbenchHref = () => lastWorkbenchHref;
