// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

interface SyncOptions {
  readonly productRef: string;
  readonly upstreamRef: string;
}

function parseOptions(argv: ReadonlyArray<string>): SyncOptions {
  let productRef = "HEAD";
  let upstreamRef = "origin/main";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--product") productRef = argv[index + 1] ?? productRef;
    if (argument === "--upstream") upstreamRef = argv[index + 1] ?? upstreamRef;
  }
  return { productRef, upstreamRef };
}

function git(args: ReadonlyArray<string>) {
  const result = NodeChildProcess.spawnSync("git", [...args], { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `git exited ${result.status}`;
    throw new Error(`${args.join(" ")}: ${detail}`);
  }
  return result;
}

function lines(value: string): ReadonlyArray<string> {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function previewMerge(productSha: string, upstreamSha: string) {
  const objectDirectory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "t3-workbench-merge-tree-"),
  );
  const existingObjectDirectory = git(["rev-parse", "--git-path", "objects"]).stdout.trim();
  try {
    return NodeChildProcess.spawnSync(
      "git",
      ["merge-tree", "--write-tree", productSha, upstreamSha],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_OBJECT_DIRECTORY: objectDirectory,
          GIT_ALTERNATE_OBJECT_DIRECTORIES: existingObjectDirectory,
        },
      },
    );
  } finally {
    NodeFS.rmSync(objectDirectory, { recursive: true, force: true });
  }
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  const productSha = git(["rev-parse", "--verify", options.productRef]).stdout.trim();
  const upstreamSha = git(["rev-parse", "--verify", options.upstreamRef]).stdout.trim();
  const mergeBase = git(["merge-base", productSha, upstreamSha]).stdout.trim();
  const [ahead = "0", behind = "0"] = git([
    "rev-list",
    "--left-right",
    "--count",
    `${upstreamSha}...${productSha}`,
  ])
    .stdout.trim()
    .split(/\s+/);
  const upstreamFiles = new Set(
    lines(git(["diff", "--name-only", `${mergeBase}..${upstreamSha}`]).stdout),
  );
  const productFiles = new Set(
    lines(git(["diff", "--name-only", `${mergeBase}..${productSha}`]).stdout),
  );
  const overlappingFiles = [...upstreamFiles].filter((file) => productFiles.has(file)).sort();
  const mergePreview = previewMerge(productSha, upstreamSha);
  if (mergePreview.status !== 0 && mergePreview.status !== 1) {
    const detail = mergePreview.stderr.trim() || mergePreview.stdout.trim();
    throw new Error(`git merge-tree failed: ${detail}`);
  }
  const clean = mergePreview.status === 0;

  process.stdout.write(
    `${JSON.stringify(
      {
        productRef: options.productRef,
        productSha,
        upstreamRef: options.upstreamRef,
        upstreamSha,
        mergeBase,
        upstreamCommitsAhead: Number(ahead),
        productCommitsAhead: Number(behind),
        overlappingFiles,
        mergePreview: clean ? "clean" : "conflict",
      },
      null,
      2,
    )}\n`,
  );
  if (!clean) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
