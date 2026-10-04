// @effect-diagnostics nodeBuiltinImport:off - Exercise the CLI and Git/Actions contracts.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, it } from "@effect/vitest";

const scriptPath = NodePath.resolve(import.meta.dirname, "workbench-ci.ts");
const execute = (root: string, args: ReadonlyArray<string>, env: Record<string, string> = {}) =>
  NodeChildProcess.spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
const fixture = (body: (root: string, base: string) => void) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-ci-"));
  const git = (args: ReadonlyArray<string>) => {
    const result = NodeChildProcess.spawnSync("git", [...args], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (path: string, content: string) => {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, path), content);
  };
  try {
    git(["init", "-q"]);
    write("apps/server/src/legacy.ts", "export const upstream = true;\n");
    git(["add", "."]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "upstream",
    ]);
    const upstreamBase = git(["rev-parse", "HEAD"]);
    write("apps/server/src/owned.ts", "export const fork = true;\n");
    write("apps/server/src/owned.test.ts", "// Owned regression\n");
    write("scripts/packaging.test.ts", "// Packaging regression\n");
    write(".github/workflows/ci.yml", "name: CI\non: pull_request\n");
    write(".github/workflows/thread-transfer-report.yml", "name: Thread Transfer Report\n");
    write(
      "scripts/workbench-ci-scope.json",
      JSON.stringify({
        upstreamBase,
        groups: [
          {
            name: "Fork",
            paths: ["apps/server/src/owned.ts"],
            tests: ["apps/server/src/owned.test.ts"],
            verification: ["unit", "typecheck"],
          },
        ],
        packages: { "apps/server": "t3", scripts: "@t3tools/scripts" },
        packagingTests: ["scripts/packaging.test.ts"],
        packagingPaths: ["package.json"],
      }),
    );
    git(["add", "."]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "fork",
    ]);
    assert.equal(execute(root, []).status, 0);
    body(root, git(["rev-parse", "HEAD"]));
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
};

it("rejects unmapped additions, deletions and renames before replacing verified CI", () => {
  for (const change of ["addition", "deletion", "rename", "native C"])
    fixture((root) => {
      const output = NodePath.join(root, ".github/workflows/workbench-ci.yml");
      const verified = NodeFS.readFileSync(output, "utf8");
      if (change === "native C") {
        NodeFS.mkdirSync(NodePath.join(root, "native/helper"), { recursive: true });
        NodeFS.writeFileSync(
          NodePath.join(root, "native/helper/main.c"),
          "int main(void) { return 0; }\n",
        );
        NodeChildProcess.execFileSync("git", ["add", "native"], { cwd: root });
      } else if (change === "deletion")
        NodeFS.unlinkSync(NodePath.join(root, "apps/server/src/legacy.ts"));
      else {
        NodeFS.writeFileSync(
          NodePath.join(root, "apps/server/src/unmapped.ts"),
          "export const responsibility = true;\n",
        );
        if (change === "rename") NodeFS.unlinkSync(NodePath.join(root, "apps/server/src/owned.ts"));
        NodeChildProcess.execFileSync("git", ["add", "apps/server/src"], { cwd: root });
      }
      const rejected = execute(root, []);
      assert.equal(rejected.status, 1);
      assert.include(rejected.stderr, "Unmapped fork sources");
      assert.equal(NodeFS.readFileSync(output, "utf8"), verified);
    });
});

it("detects stale output without modifying upstream workflow sources", () =>
  fixture((root) => {
    const output = NodePath.join(root, ".github/workflows/workbench-ci.yml");
    assert.equal(execute(root, ["--check"]).status, 0);
    NodeFS.appendFileSync(output, "# unreviewed edit\n");
    const stale = execute(root, ["--check"]);
    assert.equal(stale.status, 1);
    assert.include(stale.stderr, "Fork CI is stale");
    assert.equal(execute(root, []).status, 0);
    assert.equal(execute(root, ["--check"]).status, 0);
    assert.equal(
      NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
      "name: CI\non: pull_request\n",
    );
    assert.equal(
      NodeFS.readFileSync(
        NodePath.join(root, ".github/workflows/thread-transfer-report.yml"),
        "utf8",
      ),
      "name: Thread Transfer Report\n",
    );
  }));

it.each([
  ["docs/note.md", { verify: false, build: false, packaging: false }],
  ["apps/server/src/owned.ts", { verify: true, build: true, packaging: false }],
  ["package.json", { verify: true, build: true, packaging: true }],
  ["scripts/packaging.test.ts", { verify: true, build: false, packaging: true }],
])("routes %s through the Actions output contract", (path, expected) =>
  fixture((root, base) => {
    const full = NodePath.join(root, path);
    NodeFS.mkdirSync(NodePath.dirname(full), { recursive: true });
    NodeFS.writeFileSync(full, "// changed\n");
    NodeChildProcess.execFileSync("git", ["add", path], { cwd: root });
    const output = NodePath.join(root, "actions-output");
    const result = execute(root, ["--scope", base], { GITHUB_OUTPUT: output });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected);
    assert.equal(
      NodeFS.readFileSync(output, "utf8"),
      Object.entries(expected)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  }),
);

it("rejects unsupported upstream refs and missing owner tests without replacing output", () =>
  fixture((root) => {
    const output = NodePath.join(root, ".github/workflows/workbench-ci.yml");
    const verified = NodeFS.readFileSync(output, "utf8");
    const policy = NodeFS.readFileSync(
      NodePath.join(root, "scripts/workbench-ci-scope.json"),
      "utf8",
    );
    const foreign = execute(root, ["--upstream", "f".repeat(40)]);
    assert.equal(foreign.status, 1);
    assert.equal(
      NodeFS.readFileSync(NodePath.join(root, "scripts/workbench-ci-scope.json"), "utf8"),
      policy,
    );
    NodeFS.unlinkSync(NodePath.join(root, "apps/server/src/owned.test.ts"));
    NodeChildProcess.execFileSync("git", ["add", "apps/server/src"], { cwd: root });
    const missing = execute(root, []);
    assert.equal(missing.status, 1);
    assert.include(missing.stderr, "no tests");
    assert.equal(NodeFS.readFileSync(output, "utf8"), verified);
  }));

it("advances ownership only after the canonical upstream ref is integrated", () =>
  fixture((root) => {
    const git = (args: ReadonlyArray<string>) =>
      NodeChildProcess.execFileSync("git", [...args], { cwd: root, encoding: "utf8" }).trim();
    const path = NodePath.join(root, "scripts/workbench-ci-scope.json");
    const original = NodeFS.readFileSync(path, "utf8");
    const policy = JSON.parse(original);
    const branch = git(["branch", "--show-current"]);
    git(["switch", "-qc", "upstream-fixture", policy.upstreamBase]);
    NodeFS.writeFileSync(
      NodePath.join(root, "apps/server/src/legacy.ts"),
      "export const upstream = false;\n",
    );
    git(["add", "."]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "upstream change",
    ]);
    const upstream = git(["rev-parse", "HEAD"]);
    git(["remote", "add", "upstream", "https://github.com/pingdotgg/t3code.git"]);
    git(["update-ref", "refs/remotes/upstream/main", upstream]);
    git(["switch", "-q", branch]);
    assert.equal(execute(root, ["--upstream", "upstream/main"]).status, 1);
    assert.equal(NodeFS.readFileSync(path, "utf8"), original);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "merge",
      "--no-commit",
      "--no-ff",
      "upstream/main",
    ]);
    const pending = execute(root, ["--upstream", "upstream/main"]);
    assert.equal(pending.status, 0, pending.stderr);
    assert.equal(JSON.parse(NodeFS.readFileSync(path, "utf8")).upstreamBase, upstream);
    assert.equal(execute(root, ["--check"]).status, 0);
  }));

it("accepts only successful applicable jobs or explicitly irrelevant skips", () => {
  const names = ["scope", "lint", "typecheck", "test", "build", "packaging"];
  const success = Object.fromEntries(names.map((name) => [name, { result: "success" }]));
  const check = (
    results: unknown,
    flags = { SCOPE_VERIFY: "true", SCOPE_BUILD: "true", SCOPE_PACKAGING: "true" },
  ) =>
    execute(NodeOS.tmpdir(), ["--verify-results"], { RESULTS: JSON.stringify(results), ...flags });
  assert.equal(check(success).status, 0);
  for (const name of names)
    for (const result of ["failure", "cancelled", "skipped"]) {
      assert.equal(check({ ...success, [name]: { result } }).status, 1, `${name}: ${result}`);
    }
  const docs = {
    ...success,
    ...Object.fromEntries(
      names.filter((name) => name !== "scope").map((name) => [name, { result: "skipped" }]),
    ),
  };
  const irrelevant = { SCOPE_VERIFY: "false", SCOPE_BUILD: "false", SCOPE_PACKAGING: "false" };
  assert.equal(check(docs, irrelevant).status, 0);
  assert.equal(check({ ...docs, build: { result: "cancelled" } }, irrelevant).status, 1);
  assert.equal(check({ ...success, unexpected: { result: "success" } }).status, 1);
  assert.equal(
    check(success, { SCOPE_VERIFY: "", SCOPE_BUILD: "true", SCOPE_PACKAGING: "true" }).status,
    1,
  );
});
