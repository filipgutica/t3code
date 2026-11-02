import { useAtomValue } from "@effect/atom-react";
import type {
  EditorId,
  EnvironmentId,
  ResolvedKeybindingsConfig,
  WorkbenchTicketId,
  WorkbenchTicketWorktree,
} from "@t3tools/contracts";
import { MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { OpenInPicker } from "../components/chat/OpenInPicker";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import {
  WorkbenchCheckoutDetails,
  useWorkbenchCheckoutStatusRefresh,
} from "./WorkbenchCheckoutDetails";
import { workbenchEnvironment } from "./state";
import { reportWorkbenchCommandFailure } from "./workbenchPageCommands";

const NO_WORKTREES: ReadonlyArray<WorkbenchTicketWorktree> = [];

/** The Ticket's other worktrees, refreshed with their branch and PR when the window regains focus. */
export function useWorkbenchTicketWorktrees({
  environmentId,
  ticketId,
}: {
  readonly environmentId: EnvironmentId;
  readonly ticketId: WorkbenchTicketId;
}) {
  const query = useEnvironmentQuery(
    workbenchEnvironment.ticketWorktrees({ environmentId, input: { ticketId } }),
  );
  const worktrees = query.data ?? NO_WORKTREES;
  useWorkbenchCheckoutStatusRefresh({
    environmentId,
    cwds: worktrees.map((worktree) => worktree.path),
    onFocus: query.refresh,
  });
  return worktrees;
}

export function WorkbenchTicketWorktreeRows({
  environmentId,
  ticketId,
  worktrees,
  keybindings,
  availableEditors,
  isArchived,
}: {
  readonly environmentId: EnvironmentId;
  readonly ticketId: WorkbenchTicketId;
  readonly worktrees: ReadonlyArray<WorkbenchTicketWorktree>;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly isArchived: boolean;
}) {
  if (worktrees.length === 0) return null;
  return (
    <ul aria-label="Other worktrees" className="ms-2 border-s border-border/50 ps-4">
      {worktrees.map((worktree) => (
        <WorkbenchTicketWorktreeRow
          key={worktree.path}
          environmentId={environmentId}
          ticketId={ticketId}
          worktree={worktree}
          keybindings={keybindings}
          availableEditors={availableEditors}
          isArchived={isArchived}
        />
      ))}
    </ul>
  );
}

function WorkbenchTicketWorktreeRow({
  environmentId,
  ticketId,
  worktree,
  keybindings,
  availableEditors,
  isArchived,
}: {
  readonly environmentId: EnvironmentId;
  readonly ticketId: WorkbenchTicketId;
  readonly worktree: WorkbenchTicketWorktree;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly isArchived: boolean;
}) {
  const canRemove = useAtomValue(
    workbenchEnvironment.removeTicketWorktree.permissionAtom(environmentId),
  );
  const remove = useAtomCommand(workbenchEnvironment.removeTicketWorktree, {
    reportFailure: false,
    reportDefect: false,
  });
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = worktree.path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").at(-1);

  const confirmRemove = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await remove({
      environmentId,
      input: { ticketId, projectId: worktree.projectId, path: worktree.path },
    });
    setPending(false);
    if (!reportWorkbenchCommandFailure(result, setError)) setConfirming(false);
  };

  return (
    <li className="flex min-w-0 items-start gap-2 py-1.5 text-sm">
      <div className="min-w-0 flex-1">
        <WorkbenchCheckoutDetails environmentId={environmentId} cwd={worktree.path} />
      </div>
      {isArchived ? null : (
        <OpenInPicker
          environmentId={environmentId}
          keybindings={keybindings}
          availableEditors={availableEditors}
          openInCwd={worktree.path}
          compact
          enableShortcut={false}
        />
      )}
      {isArchived || !canRemove ? null : (
        <Menu>
          <MenuTrigger
            render={
              <Button aria-label={`Actions for worktree ${name}`} size="icon-sm" variant="ghost" />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem
              variant="destructive"
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
            >
              <Trash2Icon /> Remove worktree
            </MenuItem>
          </MenuPopup>
        </Menu>
      )}
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirming(false);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove worktree {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the worktree at {worktree.path}. Its branch and commits are kept. Removal is
              refused while a Thread works there or Git reports local changes.
            </AlertDialogDescription>
            {error ? (
              <p role="alert" className="text-sm text-destructive-foreground">
                {error}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button disabled={pending} onClick={() => setConfirming(false)} variant="outline">
              Cancel
            </Button>
            <Button disabled={pending} onClick={confirmRemove} variant="destructive">
              <Trash2Icon /> {pending ? "Removing…" : "Remove worktree"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </li>
  );
}
