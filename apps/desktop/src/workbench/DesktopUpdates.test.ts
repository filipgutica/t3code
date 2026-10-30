import { assert, describe, it } from "@effect/vitest";
import { afterEach, vi } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import { WorkbenchGithubProvider } from "./WorkbenchGithubProvider.ts";
import { makeHarness } from "../updates/updatesTestHarness.ts";

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

  it.effect(
    "keeps same-track Stable promotion under a saved Nightly preference and safely restores Stable",
    () => {
      vi.stubGlobal("__T3CODE_WORKBENCH_BUILD__", true);
      vi.stubGlobal("__T3CODE_WORKBENCH_MAC_SIGNED__", true);
      const harness = makeHarness({ savedChannel: "nightly" });
      return Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* DesktopUpdates.DesktopUpdates;
          const settings = yield* DesktopAppSettings.DesktopAppSettings;
          yield* updates.configure;
          assert.equal((yield* updates.getState).enabled, true);
          assert.equal((yield* updates.getState).channel, "nightly");
          assert.equal((yield* settings.get).updateChannel, "nightly");
          yield* updates.check("manual");
          yield* TestClock.adjust(Duration.seconds(15));
          assert.equal(harness.checkCount(), 2);
          yield* harness.emitAndWait("update-available", {
            version: "1.2.4",
            releaseNotes: "Promoted Workbench release",
          });
          assert.equal((yield* updates.getState).status, "available");
          assert.equal((yield* updates.getState).availableVersion, "1.2.4");
          assert.deepEqual((yield* updates.getState).releaseNotes, [
            { version: "1.2.4", items: ["Promoted Workbench release"], totalItems: 1 },
          ]);
          assert.equal((yield* settings.get).updateChannel, "nightly");
          assert.equal(harness.downloadCount(), 0);
          assert.equal(harness.quitAndInstalls(), 0);
          assert.deepEqual(harness.checkAllowedDowngrade, [false, false]);
          yield* updates.setChannel("latest");
          assert.equal((yield* updates.getState).channel, "latest");
          assert.equal((yield* settings.get).updateChannel, "latest");
          assert.isFalse(harness.allowDowngrade());
        }),
      ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
    },
  );

  it.effect.each([
    {
      name: "Stable to Nightly without a floor",
      appVersion: "1.2.3",
      savedChannel: "latest" as const,
      requestedChannel: "nightly" as const,
      minimumVersion: null,
    },
    {
      name: "Stable to Nightly with an upstream Nightly floor",
      appVersion: "1.2.3",
      savedChannel: "latest" as const,
      requestedChannel: "nightly" as const,
      minimumVersion: "1.2.4-nightly.20261007.1",
    },
    {
      name: "Nightly to Stable without a floor",
      appVersion: "1.2.4-nightly.20261007.1",
      savedChannel: "nightly" as const,
      requestedChannel: "latest" as const,
      minimumVersion: null,
    },
    {
      name: "Nightly to Stable with an upstream Stable floor",
      appVersion: "1.2.4-nightly.20261007.1",
      savedChannel: "nightly" as const,
      requestedChannel: "latest" as const,
      minimumVersion: "1.2.4",
    },
    {
      name: "Stable promotion floor on an unchanged Nightly preference",
      appVersion: "1.2.4-nightly.20261007.1",
      savedChannel: "nightly" as const,
      requestedChannel: "nightly" as const,
      minimumVersion: "1.2.4",
      retainedVersion: "1.2.4-nightly.20261008.1",
    },
    {
      name: "Nightly floor on an unchanged Nightly preference",
      appVersion: "1.2.4-nightly.20261007.1",
      savedChannel: "nightly" as const,
      requestedChannel: "nightly" as const,
      minimumVersion: "9.0.0-nightly.20261008.1",
    },
    {
      name: "Stable floor on a saved Nightly preference after a Stable restart",
      appVersion: "1.2.3",
      savedChannel: "nightly" as const,
      requestedChannel: "nightly" as const,
      minimumVersion: "9.0.0",
    },
    {
      name: "Stable floor on an unchanged Stable track",
      appVersion: "1.2.3",
      savedChannel: "latest" as const,
      requestedChannel: "latest" as const,
      minimumVersion: "9.0.0",
    },
  ])(
    "refuses an unverified Workbench track switch without side effects: $name",
    ({ appVersion, savedChannel, requestedChannel, minimumVersion, retainedVersion }) => {
      vi.stubGlobal("__T3CODE_WORKBENCH_BUILD__", true);
      vi.stubGlobal("__T3CODE_WORKBENCH_MAC_SIGNED__", true);
      let settingsWrites = 0;
      const harness = makeHarness({
        appVersion,
        savedChannel,
        beforeSetUpdateChannel: Effect.sync(() => {
          settingsWrites += 1;
        }),
      });
      return Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* DesktopUpdates.DesktopUpdates;
          const settings = yield* DesktopAppSettings.DesktopAppSettings;
          yield* updates.configure;
          if (retainedVersion !== undefined) {
            yield* harness.emitAndWait("update-available", { version: retainedVersion });
            assert.equal((yield* updates.getState).availableVersion, retainedVersion);
            yield* harness.emitAndWait("update-downloaded", { version: retainedVersion });
            assert.equal((yield* updates.getState).status, "downloaded");
            assert.equal((yield* updates.getState).downloadedVersion, retainedVersion);
          }
          const stateBefore = yield* updates.getState;
          const settingsBefore = yield* settings.get;
          const checksBefore = harness.checkCount();
          const feedsBefore = harness.feedUrls().length;
          const changelogBefore = harness.fullChangelog();
          const checksAllowedDowngradeBefore = [...harness.checkAllowedDowngrade];
          const sentStatesBefore = harness.sentStates.length;
          assert.isFalse(yield* updates.isActionActive);
          assert.isFalse(yield* updates.isInstallActive);

          const result = yield* Effect.exit(
            updates.setChannel(
              requestedChannel,
              minimumVersion === null ? undefined : { minimumVersion },
            ),
          );
          if (Exit.isSuccess(result))
            return assert.fail("Unverified Workbench track switch was accepted.");
          const failure = Option.getOrThrow(Cause.findErrorOption(result.cause));
          assert.equal(failure._tag, "DesktopUpdateChannelCompatibilityError");
          assert.match(failure.message, /Workbench.*compatibility/);
          assert.deepEqual(yield* updates.getState, stateBefore);
          assert.deepEqual(yield* settings.get, settingsBefore);
          assert.equal(settingsWrites, 0);
          assert.equal(harness.checkCount(), checksBefore);
          assert.equal(harness.feedUrls().length, feedsBefore);
          assert.equal(harness.fullChangelog(), changelogBefore);
          assert.deepEqual(harness.checkAllowedDowngrade, checksAllowedDowngradeBefore);
          assert.equal(harness.sentStates.length, sentStatesBefore);
          assert.isFalse(harness.allowDowngrade());
          assert.isFalse(yield* updates.isActionActive);
          assert.isFalse(yield* updates.isInstallActive);
          assert.equal(harness.downloadCount(), 0);
          assert.equal(harness.quitAndInstalls(), 0);
          assert.deepEqual(harness.installSteps, []);

          const runningNightly = appVersion.includes("-nightly.");
          const crossing = runningNightly ? "1.2.4" : "1.2.4-nightly.20261007.1";
          const sameTrack = runningNightly ? "1.2.5-nightly.20261008.1" : "1.2.4";
          yield* harness.emitAndWait("update-available", { version: crossing });
          assert.equal((yield* updates.getState).availableVersion, retainedVersion ?? null);
          yield* harness.emitAndWait("download-progress", { percent: 40 });
          yield* harness.emitAndWait("update-downloaded", { version: crossing });
          assert.equal((yield* updates.getState).downloadedVersion, retainedVersion ?? null);
          yield* harness.emitAndWait("update-available", { version: sameTrack });
          assert.equal((yield* updates.getState).availableVersion, sameTrack);
          yield* harness.emitAndWait("update-downloaded", { version: sameTrack });
          assert.equal((yield* updates.getState).downloadedVersion, sameTrack);
          assert.equal((yield* settings.get).updateChannel, savedChannel);
          assert.equal(harness.downloadCount(), 0);
          assert.equal(harness.quitAndInstalls(), 0);
        }),
      ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
    },
  );
});
