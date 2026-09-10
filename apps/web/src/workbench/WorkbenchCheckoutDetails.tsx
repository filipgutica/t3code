import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, WorkbenchTicketWorkspace } from "@t3tools/contracts";
import { CheckIcon, CopyIcon, FolderIcon, GitBranchIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import {
  ANCHORED_COPY_TOAST_TIMEOUT_MS,
  showAnchoredCopyErrorToast,
  showAnchoredCopySuccessToast,
} from "../components/ui/anchoredCopyToast";
import { Button } from "../components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import type { Project } from "../types";
import { WorkbenchPullRequestLink } from "./WorkbenchPullRequestLink";

export function useWorkbenchCheckoutStatusRefresh({
  environmentId,
  cwds,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwds: ReadonlyArray<string | null | undefined>;
}) {
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus);
  const cwdKey = [...new Set(cwds.filter((cwd) => typeof cwd === "string" && cwd.length > 0))]
    .sort()
    .join("\0");
  useEffect(() => {
    if (!cwdKey) return;
    const paths = cwdKey.split("\0");
    const pending = new Set<string>();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      for (const cwd of paths) {
        if (pending.has(cwd)) continue;
        pending.add(cwd);
        void refreshStatus({ environmentId, input: { cwd } }).finally(() => pending.delete(cwd));
      }
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [cwdKey, environmentId, refreshStatus]);
}

export function WorkbenchThreadCheckoutDetails({
  environmentId,
  thread,
  projects,
  workspace,
}: {
  readonly environmentId: EnvironmentId;
  readonly thread: EnvironmentThreadShell;
  readonly projects: ReadonlyArray<Project>;
  readonly workspace: WorkbenchTicketWorkspace | undefined;
}) {
  const cwd =
    thread.worktreePath ??
    projects.find((project) => project.id === thread.projectId)?.workspaceRoot;
  if (!cwd)
    return <span className="block text-xs text-muted-foreground">Directory unavailable</span>;
  const shared =
    workspace?.repositories.some(
      (repository) => repository.status === "ready" && repository.worktreePath === cwd,
    ) ?? false;
  return (
    <details className="w-full overflow-hidden rounded-md border border-border/50 bg-muted/15">
      <Tooltip>
        <TooltipTrigger
          render={
            <summary className="cursor-pointer px-2 py-1.5 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring" />
          }
        >
          Checkout details
          <span className="ml-1 font-normal text-muted-foreground/75">
            · {shared ? "Ticket checkout" : "Other checkout"}
          </span>
        </TooltipTrigger>
        <TooltipPopup className="max-w-72">
          {shared
            ? "This thread uses the ticket’s prepared working directory. Threads using this directory share files, branch, and uncommitted changes. This does not mean another thread is currently using it."
            : "This thread uses a working directory outside the ticket’s prepared checkouts. Other threads may still use the same directory."}
        </TooltipPopup>
      </Tooltip>
      <div className="border-t border-border/50 px-2 pb-2">
        <WorkbenchCheckoutDetails environmentId={environmentId} cwd={cwd} />
      </div>
    </details>
  );
}

export function WorkbenchCheckoutDirectory({
  cwd,
  value = formatCheckoutPath(cwd),
  icon,
  valueClassName,
}: {
  readonly cwd: string;
  readonly value?: string;
  readonly icon?: ReactNode;
  readonly valueClassName?: string;
}) {
  return (
    <CheckoutDetailPopover
      icon={icon ?? <FolderIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
      label="Directory"
      value={value}
      valueClassName={valueClassName ?? "font-mono"}
      fullValue={cwd}
      copyLabel="Copy path"
    />
  );
}

export function WorkbenchCheckoutDetails({
  environmentId,
  cwd,
  showDirectory = true,
  showPullRequest = true,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  /** Keep the full path available without repeating a repository name already shown by the parent. */
  readonly showDirectory?: boolean;
  readonly showPullRequest?: boolean;
}) {
  const status = useEnvironmentQuery(vcsEnvironment.status({ environmentId, input: { cwd } }));
  const branchLabel = status.error
    ? "Branch unavailable"
    : status.data === null
      ? "Checking branch…"
      : !status.data.isRepo
        ? "Not a Git checkout"
        : status.data.refName === null
          ? "Detached HEAD"
          : status.data.refName;
  const branchValue = status.error ?? status.data?.refName ?? branchLabel;
  const canCopyBranch =
    status.error === null &&
    status.data !== null &&
    status.data.isRepo &&
    status.data.refName !== null;

  return (
    <span className="mt-1 flex min-w-0 flex-col items-start gap-1 text-xs text-foreground/80">
      {showDirectory ? (
        <span className="flex min-w-0 w-full">
          <WorkbenchCheckoutDirectory cwd={cwd} />
        </span>
      ) : null}
      <span className="flex min-w-0 w-full items-center gap-1">
        <CheckoutDetailPopover
          icon={<GitBranchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
          label="Branch"
          value={formatBranchLabel(branchLabel)}
          fullValue={branchValue}
          copyDisabled={!canCopyBranch}
          copyLabel={undefined}
          valueClassName="font-mono"
        />
      </span>
      {showPullRequest && status.data?.pr ? (
        <WorkbenchPullRequestLink environmentId={environmentId} pullRequest={status.data.pr} />
      ) : null}
    </span>
  );
}

function formatCheckoutPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const finalDirectory = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (finalDirectory.length <= 40) return finalDirectory || path;
  return `${finalDirectory.slice(0, 24)}…${finalDirectory.slice(-15)}`;
}

function formatBranchLabel(branch: string): string {
  const maxLength = 36;
  if (branch.length <= maxLength) return branch;
  return `${branch.slice(0, maxLength - 15)}…${branch.slice(-14)}`;
}

function CheckoutDetailPopover({
  icon,
  label,
  value,
  valueClassName,
  fullValue,
  copyDisabled = false,
  copyLabel,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly valueClassName: string;
  readonly fullValue: string;
  readonly copyDisabled?: boolean;
  readonly copyLabel: string | undefined;
}) {
  return (
    <Popover>
      <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                aria-label={`${label}: ${fullValue}`}
                className="inline-flex min-w-0 max-w-full flex-1 items-center gap-1.5 rounded-sm text-left font-medium outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              />
            }
          >
            {icon}
            <span className={`min-w-0 truncate ${valueClassName}`}>{value}</span>
          </TooltipTrigger>
          <TooltipPopup
            side="top"
            align="start"
            className="max-w-[min(40rem,calc(100vw-2rem))] break-all"
          >
            {fullValue}
          </TooltipPopup>
        </Tooltip>
        <CheckoutDetailCopyButton
          copyLabel={copyLabel}
          disabled={copyDisabled}
          label={label}
          value={fullValue}
        />
      </span>
      <PopoverPopup side="top" align="start" className="w-[min(36rem,calc(100vw-2rem))]">
        <div
          tabIndex={0}
          role="region"
          aria-label={`${label} value`}
          className="min-w-0 select-text space-y-1"
        >
          <PopoverTitle className="text-xs text-muted-foreground">{label}</PopoverTitle>
          <p className="whitespace-pre-wrap break-all font-mono text-sm text-foreground">
            {fullValue}
          </p>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function CheckoutDetailCopyButton({
  disabled,
  label,
  value,
  copyLabel,
}: {
  readonly disabled: boolean;
  readonly label: string;
  readonly value: string;
  readonly copyLabel: string | undefined;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    target: label.toLowerCase(),
    onCopy: () => showAnchoredCopySuccessToast(ref),
    onError: (error) => showAnchoredCopyErrorToast(ref, error),
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
  });
  const actionLabel = copyLabel ?? `Copy ${label}`;
  const copiedLabel = copyLabel?.replace(/^Copy/, "Copied") ?? `${label} copied`;
  const statusLabel = disabled ? `${label} unavailable` : isCopied ? copiedLabel : actionLabel;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={ref}
            aria-label={statusLabel}
            className="text-muted-foreground hover:text-foreground"
            disabled={disabled}
            onClick={() => copyToClipboard(value, undefined)}
            size="icon-xs"
            type="button"
            variant="ghost"
          />
        }
      >
        {isCopied ? <CheckIcon className="size-3 text-success" /> : <CopyIcon className="size-3" />}
      </TooltipTrigger>
      <TooltipPopup side="top">{statusLabel}</TooltipPopup>
    </Tooltip>
  );
}
