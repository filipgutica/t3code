import type { WorkbenchProject } from "@t3tools/contracts";
import { Button } from "../components/ui/button";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";

export function WorkbenchWorkspaceDeleteDialog({
  workspace,
  ticketCount,
  epicCount,
  pending,
  canDelete,
  error,
  onClose,
  onDelete,
}: {
  workspace: WorkbenchProject;
  ticketCount: number;
  epicCount: number;
  pending: boolean;
  canDelete: boolean;
  error: string | null;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {workspace.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            Permanently remove this Workspace, {ticketCount} Ticket{ticketCount === 1 ? "" : "s"},{" "}
            and {epicCount} Epic{epicCount === 1 ? "" : "s"}, including its Jira mirror. Native
            Projects, Threads, Git worktrees, branches, commits, and Jira issues are retained. You
            can remove retained worktrees separately. This cannot be undone.
          </AlertDialogDescription>
          {error ? (
            <p role="alert" className="text-sm text-destructive-foreground">
              {error}
            </p>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (!pending) onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending || !canDelete}
            aria-busy={pending}
            onClick={() => {
              if (!pending && canDelete) void onDelete();
            }}
          >
            {pending ? "Deleting Workspace…" : "Delete Workspace"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
