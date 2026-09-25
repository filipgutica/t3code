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
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
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
      "auto-settle",
      "auto-settle:enabled",
      "auto-settle:disabled",
      "copy",
      "copy-path",
      "copy-branch",
      "copy-thread-id",
    ]);
  });

  it("keeps Workbench lifecycle actions in their reverse state", () => {
    const items = filterWorkbenchThreadActionMenuItems(
      buildThreadActionMenuItems({
        ...baseState,
        isPinned: true,
        isSettled: true,
        isSnoozed: true,
        autoSettleEnabled: false,
      }),
    );
    const ids = flatten(items);

    expect(ids).toContain("unsettle");
    expect(ids).not.toEqual(expect.arrayContaining(["unpin", "unsnooze"]));
    expect(items.find((item) => item.id === "auto-settle")?.children).toMatchObject([
      { id: "auto-settle:enabled", checked: false },
      { id: "auto-settle:disabled", checked: true },
    ]);
  });

  it("removes a leading native separator when lifecycle actions are unavailable", () => {
    const items = filterWorkbenchThreadActionMenuItems(
      buildThreadActionMenuItems({
        ...baseState,
        supports: {
          settlement: false,
          autoSettleOptOut: false,
          snooze: false,
          pinning: false,
          titleRegeneration: false,
        },
      }),
    );

    expect(items[0]).toMatchObject({ id: "rename", separatorBefore: false });
    expect(flatten(items)).not.toContain("auto-settle");
  });
});
