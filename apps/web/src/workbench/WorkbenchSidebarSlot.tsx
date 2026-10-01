import { lazy, Suspense, type ReactNode } from "react";

import { SidebarChromeHeader } from "../components/sidebar/SidebarChrome";
import { useWorkbenchSidebar } from "./useWorkbenchSidebar";

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
  const { isOnWorkbench, context } = useWorkbenchSidebar(pathname);
  if (!isOnWorkbench) return children;

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <Suspense fallback={null}>
        <WorkbenchSidebar context={context} />
      </Suspense>
    </>
  );
}
