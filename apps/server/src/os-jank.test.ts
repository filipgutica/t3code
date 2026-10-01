import * as NodeOS from "node:os";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import { assert, it } from "@effect/vitest";

import { fixPath, hydratePosixHome } from "./os-jank.ts";

it("hydrates HOME for minimal service environments from the user account", () => {
  const env: NodeJS.ProcessEnv = {};

  hydratePosixHome(env);

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("hydrates HOME independently of a blank process HOME", () => {
  const originalHome = process.env.HOME;
  const env: NodeJS.ProcessEnv = { HOME: " " };

  try {
    process.env.HOME = " ";
    hydratePosixHome(env);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("preserves an explicitly configured HOME", () => {
  const env: NodeJS.ProcessEnv = { HOME: "/custom/home" };

  hydratePosixHome(env, () => {
    throw new Error("HOME lookup should not run");
  });

  assert.equal(env.HOME, "/custom/home");
});

it.effect("keeps an explicit executable directory ahead of login shell PATH hydration", () => {
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
    Effect.provideService(HostProcessEnvironment, env),
    Effect.provideService(HostProcessPlatform, "darwin"),
    Effect.provide(NodeServices.layer),
  );
});
