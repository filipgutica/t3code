import type { ContextMenuItem } from "@t3tools/contracts";

import type { ThreadActionMenuId } from "../components/threadActionMenu.logic";

const WORKBENCH_THREAD_ACTIONS: ReadonlySet<ThreadActionMenuId> = new Set([
  "settle",
  "unsettle",
  "rename",
  "regenerate-title",
  "mark-unread",
  "copy",
  "copy-path",
  "copy-branch",
  "copy-thread-id",
]);

/**
 * Workbench keeps Threads grouped by Ticket, so native sidebar actions that
 * create or move an unassigned Thread, change native-only grouping state, or
 * navigate to another surface are not useful in this hierarchy.
 */
export function filterWorkbenchThreadActionMenuItems(
  items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>>,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  const retained = items.flatMap((item) => {
    if (!WORKBENCH_THREAD_ACTIONS.has(item.id)) return [];
    if (!item.children) return [item];
    const children = filterWorkbenchThreadActionMenuItems(item.children);
    return children.length > 0 ? [{ ...item, children }] : [];
  });

  // Native capability gating can leave Rename as the first visible item;
  // its native separator only made sense after the lifecycle section.
  if (retained[0]?.separatorBefore === true) {
    return [{ ...retained[0], separatorBefore: false }, ...retained.slice(1)];
  }
  return retained;
}
