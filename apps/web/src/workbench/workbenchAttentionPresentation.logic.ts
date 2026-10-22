import type { ThreadId } from "@t3tools/contracts";

import { resolveWorkbenchThreadExecutionStatusPresentation } from "./WorkbenchThreadExecutionStatus.logic";
import {
  compareWorkbenchAttentionSignals,
  getWorkbenchAttentionReasonKind,
  getWorkbenchAttentionReasonLabel,
  getWorkbenchAttentionSignalLabel,
  type WorkbenchAttentionReasonKind,
  type WorkbenchAttentionSignal,
} from "./workbenchAttention.logic";
import type { WorkbenchThreadExecutionStatus } from "./workbenchThreadStatus.logic";

type ThreadStatusKind = WorkbenchThreadExecutionStatus["kind"] | null;

const nativeAttentionTone = (kind: "input" | "approval" | "failed") =>
  resolveWorkbenchThreadExecutionStatusPresentation({ kind }).className;

const reasonTones = {
  approval: nativeAttentionTone("approval"),
  input: nativeAttentionTone("input"),
  failed: nativeAttentionTone("failed"),
  checks: nativeAttentionTone("failed"),
  feedback: "text-warning-foreground",
  plan: nativeAttentionTone("input"),
  done: "text-success-foreground",
} as const;

export function getWorkbenchAttentionReasonPresentation(kind: WorkbenchAttentionReasonKind) {
  return {
    icon: kind,
    className: reasonTones[kind],
    label: getWorkbenchAttentionReasonLabel(kind),
  };
}

export function getWorkbenchThreadAttention({
  signals,
  threadId,
}: {
  readonly signals: ReadonlyArray<WorkbenchAttentionSignal>;
  readonly threadId: ThreadId;
}) {
  return {
    signals: signals.filter((signal) =>
      signal.source.type === "pull-request"
        ? signal.source.row.threadId === threadId
        : signal.source.threadId === threadId,
    ),
  };
}

export function getWorkbenchAttentionSignalPresentation(signal: WorkbenchAttentionSignal) {
  const kind = getWorkbenchAttentionReasonKind(signal);
  const action =
    signal.source.type === "thread"
      ? "Open thread"
      : signal.kind === "failed-checks"
        ? "View checks"
        : signal.kind === "changes-requested"
          ? "View review"
          : "View threads";
  return {
    ...getWorkbenchAttentionReasonPresentation(kind),
    action,
    label: getWorkbenchAttentionSignalLabel(signal),
  };
}

/** The native status owns the leading slot; +N counts distinct additional reasons. */
export function getWorkbenchAttentionBadgePresentation({
  signals,
  nativeStatusKind,
}: {
  readonly signals: ReadonlyArray<WorkbenchAttentionSignal>;
  readonly nativeStatusKind: ThreadStatusKind;
}) {
  const allKinds = [
    ...new Set(
      signals.toSorted(compareWorkbenchAttentionSignals).map(getWorkbenchAttentionReasonKind),
    ),
  ];
  const kinds = allKinds.filter((kind) => kind !== nativeStatusKind);
  return {
    kinds,
    leading: nativeStatusKind === null ? (kinds[0] ?? null) : null,
    more: nativeStatusKind === null ? Math.max(kinds.length - 1, 0) : kinds.length,
    // Screen readers hear every reason, including the one the native status already shows.
    reasons: allKinds.map(getWorkbenchAttentionReasonLabel).join(", "),
  };
}
