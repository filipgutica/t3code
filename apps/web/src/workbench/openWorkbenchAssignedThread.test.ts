import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { describe, expect, it } from "vite-plus/test";

import { openWorkbenchAssignedThread } from "./openWorkbenchAssignedThread";

const environmentId = EnvironmentId.make("environment-one");
const threadId = ThreadId.make("thread-one");

describe("openWorkbenchAssignedThread", () => {
  it("restores an archived Thread before opening it", async () => {
    const events: string[] = [];
    const result = await openWorkbenchAssignedThread(
      { environmentId, threadId, archived: true },
      {
        unarchive: async () => {
          events.push("unarchive");
          return AsyncResult.success(undefined);
        },
        refreshArchived: () => events.push("refresh"),
        navigate: async () => {
          events.push("navigate");
        },
      },
    );

    expect(result).toEqual({ state: "opened" });
    expect(events).toEqual(["unarchive", "refresh", "navigate"]);
  });

  it("keeps a restore failure observable and does not navigate", async () => {
    const events: string[] = [];
    const result = await openWorkbenchAssignedThread(
      { environmentId, threadId, archived: true },
      {
        unarchive: async () => {
          events.push("unarchive");
          return AsyncResult.failure(Cause.fail("restore failed"));
        },
        refreshArchived: () => events.push("refresh"),
        navigate: async () => {
          events.push("navigate");
        },
      },
    );

    expect(result).toMatchObject({ state: "restore-failed" });
    expect(events).toEqual(["unarchive"]);
  });

  it("keeps a navigation failure observable after restoring", async () => {
    const events: string[] = [];
    const result = await openWorkbenchAssignedThread(
      { environmentId, threadId, archived: true },
      {
        unarchive: async () => {
          events.push("unarchive");
          return AsyncResult.success(undefined);
        },
        refreshArchived: () => events.push("refresh"),
        navigate: async () => {
          events.push("navigate");
          throw new Error("navigation failed");
        },
      },
    );

    expect(result).toMatchObject({ state: "navigation-failed" });
    expect(events).toEqual(["unarchive", "refresh", "navigate"]);
  });
});
