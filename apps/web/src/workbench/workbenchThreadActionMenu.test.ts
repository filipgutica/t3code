import { describe, expect, it } from "vite-plus/test";
import type { ContextMenuItem } from "@t3tools/contracts";

import {
  buildThreadActionMenuItems,
  type ThreadActionMenuState,
} from "../components/threadActionMenu.logic";
import { filterWorkbenchThreadActionMenuItems } from "./workbenchThreadActionMenu";

const baseState: ThreadActionMenuState = {
  projectFilter: null,
  branch: "feature/ticket",
  isPinned: true,
  isSettled: false,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: { settlement: true, snooze: true, pinning: true, titleRegeneration: true },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

function flatten(items: ReadonlyArray<ContextMenuItem>): string[] {
  return items.flatMap((item) => [item.id, ...(item.children ? flatten(item.children) : [])]);
}

describe("filterWorkbenchThreadActionMenuItems", () => {
  it("keeps actions that operate on the assigned native Thread", () => {
    const ids = flatten(
      filterWorkbenchThreadActionMenuItems(buildThreadActionMenuItems(baseState)),
    );

    expect(ids).toEqual([
      "settle",
      "rename",
      "regenerate-title",
      "mark-unread",
      "copy",
      "copy-path",
      "copy-branch",
      "copy-thread-id",
    ]);
  });

  it("keeps Workbench lifecycle actions in their reverse state", () => {
    const ids = flatten(
      filterWorkbenchThreadActionMenuItems(
        buildThreadActionMenuItems({
          ...baseState,
          isPinned: true,
          isSettled: true,
          isSnoozed: true,
        }),
      ),
    );

    expect(ids).toContain("unsettle");
    expect(ids).not.toEqual(expect.arrayContaining(["unpin", "unsnooze"]));
  });

  it("removes a leading native separator when lifecycle actions are unavailable", () => {
    const [first] = filterWorkbenchThreadActionMenuItems(
      buildThreadActionMenuItems({
        ...baseState,
        supports: { settlement: false, snooze: false, pinning: false, titleRegeneration: false },
      }),
    );

    expect(first).toMatchObject({ id: "rename", separatorBefore: false });
  });
});
