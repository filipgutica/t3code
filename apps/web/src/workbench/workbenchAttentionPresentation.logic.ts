import type { ThreadId } from "@t3tools/contracts";

import { resolveWorkbenchThreadExecutionStatusPresentation } from "./WorkbenchThreadExecutionStatus.logic";
import {
  getWorkbenchAttentionSignalLabel,
  groupWorkbenchAttentionSignals,
  type WorkbenchAttentionInspection,
  type WorkbenchAttentionSignal,
} from "./workbenchAttention.logic";
import type { WorkbenchThreadExecutionStatus } from "./workbenchThreadStatus.logic";

type ThreadStatusKind = WorkbenchThreadExecutionStatus["kind"] | null;

const nativeAttentionTone = (kind: "input" | "approval" | "failed") =>
  resolveWorkbenchThreadExecutionStatusPresentation({ kind }).className;

const signalPresentations = {
  question: { icon: "input", className: nativeAttentionTone("input"), action: "Open Thread" },
  approval: { icon: "approval", className: nativeAttentionTone("approval"), action: "Open Thread" },
  failed: { icon: "failed", className: nativeAttentionTone("failed"), action: "Open Thread" },
  "failed-checks": {
    icon: "failed",
    className: nativeAttentionTone("failed"),
    action: "View checks",
  },
  "changes-requested": {
    icon: "message",
    className: "text-warning-foreground",
    action: "View changes",
  },
  "unresolved-feedback": {
    icon: "message",
    className: "text-warning-foreground",
    action: "View discussions",
  },
  reply: { icon: "message", className: "text-info", action: "Open Thread" },
  plan: { icon: "plan", className: "text-warning-foreground", action: "Open Thread" },
  interrupted: {
    icon: "interrupted",
    className: "text-warning-foreground",
    action: "Open Thread",
  },
} as const;

/** Thread rows already show the current execution state beside their notification badge. */
export function getWorkbenchThreadAttention({
  signals,
  inspections,
  threadId,
  statusKind,
}: {
  readonly signals: ReadonlyArray<WorkbenchAttentionSignal>;
  readonly inspections: ReadonlyArray<WorkbenchAttentionInspection>;
  readonly threadId: ThreadId;
  readonly statusKind: ThreadStatusKind;
}) {
  return {
    signals: signals.filter((signal) => {
      if (signal.source.type === "pull-request") return signal.source.row.threadId === threadId;
      if (signal.source.threadId !== threadId) return false;
      if (signal.kind === "question") return statusKind !== "input";
      if (signal.kind !== "waiting") return true;
      if (signal.cause === "approval") return statusKind !== "approval";
      if (signal.cause === "failed") return statusKind !== "failed";
      return true;
    }),
    inspections: inspections.filter((inspection) => inspection.row.threadId === threadId),
  };
}

export function getWorkbenchAttentionSignalPresentation(signal: WorkbenchAttentionSignal) {
  const kind = signal.kind === "waiting" ? signal.cause : signal.kind;
  return {
    ...signalPresentations[kind],
    label: getWorkbenchAttentionSignalLabel(signal),
  };
}

/** Badge reasons and count come from the same priority-ordered list as its popover. */
export function getWorkbenchAttentionBadgePresentation(
  signals: ReadonlyArray<WorkbenchAttentionSignal>,
) {
  const ordered = groupWorkbenchAttentionSignals(signals).flatMap((group) => group.signals);
  const first = ordered[0];
  return {
    count: ordered.length,
    leading: first ? getWorkbenchAttentionSignalPresentation(first) : null,
    reasons: ordered.map(getWorkbenchAttentionSignalLabel).join(", "),
  };
}
