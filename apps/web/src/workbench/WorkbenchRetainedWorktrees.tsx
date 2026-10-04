import type { EnvironmentId, WorkbenchSnapshot, WorkbenchTicketId } from "@t3tools/contracts";
import { FolderGit2Icon, Trash2Icon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { reportWorkbenchCommandFailure } from "./workbenchPageCommands";

export function WorkbenchRetainedWorktrees({
  environmentId,
  snapshot,
}: {
  environmentId: EnvironmentId;
  snapshot: WorkbenchSnapshot;
}) {
  const [open, setOpen] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<WorkbenchTicketId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const removingRef = useRef(false);
  const release = useAtomCommand(workbenchEnvironment.releaseTicketWorkspace, {
    reportFailure: false,
    reportDefect: false,
  });
  const workspaces = useMemo(() => {
    const ticketIds = new Set(snapshot.tickets.map((ticket) => ticket.id));
    return snapshot.ticketWorkspaces.filter(
      (workspace) => !ticketIds.has(workspace.ticketId) && workspace.status !== "released",
    );
  }, [snapshot]);
  const selectedWorkspace = workspaces.find((workspace) => workspace.ticketId === selectedTicketId);

  const remove = async () => {
    if (!selectedWorkspace || removingRef.current) return;
    removingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await release({
        environmentId,
        input: {
          ticketId: selectedWorkspace.ticketId,
          retained: true,
          releasedAt: new Date().toISOString(),
        },
      });
      if (!reportWorkbenchCommandFailure(result, setError)) {
        setSelectedTicketId(null);
        if (workspaces.length === 1) setOpen(false);
      }
    } finally {
      removingRef.current = false;
      setPending(false);
    }
  };

  if (workspaces.length === 0) return null;

  return (
    <>
      <Button
        aria-label="Retained worktrees"
        onClick={() => setOpen(true)}
        size="sm"
        variant="ghost"
      >
        <FolderGit2Icon /> Retained worktrees ({workspaces.length})
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Retained worktrees</DialogTitle>
            <DialogDescription>
              Deleted Tickets keep their worktrees. Remove them after preserving local work and
              deleting Threads that still use them, including archived Threads.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="divide-y divide-border">
              {workspaces.map((workspace) => (
                <div key={workspace.ticketId} className="space-y-3 py-3">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="break-all text-sm font-medium">{workspace.branchName}</p>
                      <p className="break-all text-xs text-muted-foreground">
                        Deleted Ticket {workspace.ticketId}
                      </p>
                    </div>
                    <Button
                      aria-label={`Remove worktrees for ${workspace.ticketId}`}
                      disabled={pending}
                      onClick={() => {
                        setError(null);
                        setSelectedTicketId(workspace.ticketId);
                      }}
                      size="sm"
                      variant="outline"
                    >
                      <Trash2Icon /> Remove
                    </Button>
                  </div>
                  <ul className="space-y-2 text-xs text-muted-foreground">
                    {workspace.repositories.map((repository) => (
                      <li key={repository.projectId}>
                        <code className="break-all">{repository.worktreePath}</code>
                        {repository.status === "released" ? " (removed)" : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button onClick={() => setOpen(false)} variant="outline">
              Close
            </Button>
          </DialogFooter>
          <AlertDialog
            open={selectedWorkspace !== undefined}
            onOpenChange={(nextOpen) => {
              if (!nextOpen && !pending) setSelectedTicketId(null);
            }}
          >
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove retained worktrees?</AlertDialogTitle>
                <AlertDialogDescription>
                  Remove the worktrees for {selectedWorkspace?.branchName}. Branches and commits are
                  kept. Removal is blocked while a Thread owns a worktree or Git reports local
                  changes.
                </AlertDialogDescription>
                {error ? (
                  <p role="alert" className="text-sm text-destructive-foreground">
                    {error}
                  </p>
                ) : null}
              </AlertDialogHeader>
              <AlertDialogFooter>
                <Button
                  disabled={pending}
                  onClick={() => setSelectedTicketId(null)}
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button
                  aria-label="Remove worktrees"
                  disabled={pending}
                  onClick={remove}
                  variant="destructive"
                >
                  <Trash2Icon /> {pending ? "Removing…" : "Remove worktrees"}
                </Button>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
        </DialogPopup>
      </Dialog>
    </>
  );
}
