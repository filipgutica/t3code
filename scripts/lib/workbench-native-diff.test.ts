// @effect-diagnostics nodeBuiltinImport:off - Exercise patch accounting against real Git trees.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, it } from "@effect/vitest";
import { collectNativeDiff, renderNativeDiff } from "./workbench-native-diff.ts";

const fixture = (
  body: (input: {
    root: string;
    upstream: string;
    base: string;
    write: (path: string, content: string) => void;
    git: (args: ReadonlyArray<string>) => string;
    commit: () => string;
  }) => void,
) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-native-diff-"));
  const git = (args: ReadonlyArray<string>) =>
    NodeChildProcess.execFileSync("git", [...args], { cwd: root, encoding: "utf8" }).trim();
  const write = (path: string, content: string) => {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, path), content);
  };
  const commit = () => {
    git(["add", "."]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "fixture",
    ]);
    return git(["rev-parse", "HEAD"]);
  };
  try {
    git(["init", "-q"]);
    write("apps/server/src/native.ts", "export const upstream = 1;\n");
    write("apps/server/src/native.test.ts", "upstream test\n");
    write("pnpm-lock.yaml", "upstream lock\n");
    const upstream = commit();
    write("scripts/workbench-ci-scope.json", JSON.stringify({ upstreamBase: upstream }));
    write("scripts/workbench-isolation-policy.json", '{"integrations":[]}');
    write("apps/server/src/native.ts", "export const upstream = 1;\nexport const fork = 2;\n");
    const base = commit();
    body({ root, upstream, base, write, git, commit });
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
};

it("reports inline policy growth and native tests without new imports, using exact endpoints", () =>
  fixture(({ root, base, write, commit }) => {
    write(
      "apps/server/src/native.ts",
      "export const upstream = 1;\nexport const fork = 2;\nexport const policy = 3;\n",
    );
    write("apps/server/src/native.test.ts", "upstream test\nfork test\n");
    const head = commit();
    write("apps/server/src/native.ts", "uncommitted content must not count\n");
    const report = collectNativeDiff({ root, base, head });
    const source = report.files.find((file) => file.path.endsWith("native.ts"));
    assert.deepEqual(source?.pr, { added: 1, deleted: 0, binary: false });
    assert.deepEqual(source?.base, { added: 1, deleted: 0, binary: false });
    assert.deepEqual(source?.head, { added: 2, deleted: 0, binary: false });
    assert.equal(source?.growth, 1);
    assert.equal(report.files.find((file) => file.path.endsWith("native.test.ts"))?.growth, 1);
    assert.include(renderNativeDiff(report), "**GROWTH +1**");
  }));

it("adds native diff JSON to the isolation report and exits zero on growth", () =>
  fixture(({ root, base, write, commit }) => {
    write(
      "apps/server/src/native.ts",
      "export const upstream = 1;\nexport const fork = 2;\nexport const policy = 3;\n",
    );
    const head = commit();
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      [
        NodePath.resolve(import.meta.dirname, "../workbench-isolation.ts"),
        "--report",
        "--base",
        base,
        "--head",
        head,
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.importSites, 0);
    assert.equal(report.nativeDiff.head, head);
    assert.equal(report.nativeDiff.files[0].growth, 1);
  }));

it("accounts for both rename paths and deletions, including moves into the fork boundary", () =>
  fixture(({ root, base, git, commit }) => {
    git(["mv", "apps/server/src/native.ts", "apps/server/src/renamed.ts"]);
    git(["rm", "apps/server/src/native.test.ts"]);
    const report = collectNativeDiff({ root, base, head: commit() });
    assert.equal(report.files.length, 3);
    const removed = report.files.find((file) => file.path.endsWith("native.ts"));
    assert.equal(removed?.change, "deleted");
    assert.deepEqual(removed?.pr, { added: 0, deleted: 2, binary: false });
    assert.deepEqual(removed?.head, { added: 0, deleted: 1, binary: false });
    assert.equal(
      report.files.find((file) => file.path.endsWith("renamed.ts"))?.newOutsideBoundary,
      true,
    );
    assert.deepEqual(report.files.find((file) => file.path.endsWith("native.test.ts"))?.head, {
      added: 0,
      deleted: 1,
      binary: false,
    });
    git(["mv", "apps/server/src/renamed.ts", "scripts/workbench-moved.ts"]);
    const move = collectNativeDiff({ root, base, head: commit() });
    assert.deepEqual(
      move.files.map((file) => file.path),
      ["apps/server/src/native.test.ts", "apps/server/src/native.ts"],
    );
  }));

it("labels fork additions, new paths and generated locks while excluding fork-owned files", () =>
  fixture(({ root, base, write, commit }) => {
    write("apps/server/src/fork-only.ts", "fork addition\n");
    write("pnpm-lock.yaml", "upstream lock\nnew resolution\n");
    write("apps/server/src/workbench/feature.ts", "fork owned\n");
    write("scripts/lib/workbench-feature.ts", "fork tooling\n");
    write(".github/workflows/workbench-example.yml", "fork workflow\n");
    write("docs/internals/workbench-example.md", "fork docs\n");
    const report = collectNativeDiff({ root, base, head: commit() });
    assert.deepEqual(
      report.files.map((file) => [file.path, file.kind]),
      [
        ["apps/server/src/fork-only.ts", "fork-added outside boundary"],
        ["pnpm-lock.yaml", "generated lockfile"],
      ],
    );
    assert.equal(report.files[0]?.newOutsideBoundary, true);
    assert.include(renderNativeDiff(report), "**NEW PATH**");
  }));

it("uses the head policy baseline, verifies integration, and warns when base predates it", () =>
  fixture(({ root, upstream, base, write, git, commit }) => {
    write("scripts/workbench-ci-scope.json", JSON.stringify({ upstreamBase: base }));
    write("apps/server/src/native.ts", "export const upstream = 1;\nexport const fork = 2;\nnew\n");
    const head = commit();
    const report = collectNativeDiff({ root, base: upstream, head });
    assert.equal(report.upstream, base);
    assert.equal(report.baselineIntegratedAtBase, false);
    assert.include(renderNativeDiff(report), "Baseline is not integrated at base");
    assert.deepEqual(
      collectNativeDiff({ root, head }).files,
      collectNativeDiff({ root, base, head }).files,
    );
    git(["checkout", "-q", "--orphan", "unrelated"]);
    git(["rm", "-rf", "."]);
    write("unrelated", "other history\n");
    const unrelated = commit();
    git(["checkout", "-q", head]);
    write("scripts/workbench-ci-scope.json", JSON.stringify({ upstreamBase: unrelated }));
    const invalid = commit();
    assert.throws(() => collectNativeDiff({ root, base, head: invalid }));
  }));

it("reports missing baseline evidence without turning patch reporting into a gate", () =>
  fixture(({ root, base, write, commit }) => {
    write("scripts/workbench-ci-scope.json", JSON.stringify({ upstreamBase: "0".repeat(40) }));
    const head = commit();
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      [
        NodePath.resolve(import.meta.dirname, "../workbench-isolation.ts"),
        "--report",
        "--base",
        base,
        "--head",
        head,
        "--markdown",
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.include(result.stdout, "Report unavailable");
    assert.include(result.stderr, "Native diff report unavailable");
  }));

it("preserves binary and unusual path evidence without inventing line counts", () =>
  fixture(({ root, base, write, commit }) => {
    write("assets/new | binary\nfile", "\0binary\0");
    const report = collectNativeDiff({ root, base, head: commit() });
    assert.equal(report.files[0]?.pr.binary, true);
    assert.equal(report.files[0]?.growth, null);
    assert.include(renderNativeDiff(report), "binary (line count unavailable)");
    assert.include(renderNativeDiff(report), "assets/new &#124; binary file");
  }));
