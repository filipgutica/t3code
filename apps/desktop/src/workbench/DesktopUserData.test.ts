import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { afterEach, vi } from "vite-plus/test";
import { resolveUserDataPath } from "../app/DesktopUserData.ts";

afterEach(() => vi.unstubAllGlobals());

it.effect("isolates Workbench V2 and recovers only its own Windows credential keys", () =>
  Effect.gen(function* () {
    vi.stubGlobal("__T3CODE_WORKBENCH_BUILD__", true);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "workbench-v2-profile-" });
    const source = path.join(directory, "t3code-workbench");
    const destination = path.join(directory, "t3code-workbench-v2");
    const state = '{"os_crypt":{"encrypted_key":"workbench-test-key"}}';
    yield* fs.makeDirectory(path.join(source, "IndexedDB"), { recursive: true });
    yield* fs.writeFileString(path.join(source, "Local State"), state);
    yield* fs.writeFileString(path.join(source, "IndexedDB", "LOCK"), "V1 owns this database");
    yield* fs.makeDirectory(path.join(directory, "t3code"), { recursive: true });
    yield* fs.writeFileString(path.join(directory, "t3code", "Local State"), "upstream keys");
    const resolved = yield* resolveUserDataPath({
      appDataDirectory: directory,
      isDevelopment: false,
      platform: "win32",
    });
    assert.equal(resolved, destination);
    assert.equal(yield* fs.readFileString(path.join(destination, "Local State")), state);
    assert.isFalse(yield* fs.exists(path.join(destination, "IndexedDB")));
    yield* fs.remove(path.join(destination, "Local State"));
    yield* fs.remove(path.join(source, "Local State"));
    yield* resolveUserDataPath({
      appDataDirectory: directory,
      isDevelopment: false,
      platform: "win32",
    });
    assert.isFalse(yield* fs.exists(path.join(destination, "Local State")));
    const development = yield* resolveUserDataPath({
      appDataDirectory: directory,
      isDevelopment: true,
      platform: "darwin",
    });
    assert.equal(development, source);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
