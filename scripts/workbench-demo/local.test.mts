// @effect-diagnostics nodeBuiltinImport:off - The fixture intentionally invokes Git in a disposable directory.
import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";

import { assert, it } from "@effect/vitest";

import { LOCAL_DEMO_REPOSITORIES, setupLocal, verifyLocal } from "./local.mts";

it("creates an idempotent local repository fixture", async () => {
  const home = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-workbench-demo-"));
  try {
    const first = await setupLocal({
      home,
      now: () => "2026-01-01T00:00:00.000Z",
    });
    await NodeFS.writeFile(
      NodePath.join(home, "projects", "orbit-web", "README.md"),
      "User edit preserved\n",
    );
    const second = await setupLocal({
      home,
      now: () => "2026-01-01T00:00:01.000Z",
    });
    const verification = await verifyLocal({ home });

    assert.deepStrictEqual(first.projects, second.projects);
    assert.equal(verification.repositoryCount, LOCAL_DEMO_REPOSITORIES.length);
    assert.equal(verification.repositoryHeadCount, LOCAL_DEMO_REPOSITORIES.length);
    assert.deepStrictEqual(verification.expectedWorkbenchCounts, {
      projects: 2,
      epics: 4,
      tickets: 16,
      assignments: 4,
    });
    assert.equal(
      await NodeFS.readFile(NodePath.join(home, "projects", "orbit-web", "README.md"), "utf8"),
      "User edit preserved\n",
    );
  } finally {
    await NodeFS.rm(home, { recursive: true, force: true });
  }
});
