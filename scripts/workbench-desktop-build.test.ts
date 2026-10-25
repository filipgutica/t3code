import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { createBuildConfig } from "./build-desktop-artifact.ts";
import { selectWorkbenchDesktopBuildProduct } from "./lib/workbench-desktop-product.ts";

it.layer(NodeServices.layer)("Workbench desktop packaging", (it) => {
  it.effect("uses package.json for the Node version in Workbench release workflows", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      for (const filename of [
        "workbench-release.yml",
        "workbench-daily-release.yml",
        "workbench-publish-stable.yml",
      ]) {
        const workflow = yield* fs.readFileString(
          `${import.meta.dirname}/../.github/workflows/${filename}`,
        );
        assert.notMatch(workflow, /VP_NODE_VERSION/, filename);
        assert.notMatch(workflow, /^\s*node-version:/m, filename);
        // Steps may start with `- uses:` or carry quoted values and trailing comments.
        const setupSteps = workflow
          .split(/\n(?=\s*- )/)
          .filter((step) =>
            /^[\s-]*uses:\s*["']?(?:voidzero-dev\/setup-vp|actions\/setup-node)@/m.test(step),
          );
        assert.isNotEmpty(setupSteps, filename);
        for (const step of setupSteps) {
          assert.match(
            step,
            /^\s*node-version-file:\s*(["']?)package\.json\1\s*(?:#.*)?$/m,
            `${filename}: ${step}`,
          );
        }
      }
    }),
  );

  it("keeps the Workbench updater cache separate from official T3 Code", () => {
    const input = { updateChannel: "latest", platform: "mac", signed: false } as const;
    assert.isNull(selectWorkbenchDesktopBuildProduct({ ...input, workbench: false }));
    const product = selectWorkbenchDesktopBuildProduct({ ...input, workbench: true });
    assert.equal(product?.packageName, "t3code-workbench");
  });

  it.effect("packages Workbench with its own install identity and release update metadata", () =>
    Effect.gen(function* () {
      const config = yield* createBuildConfig(
        "mac",
        "dmg",
        "0.1.0",
        false,
        false,
        undefined,
        undefined,
      );
      const linux = yield* createBuildConfig(
        "linux",
        "AppImage",
        "0.1.0",
        false,
        false,
        undefined,
        undefined,
      );
      const signedNightly = yield* createBuildConfig(
        "mac",
        "dmg",
        "0.1.0-nightly.20261007.42",
        true,
        false,
        undefined,
        undefined,
      );
      assert.equal(config.appId, "com.filipgutica.t3code.workbench");
      assert.equal(config.productName, "T3 Code Workbench");
      assert.equal(config.artifactName, "T3-Code-Workbench-${version}-${arch}.${ext}");
      assert.deepInclude(config.mac, {
        protocols: [
          { name: "T3 Code Workbench", schemes: ["t3code-workbench"] },
          { name: "Web site URL", schemes: ["http", "https"], role: "Viewer" },
        ],
      });
      assert.deepInclude(linux.linux, {
        target: ["AppImage"],
        executableName: "t3code-workbench",
      });
      assert.notProperty(linux.deb, "fpm");
      assert.deepStrictEqual(config.publish, [
        {
          provider: "github",
          owner: "filipgutica",
          repo: "t3code",
          channel: "latest",
          releaseType: "prerelease",
        },
      ]);
      assert.deepStrictEqual(signedNightly.publish, [
        {
          provider: "github",
          owner: "filipgutica",
          repo: "t3code",
          channel: "nightly",
          releaseType: "prerelease",
        },
      ]);
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: {
              T3CODE_WORKBENCH_BUILD: "1",
              T3CODE_DESKTOP_UPDATE_REPOSITORY: "filipgutica/t3code",
            },
          }),
        ),
      ),
    ),
  );
  it.effect("ad-hoc signs Workbench Mac previews without Developer ID or notarization", () =>
    Effect.gen(function* () {
      const config = yield* createBuildConfig(
        "mac",
        "dmg",
        "0.0.3",
        false,
        false,
        undefined,
        undefined,
      );
      const mac = config.mac as Record<string, unknown>;

      assert.equal(mac.identity, "-");
      assert.equal(mac.hardenedRuntime, false);
      assert.equal(mac.notarize, false);
      assert.notProperty(mac, "sign");
      assert.notProperty(config, "forceCodeSigning");
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { T3CODE_WORKBENCH_BUILD: "1" } })),
      ),
    ),
  );

  it.effect("signs Workbench macOS builds without upstream passkey entitlements", () =>
    Effect.gen(function* () {
      const config = yield* createBuildConfig(
        "mac",
        "dmg",
        "1.2.3",
        true,
        false,
        undefined,
        undefined,
      );
      const mac = config.mac as Record<string, unknown>;

      assert.equal(config.appId, "com.filipgutica.t3code.workbench");
      assert.equal(config.productName, "T3 Code Workbench");
      assert.match(String(mac.sign), /[\\/]scripts[\\/]sign-macos\.ts$/);
      assert.equal(mac.hardenedRuntime, true);
      assert.equal(config.forceCodeSigning, true);
      assert.notProperty(mac, "entitlements");
      assert.notProperty(mac, "provisioningProfile");
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { T3CODE_WORKBENCH_BUILD: "1" } })),
      ),
    ),
  );
});
