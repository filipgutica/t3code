import { useAtomValue } from "@effect/atom-react";
import type {
  EditorId,
  EnvironmentId,
  ProjectId,
  ResolvedKeybindingsConfig,
  WorkbenchTicketId,
  WorkbenchTicketWorktree,
} from "@t3tools/contracts";
import { CopyIcon, GitBranchIcon, MoreHorizontalIcon, Trash2Icon } from "lucide-react";
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
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Menu,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";
import { toastManager } from "../components/ui/toast";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import {
  WorkbenchCheckoutBranch,
  useWorkbenchCheckoutStatusRefresh,
} from "./WorkbenchCheckoutDetails";
import { WorkbenchPullRequestLink } from "./WorkbenchPullRequestLink";
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

type CheckoutRowProps = {
  readonly environmentId: EnvironmentId;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly isArchived: boolean;
};

/** One row per checkout of a repository: the Ticket's prepared checkout first, then the others. */
export function WorkbenchTicketCheckoutRows({
  ticketId,
  preparedPath,
  canOpenPrepared,
  worktrees,
  ...rowProps
}: CheckoutRowProps & {
  readonly ticketId: WorkbenchTicketId;
  readonly preparedPath: string | null;
  readonly canOpenPrepared: boolean;
  readonly worktrees: ReadonlyArray<WorkbenchTicketWorktree>;
}) {
  if (!preparedPath && worktrees.length === 0) return null;
  return (
    <ul aria-label="Worktrees" className="space-y-0.5 pb-1 ps-5">
      {preparedPath ? (
        <WorkbenchTicketCheckoutRow {...rowProps} cwd={preparedPath} canOpen={canOpenPrepared} />
      ) : null}
      {worktrees.map((worktree) => (
        <WorkbenchTicketCheckoutRow
          key={worktree.path}
          {...rowProps}
          cwd={worktree.path}
          canOpen
          removal={{ ticketId, projectId: worktree.projectId }}
        />
      ))}
    </ul>
  );
}

function WorkbenchTicketCheckoutRow({
  environmentId,
  cwd,
  canOpen,
  removal,
  keybindings,
  availableEditors,
  isArchived,
}: CheckoutRowProps & {
  readonly cwd: string;
  readonly canOpen: boolean;
  /** Only worktrees outside the prepared checkout can be removed here. */
  readonly removal?: { readonly ticketId: WorkbenchTicketId; readonly projectId: ProjectId };
}) {
  const status = useEnvironmentQuery(vcsEnvironment.status({ environmentId, input: { cwd } }));
  const branch = status.data?.isRepo ? status.data.refName : null;
  const hasChanges = status.data?.hasWorkingTreeChanges === true;
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const name = cwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/").at(-1);

  return (
    <li className="group/checkout flex h-7 min-w-0 items-center gap-1.5 rounded-md ps-1 text-xs text-foreground/80 hover:bg-accent focus-within:bg-accent">
      <span className="flex min-w-0 flex-1">
        <WorkbenchCheckoutBranch cwd={cwd} status={status} />
      </span>
      {removal ? null : (
        <Badge variant="outline" size="sm">
          Prepared
        </Badge>
      )}
      {hasChanges ? (
        <Badge variant="outline" size="sm">
          Uncommitted
        </Badge>
      ) : null}
      {status.data?.pr ? (
        <WorkbenchPullRequestLink
          environmentId={environmentId}
          pullRequest={status.data.pr}
          compact
        />
      ) : null}
      {isArchived ? null : (
        <WorkbenchCheckoutRowActions
          environmentId={environmentId}
          cwd={cwd}
          name={name}
          branch={branch}
          canOpen={canOpen}
          keybindings={keybindings}
          availableEditors={availableEditors}
          hasChanges={hasChanges}
          {...(removal ? { onRemove: () => setConfirmingRemove(true) } : {})}
        />
      )}
      {removal ? (
        <WorkbenchRemoveWorktreeDialog
          environmentId={environmentId}
          ticketId={removal.ticketId}
          projectId={removal.projectId}
          path={cwd}
          label={branch ?? name ?? cwd}
          open={confirmingRemove}
          onClose={() => setConfirmingRemove(false)}
        />
      ) : null}
    </li>
  );
}

/** Shown on hover, keyboard focus, an open menu, and always on touch screens. */
function WorkbenchCheckoutRowActions({
  environmentId,
  cwd,
  name,
  branch,
  canOpen,
  keybindings,
  availableEditors,
  hasChanges,
  onRemove,
}: Omit<CheckoutRowProps, "isArchived"> & {
  readonly cwd: string;
  readonly name: string | undefined;
  readonly branch: string | null;
  readonly canOpen: boolean;
  readonly hasChanges: boolean;
  readonly onRemove?: () => void;
}) {
  const canRemove = useAtomValue(
    workbenchEnvironment.removeTicketWorktree.permissionAtom(environmentId),
  );
  const { copyToClipboard } = useCopyToClipboard<{ title: string }>({
    onCopy: ({ title }) => toastManager.add({ type: "success", title }),
    onError: (error) =>
      toastManager.add({ type: "error", title: "Copy failed", description: error.message }),
  });
  return (
    <span className="hidden shrink-0 items-center gap-1 pe-0.5 group-focus-within/checkout:flex group-hover/checkout:flex group-has-[[data-popup-open]]/checkout:flex pointer-coarse:flex">
      {canOpen ? (
        <OpenInPicker
          environmentId={environmentId}
          keybindings={keybindings}
          availableEditors={availableEditors}
          openInCwd={cwd}
          compact
          enableShortcut={false}
        />
      ) : null}
      <Menu>
        <MenuTrigger
          render={
            <Button aria-label={`Actions for worktree ${name}`} size="icon-sm" variant="ghost" />
          }
        >
          <MoreHorizontalIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => copyToClipboard(cwd, { title: "Path copied" })}>
            <CopyIcon /> Copy path
          </MenuItem>
          <MenuItem
            disabled={!branch}
            onClick={() => branch && copyToClipboard(branch, { title: "Branch copied" })}
          >
            <GitBranchIcon /> Copy branch
          </MenuItem>
          {onRemove && canRemove ? (
            <>
              <MenuSeparator />
              {/* A hint only: the server refuses removal while Git reports changes or a Thread works there. */}
              <MenuItem variant="destructive" disabled={hasChanges} onClick={onRemove}>
                <Trash2Icon />
                <MenuItemLabel>
                  Remove worktree
                  {hasChanges ? (
                    <span className="block text-xs text-muted-foreground">
                      Has uncommitted changes
                    </span>
                  ) : null}
                </MenuItemLabel>
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
    </span>
  );
}

function WorkbenchRemoveWorktreeDialog({
  environmentId,
  ticketId,
  projectId,
  path,
  label,
  open,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly ticketId: WorkbenchTicketId;
  readonly projectId: ProjectId;
  readonly path: string;
  readonly label: string;
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const remove = useAtomCommand(workbenchEnvironment.removeTicketWorktree, {
    reportFailure: false,
    reportDefect: false,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setError(null);
    onClose();
  };

  const confirmRemove = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await remove({ environmentId, input: { ticketId, projectId, path } });
    setPending(false);
    if (!reportWorkbenchCommandFailure(result, setError)) close();
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) close();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove worktree {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            Removes the worktree at {path}. Its branch and commits are kept. Removal is refused
            while a Thread works there or Git reports local changes.
          </AlertDialogDescription>
          {error ? (
            <p role="alert" className="text-sm text-destructive-foreground">
              {error}
            </p>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button disabled={pending} onClick={close} variant="outline">
            Cancel
          </Button>
          <Button disabled={pending} onClick={confirmRemove} variant="destructive">
            <Trash2Icon /> {pending ? "Removing…" : "Remove worktree"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
