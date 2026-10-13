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
  finalFocus,
  open,
  busy,
  creationUncertain,
  error,
  onOpenChange,
  onDiscard,
}: {
  readonly title?: string;
  readonly finalFocus?: ComponentProps<typeof AlertDialogPopup>["finalFocus"];
  readonly open: boolean;
  readonly busy: boolean;
  /** The draft is mid Create ticket, so a Jira issue may already exist for it. */
  readonly creationUncertain: boolean;
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
            {title ? `Discard “${title}”?` : "Discard this ticket draft?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {creationUncertain
              ? "Creating this ticket did not finish, and Jira may already have created the issue. Discarding deletes the planning conversation and this draft here, but it does not delete anything in Jira. Check Jira for the issue before you create another ticket."
              : "The planning conversation and its draft are deleted. Tickets you already created are not affected."}
          </AlertDialogDescription>
          <WorkbenchInlineError message={error} />
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" disabled={busy} />}>
            Keep draft
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
            <Trash2Icon /> Discard draft
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
