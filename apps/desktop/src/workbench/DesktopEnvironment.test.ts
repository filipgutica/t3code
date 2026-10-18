import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { afterEach, vi } from "vite-plus/test";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopBackendConfiguration from "../backend/DesktopBackendConfiguration.ts";
import * as DesktopServerExposure from "../backend/DesktopServerExposure.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopShellEnvironment from "../shell/DesktopShellEnvironment.ts";
import * as DesktopWslEnvironment from "../wsl/DesktopWslEnvironment.ts";
import * as DesktopWslServerTree from "../wsl/DesktopWslServerTree.ts";

afterEach(() => vi.unstubAllGlobals());

const layerEnvironment = (
  homeDirectory = "/Users/alice",
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/dist-electron",
    homeDirectory,
    platform: "darwin",
    processArch: "arm64",
    appVersion: "0.0.22",
    appPath: "/Applications/T3 Code.app/Contents/Resources/app.asar",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, NodePath.layerPosix, DesktopConfig.layerTest(env)),
    ),
  );

it.effect("isolates packaged Workbench identity and saved data from official T3 Code", () =>
  Effect.gen(function* () {
    vi.stubGlobal("__T3CODE_WORKBENCH_BUILD__", true);
    const environment = yield* DesktopEnvironment.DesktopEnvironment.pipe(
      Effect.provide(layerEnvironment()),
    );
    assert.equal(environment.displayName, "T3 Code Workbench");
    assert.equal(environment.baseDir, "/Users/alice/.t3-workbench");
    assert.equal(environment.stateDir, "/Users/alice/.t3-workbench/userdata");
    assert.equal(environment.appUserModelId, "com.filipgutica.t3code.workbench");
    assert.equal(environment.linuxWmClass, "t3code-workbench");
    assert.equal(environment.linuxDesktopEntryName, "com.filipgutica.t3code.workbench.desktop");
  }),
);

it.effect("Workbench WSL uses its own Linux home for persisted state", () =>
  Effect.gen(function* () {
    vi.stubGlobal("__T3CODE_WORKBENCH_BUILD__", true);
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "workbench-desktop-" });
    const configuration = yield* DesktopBackendConfiguration.DesktopBackendConfiguration.pipe(
      Effect.provide(
        DesktopBackendConfiguration.layer.pipe(
          Layer.provide(
            Layer.succeed(DesktopShellEnvironment.DesktopShellEnvironment, {
              installIntoProcess: Effect.succeed(true),
            }),
          ),
          Layer.provide(
            Layer.succeed(DesktopServerExposure.DesktopServerExposure, {
              getState: Effect.die("unexpected getState"),
              backendConfig: Effect.die("unexpected backendConfig"),
              configureFromSettings: () => Effect.die("unexpected configureFromSettings"),
              setMode: () => Effect.die("unexpected setMode"),
              setTailscaleServeEnabled: () => Effect.die("unexpected setTailscaleServeEnabled"),
              getAdvertisedEndpoints: Effect.succeed([]),
            }),
          ),
          Layer.provide(DesktopAppSettings.layerTest()),
          Layer.provide(DesktopWslEnvironment.layerTest()),
          Layer.provide(DesktopWslServerTree.layerTest()),
          Layer.provide(layerEnvironment(baseDir, { T3CODE_HOME: baseDir })),
        ),
      ),
    );
    const wsl = yield* configuration.resolveWsl({ port: 5000, distro: null });
    assert.equal(wsl.bootstrap.t3Home, "~/.t3-workbench");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
