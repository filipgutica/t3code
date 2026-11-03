import type { EnvironmentId, VcsStatusResult } from "@t3tools/contracts";
import { FolderIcon, GitBranchIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { MiddleTruncate } from "../components/ui/middle-truncate";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";

export function useWorkbenchCheckoutStatusRefresh({
  environmentId,
  cwds,
  onFocus,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwds: ReadonlyArray<string | null | undefined>;
  /** Runs on each focus or visibility return, even with no checkouts yet. Keep it stable. */
  readonly onFocus?: () => void;
}) {
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus);
  const cwdKey = [...new Set(cwds.filter((cwd) => typeof cwd === "string" && cwd.length > 0))]
    .sort()
    .join("\0");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes native checkout status on window focus/visibility changes and releases those listeners on unmount
  useEffect(() => {
    if (!cwdKey && !onFocus) return;
    const paths = cwdKey ? cwdKey.split("\0") : [];
    const pending = new Set<string>();
    const refreshStatuses = () => {
      if (document.visibilityState !== "visible") return;
      for (const cwd of paths) {
        if (pending.has(cwd)) continue;
        pending.add(cwd);
        void refreshStatus({ environmentId, input: { cwd } }).finally(() => pending.delete(cwd));
      }
    };
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      onFocus?.();
      refreshStatuses();
    };
    refreshStatuses();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [cwdKey, environmentId, onFocus, refreshStatus]);
}

export function WorkbenchCheckoutDirectory({
  cwd,
  value = formatCheckoutPath(cwd),
  icon,
  valueClassName = "font-mono",
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
      value={<span className={`min-w-0 truncate font-medium ${valueClassName}`}>{value}</span>}
      fullValue={cwd}
    />
  );
}

export type WorkbenchCheckoutStatus = {
  readonly error: string | null;
  readonly data: VcsStatusResult | null;
};

/** The checkout's branch, or why it has none. */
const checkoutBranchName = (status: WorkbenchCheckoutStatus) =>
  status.error
    ? "Branch unavailable"
    : status.data === null
      ? "Checking branch…"
      : !status.data.isRepo
        ? "Not a Git checkout"
        : (status.data.refName ?? "Detached HEAD");

/** The branch cut in the middle to fit; its popover shows the full branch and the checkout path. */
export function WorkbenchCheckoutBranch({
  cwd,
  status,
}: {
  readonly cwd: string;
  readonly status: WorkbenchCheckoutStatus;
}) {
  const branch = checkoutBranchName(status);
  return (
    <CheckoutDetailPopover
      icon={<GitBranchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
      label="Branch"
      value={
        <span className="flex min-w-0 font-mono font-medium">
          <MiddleTruncate value={branch} showTitle={false} />
        </span>
      }
      fullValue={status.error ?? branch}
      note={cwd}
    />
  );
}

function formatCheckoutPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const finalDirectory = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (finalDirectory.length <= 40) return finalDirectory || path;
  return `${finalDirectory.slice(0, 24)}…${finalDirectory.slice(-15)}`;
}

function CheckoutDetailPopover({
  icon,
  label,
  value,
  fullValue,
  note,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: ReactNode;
  readonly fullValue: string;
  readonly note?: string;
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              aria-label={`${label}: ${fullValue}`}
              variant="inline"
              className="min-w-0 max-w-full"
            />
          }
        >
          {icon}
          {value}
        </TooltipTrigger>
        <TooltipPopup
          side="top"
          align="start"
          className="max-w-[min(40rem,calc(100vw-2rem))] break-all"
        >
          {fullValue}
        </TooltipPopup>
      </Tooltip>
      <PopoverPopup side="top" align="start" className="w-[min(36rem,calc(100vw-2rem))]">
        <div
          tabIndex={0}
          role="region"
          aria-label={`${label} value`}
          className="min-w-0 select-text space-y-1"
        >
          <PopoverTitle>{label}</PopoverTitle>
          <p className="whitespace-pre-wrap break-all font-mono text-sm text-foreground">
            {fullValue}
          </p>
          {note ? (
            <p className="whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
              {note}
            </p>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
