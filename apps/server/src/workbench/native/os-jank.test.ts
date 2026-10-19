import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as Effect from "effect/Effect";
import * as NodeOS from "node:os";
import { assert } from "vite-plus/test";

import { fixPath } from "../../os-jank.ts";

effectIt.effect(
  "keeps an explicit executable directory ahead of login shell PATH hydration",
  () => {
    const env: NodeJS.ProcessEnv = {
      HOME: NodeOS.homedir(),
      SHELL: "/bin/sh",
      PATH: "/usr/bin",
      T3CODE_PATH_PREPEND: "/demo/attention-bin",
    };

    return Effect.gen(function* () {
      yield* fixPath();
      assert.equal(env.PATH?.split(":")[0], "/demo/attention-bin");
    }).pipe(
      Effect.provideService(HostProcess.Environment, env),
      Effect.provideService(HostProcess.Platform, "darwin"),
      Effect.provide(NodeServices.layer),
    );
  },
);
