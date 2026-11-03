import { lazy, Suspense, type ReactNode } from "react";

import { SidebarChromeHeader } from "../components/sidebar/SidebarChrome";
import { shouldShowWorkbenchSidebar } from "./workbenchNavigation";

const WorkbenchSidebar = lazy(() =>
  import("./WorkbenchSidebar").then((module) => ({ default: module.WorkbenchSidebar })),
);

export function WorkbenchSidebarSlot({
  pathname,
  isElectron,
  children,
}: {
  pathname: string;
  isElectron: boolean;
  children: ReactNode;
}) {
  if (!shouldShowWorkbenchSidebar(pathname)) return children;

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <Suspense fallback={null}>
        <WorkbenchSidebar />
      </Suspense>
    </>
  );
}
