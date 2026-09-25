import { assert, describe, it } from "@effect/vitest";
import { afterEach, vi } from "vite-plus/test";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import { flushCallbacks, makeHarness } from "../updates/updatesTestHarness.ts";

describe("Workbench DesktopUpdates", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.effect("does not check or install updates in unsigned Workbench Mac builds", () => {
    vi.stubGlobal("__T3CODE_WORKBENCH_BUILD__", true);
    vi.stubGlobal("__T3CODE_WORKBENCH_MAC_SIGNED__", false);
    const harness = makeHarness();
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        assert.equal((yield* updates.getState).enabled, false);
        const reason = yield* updates.disabledReason;
        assert.match(
          Option.getOrElse(reason, () => ""),
          /unsigned.*manual installation/,
        );
        yield* TestClock.adjust(Duration.seconds(15));
        assert.equal(harness.checkCount(), 0);
        assert.equal(harness.listenerCount(), 0);
        assert.equal(harness.quitAndInstalls(), 0);
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect(
    "checks signed Workbench builds and keeps release updates on the Workbench channel",
    () => {
      vi.stubGlobal("__T3CODE_WORKBENCH_BUILD__", true);
      vi.stubGlobal("__T3CODE_WORKBENCH_MAC_SIGNED__", true);
      const harness = makeHarness();
      return Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* DesktopUpdates.DesktopUpdates;
          yield* updates.configure;
          assert.equal((yield* updates.getState).enabled, true);
          yield* updates.setChannel("nightly");
          assert.equal((yield* updates.getState).channel, "latest");
          yield* TestClock.adjust(Duration.seconds(15));
          assert.equal(harness.checkCount(), 1);
          harness.emit("update-available", {
            version: "1.2.4",
            releaseNotes: "Workbench update",
          });
          yield* flushCallbacks;
          assert.equal((yield* updates.getState).status, "available");
          assert.equal(harness.downloadCount(), 0);
          assert.equal(harness.quitAndInstalls(), 0);
        }),
      ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
    },
  );
});
