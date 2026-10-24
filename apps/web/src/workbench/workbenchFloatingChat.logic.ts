import type { ThreadId } from "@t3tools/contracts";

import type { WorkbenchThreadExecutionStatus } from "./workbenchThreadStatus.logic";

export interface WorkbenchFloatingChatThread {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly status: WorkbenchThreadExecutionStatus | null;
}

const ATTENTION_KINDS: ReadonlySet<WorkbenchThreadExecutionStatus["kind"]> = new Set([
  "approval",
  "input",
  "failed",
]);

export function resolveWorkbenchFloatingChat({
  active,
  archived,
  settled,
  primaryThreadId,
  explicitThreadId,
}: {
  /** Live Threads of the ticket's active Assignments, in ticket order. */
  readonly active: ReadonlyArray<WorkbenchFloatingChatThread>;
  /** Active Assignments whose Thread is archived; they open on the Thread route after restore. */
  readonly archived: ReadonlyArray<WorkbenchFloatingChatThread>;
  /** Live settled Threads. */
  readonly settled: ReadonlyArray<WorkbenchFloatingChatThread>;
  readonly primaryThreadId: ThreadId | null;
  readonly explicitThreadId: ThreadId | null;
}) {
  const findIn = (threads: ReadonlyArray<WorkbenchFloatingChatThread>, threadId: ThreadId | null) =>
    threads.find((thread) => thread.threadId === threadId);
  // A tab the user picked stays selected even when another Thread becomes the primary one.
  const selected =
    findIn(active, explicitThreadId) ??
    findIn(settled, explicitThreadId) ??
    findIn(active, primaryThreadId) ??
    active[0] ??
    null;
  // A picked settled Thread gets a trailing tab while it is selected.
  const pickedSettled = selected !== null && !active.includes(selected) ? selected : null;
  return {
    selectedThreadId: selected?.threadId ?? null,
    tabs: pickedSettled ? [...active, pickedSettled] : active,
    settled: settled.filter((thread) => thread !== pickedSettled),
    archived,
    attentionCount: active.filter(
      (thread) => thread.status !== null && ATTENTION_KINDS.has(thread.status.kind),
    ).length,
  };
}
