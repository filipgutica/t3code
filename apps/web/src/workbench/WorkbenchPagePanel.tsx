import type { ScopedThreadRef } from "@t3tools/contracts";
import { createContext, useContext, useState, type ReactNode } from "react";

import { cn } from "../lib/utils";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";

const WorkbenchPanelHostContext = createContext<HTMLElement | null>(null);

/** The page element the floating chat's embedded Thread renders its right panel into. */
export const useWorkbenchPanelHost = () => useContext(WorkbenchPanelHostContext);

export function useWorkbenchThreadPanel(threadRef: ScopedThreadRef | null) {
  const open = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).isOpen,
  );
  const maximized = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).maximized === true,
  );
  return { open, maximized: open && maximized };
}

/**
 * The page column beside the full-height panel host, as on the native PR page, so the panel
 * owns its desktop title-bar strip. A maximized panel covers the page; the column stays above
 * it, invisible and click-through, so only the floating chat shows over the panel.
 */
export function WorkbenchPageRow({ children }: { readonly children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const shownThread = useWorkbenchFloatingChatStore((state) => state.shownThread);
  const { maximized } = useWorkbenchThreadPanel(shownThread);
  return (
    <div className="relative flex min-h-0 flex-1" data-workbench-page="">
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          maximized && "pointer-events-none invisible relative z-10",
        )}
      >
        <WorkbenchPanelHostContext value={host}>{children}</WorkbenchPanelHostContext>
      </div>
      <div
        ref={setHost}
        data-workbench-panel-host=""
        className={cn("isolate flex min-h-0 shrink-0", maximized && "absolute inset-0")}
      />
    </div>
  );
}
