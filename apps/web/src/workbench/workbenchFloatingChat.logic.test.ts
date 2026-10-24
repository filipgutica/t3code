import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";

import {
  resolveWorkbenchFloatingChat,
  type WorkbenchFloatingChatThread,
} from "./workbenchFloatingChat.logic";
import { resolveWorkbenchThreadExecutionStatusPresentation } from "./WorkbenchThreadExecutionStatus.logic";
import type { WorkbenchThreadExecutionStatus } from "./workbenchThreadStatus.logic";

const thread = (
  id: string,
  kind: WorkbenchThreadExecutionStatus["kind"] | null = null,
): WorkbenchFloatingChatThread => ({
  threadId: ThreadId.make(id),
  title: `Thread ${id}`,
  status:
    kind === null
      ? null
      : {
          kind,
          presentation: resolveWorkbenchThreadExecutionStatusPresentation({ kind }),
          startedAt: null,
        },
});

const ids = (threads: ReadonlyArray<WorkbenchFloatingChatThread>) =>
  threads.map((entry) => entry.threadId);

describe("resolveWorkbenchFloatingChat", () => {
  it("selects the primary Thread until the user picks a tab, then keeps that pick", () => {
    const active = [thread("a"), thread("b", "working")];
    const base = { active, archived: [], settled: [], primaryThreadId: ThreadId.make("b") };

    expect(resolveWorkbenchFloatingChat({ ...base, explicitThreadId: null }).selectedThreadId).toBe(
      "b",
    );
    // Another Thread becoming primary must not pull the user off the tab they chose.
    expect(
      resolveWorkbenchFloatingChat({ ...base, explicitThreadId: ThreadId.make("a") })
        .selectedThreadId,
    ).toBe("a");
  });

  it("falls back to the primary, then the first tab, when the picked Thread disappears", () => {
    const active = [thread("a"), thread("b")];
    const gone = ThreadId.make("removed");

    expect(
      resolveWorkbenchFloatingChat({
        active,
        archived: [],
        settled: [],
        primaryThreadId: ThreadId.make("b"),
        explicitThreadId: gone,
      }).selectedThreadId,
    ).toBe("b");
    expect(
      resolveWorkbenchFloatingChat({
        active,
        archived: [],
        settled: [],
        primaryThreadId: null,
        explicitThreadId: gone,
      }).selectedThreadId,
    ).toBe("a");
    expect(
      resolveWorkbenchFloatingChat({
        active: [],
        archived: [],
        settled: [],
        primaryThreadId: null,
        explicitThreadId: gone,
      }).selectedThreadId,
    ).toBeNull();
  });

  it("shows a picked settled Thread as a trailing tab and removes it from the settled menu", () => {
    const result = resolveWorkbenchFloatingChat({
      active: [thread("a")],
      archived: [],
      settled: [thread("s1"), thread("s2")],
      primaryThreadId: null,
      explicitThreadId: ThreadId.make("s2"),
    });

    expect(result.selectedThreadId).toBe("s2");
    expect(ids(result.tabs)).toEqual(["a", "s2"]);
    expect(ids(result.settled)).toEqual(["s1"]);
  });

  it("gives every active Thread a tab; the tab strip scrolls instead of hiding any", () => {
    const active = [thread("a"), thread("b"), thread("c"), thread("d"), thread("e")];
    const result = resolveWorkbenchFloatingChat({
      active,
      archived: [],
      settled: [],
      primaryThreadId: null,
      explicitThreadId: ThreadId.make("e"),
    });
    expect(ids(result.tabs)).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.selectedThreadId).toBe("e");
  });

  it("never selects an archived Thread and counts only Threads waiting on the user", () => {
    const result = resolveWorkbenchFloatingChat({
      active: [
        thread("working", "working"),
        thread("approval", "approval"),
        thread("input", "input"),
        thread("failed", "failed"),
      ],
      archived: [thread("old")],
      settled: [],
      primaryThreadId: null,
      explicitThreadId: ThreadId.make("old"),
    });

    expect(result.selectedThreadId).toBe("working");
    expect(ids(result.archived)).toEqual(["old"]);
    expect(result.attentionCount).toBe(3);
  });
});
