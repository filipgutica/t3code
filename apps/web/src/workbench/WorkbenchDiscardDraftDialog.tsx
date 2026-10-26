import type { ComponentProps } from "react";
import { Trash2Icon } from "lucide-react";

import { Button } from "../components/ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { WorkbenchInlineError } from "./WorkbenchForms";

export function WorkbenchDiscardDraftDialog({
  title,
  count = 1,
  finalFocus,
  open,
  busy,
  error,
  onOpenChange,
  onDiscard,
}: {
  readonly title?: string;
  readonly count?: number;
  readonly finalFocus?: ComponentProps<typeof AlertDialogPopup>["finalFocus"];
  readonly open: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDiscard: () => Promise<boolean>;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <AlertDialogPopup finalFocus={finalFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {count > 1
              ? `Discard ${count} drafts?`
              : title
                ? `Discard “${title}”?`
                : "Discard this ticket draft?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {count > 1
              ? "The selected drafts and their planning conversations are deleted. Tickets you already created are not affected."
              : "The planning conversation and its draft are deleted. Tickets you already created are not affected."}
          </AlertDialogDescription>
          <WorkbenchInlineError message={error} />
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" disabled={busy} />}>
            {count > 1 ? "Keep drafts" : "Keep draft"}
          </AlertDialogClose>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              void onDiscard().then((discarded) => {
                if (discarded) onOpenChange(false);
              });
            }}
          >
            <Trash2Icon />{" "}
            {busy ? "Discarding…" : count > 1 ? `Discard ${count} drafts` : "Discard draft"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
