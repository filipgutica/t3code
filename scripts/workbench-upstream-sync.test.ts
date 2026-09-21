// @effect-diagnostics nodeBuiltinImport:off - Exercise merge-tree conflict classification in disposable repositories.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";

const scriptPath = NodePath.resolve(import.meta.dirname, "workbench-upstream-sync.ts");
const runGit = (cwd: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

type ConflictPath = "pnpm-lock.yaml" | "source.txt";

function createFixture(conflicts: ReadonlyArray<ConflictPath>) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-workbench-sync-test-"));
  const repository = NodePath.join(root, "repository");
  NodeFS.mkdirSync(repository);
  runGit(repository, ["init", "--initial-branch=main"]);
  runGit(repository, ["config", "user.name", "Sync Test"]);
  runGit(repository, ["config", "user.email", "sync-test@example.invalid"]);
  NodeFS.writeFileSync(NodePath.join(repository, "pnpm-lock.yaml"), "base lockfile\n");
  NodeFS.writeFileSync(NodePath.join(repository, "source.txt"), "base source\n");
  runGit(repository, ["add", "."]);
  runGit(repository, ["commit", "-m", "base"]);

  runGit(repository, ["switch", "-c", "product"]);
  for (const path of conflicts) {
    NodeFS.writeFileSync(NodePath.join(repository, path), `product ${path}\n`);
  }
  if (conflicts.length === 0) {
    NodeFS.writeFileSync(NodePath.join(repository, "product.txt"), "product\n");
  }
  runGit(repository, ["add", "."]);
  runGit(repository, ["commit", "-m", "product"]);
  const productSha = runGit(repository, ["rev-parse", "HEAD"]);

  runGit(repository, ["switch", "main"]);
  for (const path of conflicts) {
    NodeFS.writeFileSync(NodePath.join(repository, path), `upstream ${path}\n`);
  }
  if (conflicts.length === 0) {
    NodeFS.writeFileSync(NodePath.join(repository, "upstream.txt"), "upstream\n");
  }
  runGit(repository, ["add", "."]);
  runGit(repository, ["commit", "-m", "upstream"]);
  const upstreamSha = runGit(repository, ["rev-parse", "HEAD"]);

  return { root, repository, productSha, upstreamSha };
}

function preview(conflicts: ReadonlyArray<ConflictPath>) {
  const fixture = createFixture(conflicts);
  try {
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      [scriptPath, "--product", fixture.productSha, "--upstream", fixture.upstreamSha],
      { cwd: fixture.repository, encoding: "utf8" },
    );
    return {
      result,
      output: JSON.parse(result.stdout),
    };
  } finally {
    NodeFS.rmSync(fixture.root, { recursive: true, force: true });
  }
}

describe("workbench upstream sync merge preview", () => {
  it("accepts a clean merge", () => {
    const { result, output } = preview([]);

    assert.equal(result.status, 0);
    assert.equal(output.mergePreview, "clean");
    assert.deepEqual(output.conflictPaths, []);
  });

  it("accepts only a generated lockfile conflict", () => {
    const { result, output } = preview(["pnpm-lock.yaml"]);

    assert.equal(result.status, 0);
    assert.equal(output.mergePreview, "generated-lockfile");
    assert.deepEqual(output.conflictPaths, ["pnpm-lock.yaml"]);
  });

  it("rejects source and mixed conflicts", () => {
    const source = preview(["source.txt"]);
    assert.equal(source.result.status, 2);
    assert.equal(source.output.mergePreview, "conflict");
    assert.deepEqual(source.output.conflictPaths, ["source.txt"]);

    const mixed = preview(["pnpm-lock.yaml", "source.txt"]);
    assert.equal(mixed.result.status, 2);
    assert.equal(mixed.output.mergePreview, "conflict");
    assert.deepEqual(mixed.output.conflictPaths, ["pnpm-lock.yaml", "source.txt"]);
  });
});
