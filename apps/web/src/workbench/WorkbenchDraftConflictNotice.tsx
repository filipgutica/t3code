import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import type { WorkbenchConversationDraft } from "./workbenchTicketDraft.logic";

export function DraftConflictNotice({
  onReload,
  onKeepMine,
  canKeepMine,
  fields,
}: {
  readonly onReload: () => void;
  readonly onKeepMine: () => void;
  readonly canKeepMine: boolean;
  readonly fields: WorkbenchConversationDraft["fields"];
}) {
  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-warning/40 bg-warning/8 p-3 text-sm text-warning-foreground"
    >
      <p>
        {canKeepMine
          ? "This draft was changed elsewhere, and you have edits that are not saved. Choose which version to continue with."
          : "Ticket creation started elsewhere, so this draft can no longer accept edits. Copy your edits before reloading; once creation finishes, you can apply them through Ticket details."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="xs" variant="outline" onClick={onReload}>
          Reload saved draft
        </Button>
        {canKeepMine ? (
          <Button size="xs" onClick={onKeepMine}>
            Keep my edits
          </Button>
        ) : (
          <Button
            size="xs"
            onClick={() => {
              void writeTextToClipboard(JSON.stringify(fields, null, 2)).then(
                () => toastManager.add({ type: "success", title: "Draft edits copied" }),
                () => toastManager.add({ type: "error", title: "Could not copy draft edits" }),
              );
            }}
          >
            Copy my edits
          </Button>
        )}
      </div>
    </div>
  );
}
