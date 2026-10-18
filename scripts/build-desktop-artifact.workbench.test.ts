import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import { createBuildConfig } from "./build-desktop-artifact.ts";

it.layer(NodeServices.layer)("desktop product metadata", (it) => {
  it.effect("preserves native Debian metadata through desktop product selection", () =>
    Effect.gen(function* () {
      const linux = yield* createBuildConfig(
        "linux",
        "AppImage",
        "1.2.3",
        false,
        false,
        undefined,
        undefined,
      );
      assert.deepStrictEqual(
        (linux.deb as { fpm: string[] }).fpm.map((mapping) => mapping.split("=")[1]),
        ["/usr/share/metainfo/com.t3tools.t3code.metainfo.xml", "/usr/share/doc/t3code/copyright"],
      );
    }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })))),
  );
});
