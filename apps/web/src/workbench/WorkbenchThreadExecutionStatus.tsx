import {
  CircleAlertIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  UserRoundIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import type { WorkbenchThreadExecutionStatusPresentation } from "./WorkbenchThreadExecutionStatus.logic";

const STATUS_ICONS = {
  working: CircleDashedIcon,
  waiting: CircleDotDashedIcon,
  input: MessageCircleQuestionIcon,
  request: UserRoundIcon,
  approval: ShieldQuestionIcon,
  failed: CircleAlertIcon,
};

// Only the duration re-renders each second; rows and status labels do not tick.
function WorkingDuration({ startedAt }: { startedAt: string | null }) {
  const startedMs = startedAt !== null ? Date.parse(startedAt) : Number.NaN;
  const [now, setNow] = useState(() => Date.now());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the working-duration clock interval and stops it when that status unmounts
  useEffect(() => {
    if (Number.isNaN(startedMs)) return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [startedMs]);
  if (Number.isNaN(startedMs)) return null;
  return (
    <span aria-hidden className="tabular-nums">
      {formatWorkingDurationLabel(now - startedMs)}
    </span>
  );
}

export function WorkbenchThreadExecutionStatus({
  status,
  startedAt = null,
  compact = false,
}: {
  status: WorkbenchThreadExecutionStatusPresentation | null | undefined;
  startedAt?: string | null | undefined;
  compact?: boolean;
}) {
  if (!status) return null;
  const Icon = STATUS_ICONS[status.icon];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 ${compact ? "text-2xs font-normal" : "font-medium"} ${status.className}`}
    >
      <Icon aria-hidden className={`shrink-0 ${compact ? "size-3" : "size-4"}`} />
      {/* Keep the clock outside the live label so screen readers do not announce each second. */}
      <span role="status">{status.label}</span>
      {status.icon === "working" ? <WorkingDuration key={startedAt} startedAt={startedAt} /> : null}
    </span>
  );
}

/** The status icon alone, for places too narrow for the label; callers name it accessibly. */
export function WorkbenchThreadExecutionStatusIcon({
  status,
}: {
  status: WorkbenchThreadExecutionStatusPresentation;
}) {
  const Icon = STATUS_ICONS[status.icon];
  return <Icon aria-hidden className={`size-3.5 shrink-0 ${status.className}`} />;
}
