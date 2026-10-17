// @effect-diagnostics nodeBuiltinImport:off - Exercise Git's non-force ref update in a disposable repository.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";

import {
  validateVerifiedSyncPullRequest,
  type VerifiedSyncMergeInput,
  type VerifiedSyncPullRequest,
} from "./workbench-upstream-sync-merge.ts";

const pullRequest: VerifiedSyncPullRequest = {
  number: 42,
  state: "open",
  draft: false,
  merged: false,
  base: {
    ref: "main",
    sha: "product-sha",
    repository: "filipgutica/t3code",
  },
  head: {
    ref: "automation/workbench-upstream-sync",
    sha: "verified-sha",
    repository: "filipgutica/t3code",
  },
};

interface PullRequestOverrides {
  readonly state?: string;
  readonly draft?: boolean;
  readonly merged?: boolean;
  readonly base?: Partial<VerifiedSyncPullRequest["base"]>;
  readonly head?: Partial<VerifiedSyncPullRequest["head"]>;
}

const input = (overrides: PullRequestOverrides = {}): VerifiedSyncMergeInput => ({
  pullRequest: {
    number: pullRequest.number,
    state: overrides.state ?? pullRequest.state,
    draft: overrides.draft ?? pullRequest.draft,
    merged: overrides.merged ?? pullRequest.merged,
    base: { ...pullRequest.base, ...overrides.base },
    head: { ...pullRequest.head, ...overrides.head },
  },
  repository: "filipgutica/t3code",
  productBranch: "main",
  syncBranch: "automation/workbench-upstream-sync",
  productSha: "product-sha",
  verifiedSha: "verified-sha",
});

const assertError = (error: string | undefined, pattern: RegExp) => {
  if (error === undefined) throw new Error("Expected sync PR validation to fail");
  assert.match(error, pattern);
};

const git = (cwd: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const withMergeRemote = (
  test: (fixture: {
    repository: string;
    remote: string;
    sha: string;
    staleSha: string;
    run: () => NodeChildProcess.SpawnSyncReturns<string>;
    publishAfterAdvertisements: (count: number) => void;
  }) => void,
) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sync-merge-ref-"));
  const remote = NodePath.join(root, "remote.git");
  const repository = NodePath.join(root, "repository");
  try {
    git(root, ["init", "--bare", remote]);
    git(root, ["init", "--initial-branch=main", repository]);
    git(repository, ["config", "user.name", "Sync Test"]);
    git(repository, ["config", "user.email", "sync-test@example.invalid"]);
    NodeFS.writeFileSync(NodePath.join(repository, "file.txt"), "product\n");
    git(repository, ["add", "file.txt"]);
    git(repository, ["commit", "-m", "product"]);
    const productSha = git(repository, ["rev-parse", "HEAD"]);
    git(repository, ["switch", "-c", "sync"]);
    NodeFS.writeFileSync(NodePath.join(repository, "file.txt"), "previous sync\n");
    git(repository, ["commit", "-am", "previous sync"]);
    const previousVerifiedSha = git(repository, ["rev-parse", "HEAD"]);
    const staleSha = git(repository, [
      "commit-tree",
      `${previousVerifiedSha}^{tree}`,
      "-p",
      productSha,
      "-p",
      previousVerifiedSha,
      "-m",
      "previous PR merge",
    ]);
    NodeFS.writeFileSync(NodePath.join(repository, "file.txt"), "verified sync\n");
    git(repository, ["commit", "-am", "verified sync"]);
    const verifiedSha = git(repository, ["rev-parse", "HEAD"]);
    const sha = git(repository, [
      "commit-tree",
      `${verifiedSha}^{tree}`,
      "-p",
      productSha,
      "-p",
      verifiedSha,
      "-m",
      "PR merge",
    ]);
    git(repository, ["remote", "add", "origin", remote]);
    git(repository, [
      "push",
      "origin",
      "main",
      `${sha}:refs/heads/current-merge`,
      `${staleSha}:refs/heads/previous-merge`,
    ]);
    const clock = NodePath.join(root, "clock.mjs");
    NodeFS.writeFileSync(
      clock,
      `import timers from "node:timers/promises";\nimport { syncBuiltinESMExports } from "node:module";\ntimers.setTimeout = async () => undefined;\nsyncBuiltinESMExports();\n`,
    );
    const run = () =>
      NodeChildProcess.spawnSync(
        process.execPath,
        [
          "--import",
          clock,
          NodePath.join(import.meta.dirname, "workbench-upstream-sync-merge.ts"),
          "--wait-for-merge-ref",
          "42",
          "--product-sha",
          productSha,
          "--verified-sha",
          verifiedSha,
        ],
        { cwd: repository, encoding: "utf8" },
      );
    const publishAfterAdvertisements = (count: number) => {
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
      const uploadPack = NodePath.join(root, "publish-merge-ref.sh");
      const counter = quote(NodePath.join(root, "advertisements"));
      NodeFS.writeFileSync(
        uploadPack,
        `#!/bin/sh\nset -e\ngit-upload-pack "$@"\ncount=0\nif [ -f ${counter} ]; then read -r count < ${counter}; fi\ncount=$((count + 1))\nprintf '%s\\n' "$count" > ${counter}\nif [ "$count" -ge ${count} ]; then\n  git --git-dir=${quote(remote)} update-ref refs/pull/42/merge ${quote(sha)}\nfi\n`,
        { mode: 0o755 },
      );
      git(repository, ["config", "remote.origin.uploadpack", quote(uploadPack)]);
    };
    test({ repository, remote, sha, staleSha, run, publishAfterAdvertisements });
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
};

describe("fetchPullRequestMergeRef", () => {
  it("returns the advertised PR merge commit through the workflow CLI", () => {
    withMergeRemote(({ repository, remote, sha, run }) => {
      git(remote, ["update-ref", "refs/pull/42/merge", sha]);
      const result = run();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), sha);
      assert.equal(git(repository, ["rev-parse", "FETCH_HEAD"]), sha);
    });
  });

  it("waits for the PR merge ref to appear after the first remote advertisement", () => {
    withMergeRemote(({ repository, sha, run, publishAfterAdvertisements }) => {
      publishAfterAdvertisements(1);
      const result = run();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), sha);
      assert.equal(git(repository, ["rev-parse", "FETCH_HEAD"]), sha);
    });
  });

  it("waits for an existing PR merge ref to reach the verified parents", () => {
    withMergeRemote(({ repository, remote, sha, staleSha, run, publishAfterAdvertisements }) => {
      git(remote, ["update-ref", "refs/pull/42/merge", staleSha]);
      publishAfterAdvertisements(2);
      const result = run();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), sha);
      assert.equal(git(repository, ["rev-parse", "FETCH_HEAD"]), sha);
    });
  });

  it("rejects a merge ref that never reaches the verified parents", () => {
    withMergeRemote(({ remote, staleSha, run }) => {
      git(remote, ["update-ref", "refs/pull/42/merge", staleSha]);
      const result = run();
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /merge ref refs\/pull\/42\/merge.*verified parents/);
      assert.equal(result.stdout, "");
    });
  });

  it("rejects an unpublished merge ref instead of returning an earlier fetch", () => {
    withMergeRemote(({ repository, run }) => {
      git(repository, ["fetch", "origin", "main"]);
      const result = run();
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /merge ref refs\/pull\/42\/merge was not published/);
      assert.equal(result.stdout, "");
    });
  });
});

describe("validateVerifiedSyncPullRequest", () => {
  it("accepts the exact open verified sync PR", () => {
    assert.equal(validateVerifiedSyncPullRequest(input()), undefined);
  });

  it("rejects a changed product base", () => {
    assertError(
      validateVerifiedSyncPullRequest(input({ base: { sha: "new-product-sha" } })),
      /product branch changed/,
    );
  });

  it("rejects a changed sync head", () => {
    assertError(
      validateVerifiedSyncPullRequest(input({ head: { sha: "new-verified-sha" } })),
      /sync branch changed/,
    );
  });

  it("rejects a draft, closed, or fork-owned PR", () => {
    assertError(validateVerifiedSyncPullRequest(input({ draft: true })), /draft/);
    assertError(validateVerifiedSyncPullRequest(input({ state: "closed" })), /not open/);
    assertError(
      validateVerifiedSyncPullRequest(input({ head: { repository: "someone/fork" } })),
      /head repository changed/,
    );
  });

  it("rejects publishing a verified merge after the product base advances", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-workbench-sync-test-"));
    const remote = NodePath.join(root, "remote.git");
    const repository = NodePath.join(root, "repository");
    try {
      git(root, ["init", "--bare", remote]);
      git(root, ["init", "--initial-branch=main", repository]);
      git(repository, ["config", "user.name", "Sync Test"]);
      git(repository, ["config", "user.email", "sync-test@example.invalid"]);
      NodeFS.writeFileSync(NodePath.join(repository, "file.txt"), "product\n");
      git(repository, ["add", "file.txt"]);
      git(repository, ["commit", "-m", "product"]);
      const productSha = git(repository, ["rev-parse", "HEAD"]);
      git(repository, ["remote", "add", "origin", remote]);
      git(repository, ["push", "origin", "main"]);

      git(repository, ["switch", "-c", "upstream"]);
      NodeFS.writeFileSync(NodePath.join(repository, "file.txt"), "upstream\n");
      git(repository, ["commit", "-am", "upstream"]);
      git(repository, ["switch", "main"]);
      git(repository, ["merge", "--no-ff", "--no-edit", "upstream"]);
      const verifiedSha = git(repository, ["rev-parse", "HEAD"]);
      git(repository, ["update-ref", "refs/heads/main", productSha]);
      git(repository, ["switch", "main"]);
      NodeFS.writeFileSync(NodePath.join(repository, "file.txt"), "product follow-up\n");
      git(repository, ["commit", "-am", "product follow-up"]);
      git(repository, ["push", "origin", "main"]);

      const result = NodeChildProcess.spawnSync(
        "git",
        ["push", "origin", `${verifiedSha}:refs/heads/main`],
        { cwd: repository, encoding: "utf8" },
      );
      assert.notEqual(result.status, 0);
      assert.equal(
        git(repository, ["ls-remote", "origin", "refs/heads/main"]),
        `${git(repository, ["rev-parse", "HEAD"])}\trefs/heads/main`,
      );
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});
