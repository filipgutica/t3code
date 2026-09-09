import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, WorkbenchTicketWorkspace } from "@t3tools/contracts";
import { FolderIcon, GitBranchIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { Badge } from "../components/ui/badge";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
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
  return (
    <WorkbenchCheckoutDetails
      environmentId={environmentId}
      cwd={cwd}
      shared={
        workspace?.repositories.some(
          (repository) => repository.status === "ready" && repository.worktreePath === cwd,
        ) ?? false
      }
    />
  );
}

export function WorkbenchCheckoutDetails({
  environmentId,
  cwd,
  shared,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly shared?: boolean;
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

  return (
    <span className="mt-1 flex min-w-0 flex-col items-start gap-1 text-xs text-foreground/80">
      <span className="flex min-w-0 w-full">
        <CheckoutDetailPopover
          icon={<FolderIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
          label="Directory"
          value={formatCheckoutPath(cwd)}
          fullValue={cwd}
        />
      </span>
      <span className="flex min-w-0 w-full">
        <CheckoutDetailPopover
          icon={<GitBranchIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
          label="Branch"
          value={formatBranchLabel(branchLabel)}
          fullValue={branchValue}
        />
      </span>
      {status.data?.pr ? (
        <WorkbenchPullRequestLink environmentId={environmentId} pullRequest={status.data.pr} />
      ) : null}
      {shared !== undefined ? (
        <Badge size="sm" variant={shared ? "secondary" : "outline"}>
          {shared ? "Shared" : "Separate"}
        </Badge>
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
  fullValue,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly fullValue: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${label}: ${fullValue}`}
        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm text-left font-medium outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
      >
        {icon}
        <span className="min-w-0 break-all font-mono">{value}</span>
      </PopoverTrigger>
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
