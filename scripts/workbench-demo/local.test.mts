// @effect-diagnostics nodeBuiltinImport:off - The fixture intentionally invokes Git in a disposable directory.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

import { assert, it } from "@effect/vitest";

import { LOCAL_DEMO_REPOSITORIES, setupLocal, verifyLocal } from "./local.mts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

const git = async (cwd: string, args: ReadonlyArray<string>): Promise<string> =>
  (await execFile("git", args, { cwd })).stdout.trim();

it("creates an idempotent local repository fixture", async () => {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-workbench-demo-"));
  try {
    const first = await setupLocal({
      home,
      now: () => "2026-01-01T00:00:00.000Z",
    });
    await NodeFSP.writeFile(
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
      await NodeFSP.readFile(NodePath.join(home, "projects", "orbit-web", "README.md"), "utf8"),
      "User edit preserved\n",
    );
  } finally {
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
});

it("creates a local origin/main for simulated workspace preparation", async () => {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-workbench-demo-"));
  try {
    await setupLocal({
      home,
      localOriginDirectory: NodePath.join(home, "git-remotes"),
    });
    const repository = NodePath.join(home, "projects", "orbit-web");
    const readOriginMain = async () => {
      const refs = await git(repository, ["ls-remote", "--heads", "origin", "refs/heads/main"]);
      await git(repository, ["fetch", "--quiet", "origin", "main"]);
      return {
        refs,
        trackingHead: await git(repository, ["rev-parse", "refs/remotes/origin/main"]),
      };
    };
    const first = await readOriginMain();
    await setupLocal({
      home,
      localOriginDirectory: NodePath.join(home, "git-remotes"),
    });
    const second = await readOriginMain();

    assert.match(first.refs, /^[a-f0-9]{40}\s+refs\/heads\/main$/);
    assert.match(first.trackingHead, /^[a-f0-9]{40}$/);
    assert.equal(second.refs, first.refs);
    assert.equal(second.trackingHead, first.trackingHead);
  } finally {
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
});

it("leaves configured repository origins unchanged", async () => {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-workbench-demo-"));
  try {
    await setupLocal({ home });
    const repository = NodePath.join(home, "projects", "orbit-web");
    const remote = "https://example.invalid/orbit-web.git";
    await git(repository, ["remote", "add", "origin", remote]);

    await setupLocal({
      home,
      localOriginDirectory: NodePath.join(home, "git-remotes"),
      repositoryRemotes: { "orbit-web": remote },
    });

    assert.equal(await git(repository, ["remote", "get-url", "origin"]), remote);
  } finally {
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
});
