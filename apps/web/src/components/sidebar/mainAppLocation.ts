import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { useHostIntegrations, type HostIntegrations } from "~/hostIntegrations";

// Utility pages replace the sidebar utility row with a Back button. Legacy
// `/projects/<key>` links redirect into settings, so they count too and are never
// remembered as the main app location.
export function isSidebarUtilityPage(pathname: string, integrations?: HostIntegrations) {
  return (
    integrations?.isSidebarUtilityPage?.(pathname) === true ||
    pathname === "/settings" ||
    pathname.startsWith("/settings/") ||
    pathname.startsWith("/projects/") ||
    pathname === "/usage" ||
    pathname === "/pull-requests"
  );
}

let mainAppHref: string | null = null;

// Mount once in the app shell. Records the latest main app URL so Back can
// return there no matter how many utility pages were visited since.
export function MainAppLocationTracker() {
  const integrations = useHostIntegrations();
  const href = useLocation({
    select: (location) =>
      isSidebarUtilityPage(location.pathname, integrations) ? null : location.href,
  });
  useEffect(() => {
    if (href !== null) mainAppHref = href;
  }, [href]);
  return null;
}

// Leaves a utility page for the last main app URL, or the thread list when
// the app was opened directly on a utility page.
export function useNavigateToMainApp() {
  const navigate = useNavigate();
  return useCallback(() => navigate({ href: mainAppHref ?? "/" }), [navigate]);
}
