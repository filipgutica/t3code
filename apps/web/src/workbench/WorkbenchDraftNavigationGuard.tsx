import { useBlocker } from "@tanstack/react-router";
import { Button } from "../components/ui/button";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import type { useTicketDraftEditor } from "./useWorkbenchTicketConversation";

export function WorkbenchDraftNavigationGuard({
  editor,
}: {
  readonly editor: Pick<
    ReturnType<typeof useTicketDraftEditor>,
    "flush" | "hasPendingEdits" | "abandon"
  >;
}) {
  const blocker = useBlocker({
    withResolver: true,
    shouldBlockFn: async () => !(await editor.flush()).ok,
    enableBeforeUnload: () => editor.hasPendingEdits(),
  });
  return (
    <UnsavedDraftNavigationDialog
      open={blocker.status === "blocked"}
      onStay={() => blocker.reset?.()}
      onLeave={() => {
        editor.abandon();
        blocker.proceed?.();
      }}
    />
  );
}

function UnsavedDraftNavigationDialog({
  open,
  onStay,
  onLeave,
}: {
  readonly open: boolean;
  readonly onStay: () => void;
  readonly onLeave: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onStay();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Your edits are not saved</AlertDialogTitle>
          <AlertDialogDescription>
            Saving failed. Stay to keep your edits here, or leave and discard the unsaved changes.
            The saved draft remains available.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={onStay}>
            Stay
          </Button>
          <Button variant="destructive" onClick={onLeave}>
            Leave without saving
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
