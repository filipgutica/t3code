import { useLocation, useNavigate } from "@tanstack/react-router";
import { useHostIntegrations, type HostIntegrations } from "~/hostIntegrations";
import { useEffect } from "react";

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

export function useNavigateToMainApp() {
  const navigate = useNavigate();
  return () => navigate({ href: mainAppHref ?? "/" });
}
