import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, WorkbenchTicketWorkspace } from "@t3tools/contracts";
import { useEffect } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import type { Project } from "../types";

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
          : `Branch: ${status.data.refName}`;

  return (
    <span className="mt-1 block min-w-0 text-xs text-muted-foreground">
      <Tooltip>
        <TooltipTrigger render={<span className="block truncate" />}>
          Directory: {cwd}
        </TooltipTrigger>
        <TooltipPopup className="max-w-[min(40rem,calc(100vw-2rem))] break-words">
          {cwd}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<span className="block truncate" />}>{branchLabel}</TooltipTrigger>
        <TooltipPopup>{status.error ?? branchLabel}</TooltipPopup>
      </Tooltip>
      {shared !== undefined ? (
        <span className="block">{shared ? "Shared ticket worktree" : "Separate checkout"}</span>
      ) : null}
    </span>
  );
}
