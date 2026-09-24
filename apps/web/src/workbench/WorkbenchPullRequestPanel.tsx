import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { RightPanelResizeHandle } from "../components/preview/RightPanelResizeHandle";
import { PullRequestDetailPanel } from "../components/pullRequest/PullRequestDetailPanel";
import { Sheet, SheetPopup, SheetTitle } from "../components/ui/sheet";
import { useResizableWidth } from "../hooks/useResizableWidth";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isElectron } from "../env";
import type { ShortcutMatchContext } from "../keybindings";

function getShortcutContext(): ShortcutMatchContext {
  return {
    terminalFocus: isTerminalFocused(),
    isWeb: !isElectron,
    isDesktop: isElectron,
    terminalOpen: false,
    previewFocus: false,
    previewOpen: false,
    modelPickerOpen: false,
  };
}

export function WorkbenchPullRequestPanel({
  environmentId,
  reference,
  onClose,
  onSelectPullRequest,
}: {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly onClose: () => void;
  readonly onSelectPullRequest: (reference: PullRequestRef) => void;
}) {
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const updateWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);
  const maxWidth = Math.max(1, viewportWidth - 32);
  const { width, handlers } = useResizableWidth({
    storageKey: "t3code:workbench-pull-request-panel-width",
    defaultWidth: 448,
    minWidth: Math.min(320, maxWidth),
    maxWidth,
    edge: "left",
  });

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetPopup
        data-workbench-pull-request-panel=""
        className="w-[min(42vw,28rem)] min-w-80 max-w-[28rem] max-[760px]:w-[min(88vw,24rem)] max-[760px]:min-w-0 wco:mt-[env(titlebar-area-height)] wco:h-[calc(100%-env(titlebar-area-height))] wco:max-h-[calc(100%-env(titlebar-area-height))]"
        style={{ width, maxWidth, minWidth: 0 }}
        showCloseButton={false}
        transitionDurationMs={0}
      >
        <SheetTitle className="sr-only">Pull request details</SheetTitle>
        <RightPanelResizeHandle handlers={handlers} />
        <PullRequestDetailPanel
          environmentId={environmentId}
          reference={reference}
          shortcutsEnabled
          getShortcutContext={getShortcutContext}
          onClose={onClose}
          onSelectPullRequest={onSelectPullRequest}
        />
      </SheetPopup>
    </Sheet>
  );
}
