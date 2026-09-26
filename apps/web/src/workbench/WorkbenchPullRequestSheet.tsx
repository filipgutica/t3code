import "./workbenchPullRequestSheet.css";

import { useNavigate, useParams } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Button } from "../components/ui/button";
import { resolveThreadRouteRef } from "../threadRoutes";

import { PullRequestDetailPanel } from "../components/pullRequest/PullRequestDetailPanel";
import { Sheet, SheetPopup, SheetTitle } from "../components/ui/sheet";
import { isElectron } from "../env";
import { isTerminalFocused } from "../lib/terminalFocus";
import { usePanelAnimationSettings } from "../panelAnimations";
import type { WorkbenchPullRequestSelection } from "./WorkbenchPullRequestPreview";

const getShortcutContext = () => ({
  terminalFocus: isTerminalFocused(),
  terminalOpen: false,
  previewFocus: false,
  previewOpen: false,
  modelPickerOpen: false,
  isWeb: !isElectron,
  isDesktop: isElectron,
});

export function WorkbenchPullRequestSheet({
  selection,
  onSelect,
  onClose,
}: {
  selection: WorkbenchPullRequestSelection;
  onSelect: (selection: WorkbenchPullRequestSelection) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const routeThread = useParams({ strict: false, select: resolveThreadRouteRef });
  const linkedThread = selection.linkedThread;
  const isLinkedThreadOpen =
    linkedThread !== undefined &&
    routeThread?.environmentId === selection.environmentId &&
    routeThread.threadId === linkedThread.threadId;
  const threadRef = isLinkedThreadOpen
    ? scopeThreadRef(selection.environmentId, linkedThread.threadId)
    : null;
  const { active, durationMs } = usePanelAnimationSettings();
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetPopup
        side="right"
        data-workbench-pull-request-preview=""
        showCloseButton={false}
        transitionDurationMs={active ? durationMs : 0}
        className="w-[min(88vw,48rem)] max-w-none wco:mt-[env(titlebar-area-height)] wco:h-[calc(100%-env(titlebar-area-height))] wco:max-h-[calc(100%-env(titlebar-area-height))]"
      >
        <SheetTitle className="sr-only">Pull request #{selection.reference.number}</SheetTitle>
        {linkedThread && !isLinkedThreadOpen ? (
          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                onClose();
                if (linkedThread.onOpen) linkedThread.onOpen();
                else
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: {
                      environmentId: selection.environmentId,
                      threadId: linkedThread.threadId,
                    },
                    search: { workbench: true },
                  });
              }}
            >
              Open linked thread
            </Button>
            <span className="truncate text-xs text-muted-foreground">{linkedThread.title}</span>
          </div>
        ) : null}
        <PullRequestDetailPanel
          key={`${selection.environmentId}:${selection.reference.host}:${selection.reference.repository}:${selection.reference.number}`}
          environmentId={selection.environmentId}
          reference={selection.reference}
          context={isLinkedThreadOpen ? "thread" : "page"}
          threadRef={threadRef}
          {...(threadRef ? { composerDraftTarget: threadRef } : {})}
          shortcutsEnabled
          getShortcutContext={getShortcutContext}
          onClose={onClose}
          onSelectPullRequest={(reference) =>
            onSelect({ environmentId: selection.environmentId, reference })
          }
        />
      </SheetPopup>
    </Sheet>
  );
}
