import type { ScopedThreadRef } from "@t3tools/contracts";
import { createContext, useContext, useState, type ReactNode } from "react";

import { cn } from "../lib/utils";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";

/** Page elements the floating chat's embedded Thread renders its panel, terminal, and toggles into. */
export interface WorkbenchPageHosts {
  readonly panelHost: HTMLElement | null;
  readonly terminalHost: HTMLElement | null;
  readonly controlsHost: HTMLElement | null;
}

const WorkbenchPageHostsContext = createContext<WorkbenchPageHosts>({
  panelHost: null,
  terminalHost: null,
  controlsHost: null,
});
const WorkbenchControlsHostContext = createContext<(element: HTMLElement | null) => void>(() => {});

export const useWorkbenchPageHosts = () => useContext(WorkbenchPageHostsContext);

/** A ref for the page header element that shows the open Thread's terminal and panel toggles. */
export const useWorkbenchControlsHostRef = () => useContext(WorkbenchControlsHostContext);

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
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);
  const [terminalHost, setTerminalHost] = useState<HTMLElement | null>(null);
  const [controlsHost, setControlsHost] = useState<HTMLElement | null>(null);
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
        <WorkbenchControlsHostContext value={setControlsHost}>
          {/* The terminal opens only where the page shows its toggle. */}
          <WorkbenchPageHostsContext
            value={{
              panelHost,
              terminalHost: controlsHost === null ? null : terminalHost,
              controlsHost,
            }}
          >
            {children}
          </WorkbenchPageHostsContext>
        </WorkbenchControlsHostContext>
        <div ref={setTerminalHost} data-workbench-terminal-host="" className="contents" />
      </div>
      <div
        ref={setPanelHost}
        data-workbench-panel-host=""
        className={cn("isolate flex min-h-0 shrink-0", maximized && "absolute inset-0")}
      />
    </div>
  );
}
