import { assert, describe, it } from "@effect/vitest";
import { afterEach, vi } from "vite-plus/test";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import { WorkbenchGithubProvider } from "../electron/WorkbenchGithubProvider.ts";
import { flushCallbacks, makeHarness } from "../updates/updatesTestHarness.ts";

describe("Workbench DesktopUpdates", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.effect("configures the Workbench release feed outside mock update mode", () => {
    vi.stubGlobal("__T3CODE_WORKBENCH_BUILD__", true);
    const harness = makeHarness({ env: { T3CODE_DESKTOP_MOCK_UPDATES: "false" } });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        const [feed] = harness.feedUrls();
        if (!feed || typeof feed !== "object" || !("updateProvider" in feed)) {
          assert.fail("Workbench update provider is missing");
        }
        assert.equal(feed.provider, "custom");
        assert.equal(feed.channel, "latest");
        assert.isTrue(Object.is(feed.updateProvider, WorkbenchGithubProvider));
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

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

  it.effect("persists daily opt-in and stable switch-back in signed Workbench builds", () => {
    vi.stubGlobal("__T3CODE_WORKBENCH_BUILD__", true);
    vi.stubGlobal("__T3CODE_WORKBENCH_MAC_SIGNED__", true);
    const harness = makeHarness();
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        const settings = yield* DesktopAppSettings.DesktopAppSettings;
        yield* updates.configure;
        assert.equal((yield* updates.getState).enabled, true);
        yield* updates.setChannel("nightly");
        assert.equal((yield* updates.getState).channel, "nightly");
        assert.equal((yield* settings.get).updateChannel, "nightly");
        yield* TestClock.adjust(Duration.seconds(15));
        assert.equal(harness.checkCount(), 2);
        harness.emit("update-available", {
          version: "1.2.4-nightly.20261007.1",
          releaseNotes: "Workbench update",
        });
        yield* flushCallbacks;
        assert.equal((yield* updates.getState).status, "available");
        assert.equal((yield* updates.getState).availableVersion, "1.2.4-nightly.20261007.1");
        harness.emit("update-available", {
          version: "1.2.4",
          releaseNotes: "Promoted Workbench release",
        });
        yield* flushCallbacks;
        assert.equal((yield* updates.getState).status, "available");
        assert.equal((yield* updates.getState).availableVersion, "1.2.4");
        assert.deepEqual((yield* updates.getState).releaseNotes, [
          { version: "1.2.4", items: ["Promoted Workbench release"], totalItems: 1 },
        ]);
        assert.equal((yield* settings.get).updateChannel, "nightly");
        assert.equal(harness.downloadCount(), 0);
        assert.equal(harness.quitAndInstalls(), 0);
        yield* updates.setChannel("latest");
        assert.equal((yield* updates.getState).channel, "latest");
        assert.equal((yield* settings.get).updateChannel, "latest");
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });
});
