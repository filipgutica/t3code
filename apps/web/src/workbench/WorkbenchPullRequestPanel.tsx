import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { RightPanelResizeHandle } from "../components/preview/RightPanelResizeHandle";
import { PullRequestDetailPanel } from "../components/pullRequest/PullRequestDetailPanel";
import { Sheet, SheetPopup, SheetTitle } from "../components/ui/sheet";
import { useResizableWidth } from "../hooks/useResizableWidth";
import { RIGHT_PANEL_SHEET_CLASS_NAME } from "../rightPanelLayout";

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
        className={RIGHT_PANEL_SHEET_CLASS_NAME}
        style={{ width, maxWidth, minWidth: 0 }}
        showCloseButton={false}
        transitionDurationMs={0}
      >
        <SheetTitle className="sr-only">Pull request details</SheetTitle>
        <RightPanelResizeHandle handlers={handlers} />
        <PullRequestDetailPanel
          environmentId={environmentId}
          reference={reference}
          onClose={onClose}
          onSelectPullRequest={onSelectPullRequest}
        />
      </SheetPopup>
    </Sheet>
  );
}
