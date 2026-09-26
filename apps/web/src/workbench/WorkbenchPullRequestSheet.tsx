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
        showCloseButton={false}
        transitionDurationMs={active ? durationMs : 0}
        className="w-[min(88vw,48rem)] max-w-none wco:mt-[env(titlebar-area-height)] wco:h-[calc(100%-env(titlebar-area-height))] wco:max-h-[calc(100%-env(titlebar-area-height))]"
      >
        <SheetTitle className="sr-only">Pull request #{selection.reference.number}</SheetTitle>
        <PullRequestDetailPanel
          key={`${selection.environmentId}:${selection.reference.host}:${selection.reference.repository}:${selection.reference.number}`}
          environmentId={selection.environmentId}
          reference={selection.reference}
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
