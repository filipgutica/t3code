import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { formatWorkingDurationLabel } from "./Sidebar.logic";
import type { ThreadExecutionStatusPresentation } from "./ThreadExecutionStatus.logic";

const STATUS_ICONS = {
  working: CircleDashedIcon,
  input: MessageCircleQuestionIcon,
  approval: ShieldQuestionIcon,
  failed: CircleAlertIcon,
  done: CircleCheckIcon,
};

// Only the duration re-renders each second; rows and status labels do not tick.
function WorkingDuration({ startedAt }: { startedAt: string | null }) {
  const startedMs = startedAt !== null ? Date.parse(startedAt) : Number.NaN;
  const [now, setNow] = useState(() => Date.now());
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

/** Read-only native status. Clickable wake acknowledgement stays with the native sidebar. */
export function ThreadExecutionStatus({
  status,
  startedAt = null,
}: {
  status: ThreadExecutionStatusPresentation | null | undefined;
  startedAt?: string | null | undefined;
}) {
  if (!status) return null;
  const Icon = status.icon !== null && status.icon !== "woke" ? STATUS_ICONS[status.icon] : null;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 font-medium ${status.className}`}>
      {Icon ? <Icon aria-hidden className="size-4 shrink-0" /> : null}
      {/* Keep the clock outside the live label so screen readers do not announce each second. */}
      <span role="status">{status.label}</span>
      {status.icon === "working" ? <WorkingDuration key={startedAt} startedAt={startedAt} /> : null}
    </span>
  );
}
