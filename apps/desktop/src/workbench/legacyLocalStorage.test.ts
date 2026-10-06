import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Hex from "effect/encoding/Hex";
import { afterEach, vi } from "vite-plus/test";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopLegacyLocalStorage from "../app/DesktopLegacyLocalStorage.ts";

vi.mock("electron", () => ({}));

// LevelDB MANIFEST and WAL records with valid masked CRC32C checksums. Each
// profile stores its own sentinel for both native renderer origins.
const decodeFixture = (hex: string) => Result.getOrThrow(Hex.decode(hex));
const manifest = decodeFixture("7612b777060001020303040402");
const workbenchLog = decodeFixture(
  "4f41122d740001010000000000000002000000011b5f7433636f64653a2f2f61707000017433636f64653a7468656d6511016c65676163792d776f726b62656e636801255f7433636f64652d776f726b62656e63683a2f2f61707000017433636f64653a7468656d6511016c65676163792d776f726b62656e6368",
);
const upstreamLog = decodeFixture(
  "05d9944e720001010000000000000002000000011b5f7433636f64653a2f2f61707000017433636f64653a7468656d6510016c65676163792d757073747265616d01255f7433636f64652d776f726b62656e63683a2f2f61707000017433636f64653a7468656d6510016c65676163792d757073747265616d",
);

const writeProfile = Effect.fnUntraced(function* (input: {
  readonly appDataDirectory: string;
  readonly name: string;
  readonly log: Uint8Array;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join(input.appDataDirectory, input.name, "Local Storage", "leveldb");
  yield* fs.makeDirectory(directory, { recursive: true });
  yield* fs.writeFileString(path.join(directory, "CURRENT"), "MANIFEST-000001\n");
  yield* fs.writeFile(path.join(directory, "MANIFEST-000001"), manifest);
  yield* fs.writeFile(path.join(directory, "000003.log"), input.log);
  return directory;
});

const storageLayer = (appDataDirectory: string) =>
  DesktopLegacyLocalStorage.layer.pipe(
    Layer.provide(
      DesktopEnvironment.layer({
        dirname: "/repo/apps/desktop/dist-electron",
        homeDirectory: appDataDirectory,
        platform: "linux",
        processArch: "x64",
        appVersion: "0.0.0",
        appPath: "/repo",
        isPackaged: true,
        resourcesPath: "/repo",
        runningUnderArm64Translation: false,
      }).pipe(Layer.provide(DesktopConfig.layerTest({ XDG_CONFIG_HOME: appDataDirectory }))),
    ),
    Layer.provide(NodeServices.layer),
  );

describe("desktop legacy Local Storage profiles", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.effect(
    "imports the Workbench profile without consuming upstream storage or marking early",
    () =>
      Effect.gen(function* () {
        vi.stubGlobal("__T3CODE_WORKBENCH_BUILD__", true);
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "workbench-local-storage-" });
        const legacy = yield* writeProfile({
          appDataDirectory: root,
          name: "t3code-workbench",
          log: workbenchLog,
        });
        yield* writeProfile({ appDataDirectory: root, name: "t3code", log: upstreamLog });
        const destination = path.join(root, "t3code-workbench-v2");
        const marker = path.join(destination, "v1-local-storage-imported");
        yield* fs.makeDirectory(destination);

        yield* Effect.gen(function* () {
          const storage = yield* DesktopLegacyLocalStorage.DesktopLegacyLocalStorage;
          yield* storage.load(destination);
          assert.deepEqual(Option.getOrThrow(yield* storage.take), {
            "t3code:theme": "legacy-workbench",
          });
          assert.isFalse(yield* fs.exists(marker));
          assert.isTrue(Option.isNone(yield* storage.take));
          yield* storage.complete;
          assert.isTrue(yield* fs.exists(marker));
        }).pipe(Effect.provide(storageLayer(root)));

        assert.deepEqual(yield* fs.readFile(path.join(legacy, "000003.log")), workbenchLog);
        yield* Effect.gen(function* () {
          const storage = yield* DesktopLegacyLocalStorage.DesktopLegacyLocalStorage;
          yield* storage.load(destination);
          assert.isTrue(Option.isNone(yield* storage.take));
        }).pipe(Effect.provide(storageLayer(root)));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect.each(["T3 Code (Alpha)", "t3code"])(
    "preserves native migration from the upstream %s profile",
    (name) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "upstream-local-storage-" });
        yield* writeProfile({ appDataDirectory: root, name, log: upstreamLog });
        yield* writeProfile({
          appDataDirectory: root,
          name: "t3code-workbench",
          log: workbenchLog,
        });
        yield* Effect.gen(function* () {
          const storage = yield* DesktopLegacyLocalStorage.DesktopLegacyLocalStorage;
          yield* storage.load(path.join(root, "t3code-v2"));
          assert.deepEqual(Option.getOrThrow(yield* storage.take), {
            "t3code:theme": "legacy-upstream",
          });
        }).pipe(Effect.provide(storageLayer(root)));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
