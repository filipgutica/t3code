// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { matchesScopePattern } from "./lib/workbench-ci-scope.ts";

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

const generatedLockfilePath = "pnpm-lock.yaml";

function parseMergeTreeConflictPaths(output: string): ReadonlyArray<string> {
  const fields = output.split("\0");
  const end = fields.indexOf("");
  return fields.slice(1, end === -1 ? fields.length : end);
}

// The product's policy decides which upstream CI changes publish without review;
// the incoming upstream tree cannot widen that list.
function ciReviewPaths(productSha: string, changedCIPaths: ReadonlyArray<string>) {
  const policy = JSON.parse(
    git(["show", `${productSha}:scripts/workbench-ci-scope.json`]).stdout,
  ) as { readonly inertUpstreamCI?: unknown };
  const inert = policy.inertUpstreamCI;
  if (!Array.isArray(inert) || !inert.every((pattern) => typeof pattern === "string"))
    throw new Error("scripts/workbench-ci-scope.json has no inertUpstreamCI list");
  return changedCIPaths.filter(
    (path) => !inert.some((pattern) => matchesScopePattern(path, pattern)),
  );
}

function previewMerge(productSha: string, upstreamSha: string) {
  const objectDirectory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "t3-workbench-merge-tree-"),
  );
  const existingObjectDirectory = git(["rev-parse", "--git-path", "objects"]).stdout.trim();
  const env = {
    ...process.env,
    GIT_OBJECT_DIRECTORY: objectDirectory,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: existingObjectDirectory,
  };
  try {
    const merge = NodeChildProcess.spawnSync(
      "git",
      ["merge-tree", "--write-tree", "--name-only", "-z", "--no-messages", productSha, upstreamSha],
      { encoding: "utf8", env },
    );
    if (merge.status !== 0 && merge.status !== 1) return { merge, ciPaths: [] };
    // merge-tree writes a tree even with conflicts; its CI files are what the sync would publish.
    const mergedTree = merge.stdout.split("\0")[0] ?? "";
    const diff = NodeChildProcess.spawnSync(
      "git",
      [
        "diff-tree",
        "-r",
        "--no-renames",
        "--name-only",
        "-z",
        productSha,
        mergedTree,
        "--",
        ".github/workflows",
        ".github/actions",
      ],
      { encoding: "utf8", env },
    );
    if (diff.status !== 0) throw new Error(`git diff-tree failed: ${diff.stderr.trim()}`);
    return { merge, ciPaths: diff.stdout.split("\0").filter(Boolean) };
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
  const { merge: mergePreview, ciPaths } = previewMerge(productSha, upstreamSha);
  if (mergePreview.status !== 0 && mergePreview.status !== 1) {
    const detail = mergePreview.stderr.trim() || mergePreview.stdout.trim();
    throw new Error(`git merge-tree failed: ${detail}`);
  }
  const clean = mergePreview.status === 0;
  const conflictPaths = clean ? [] : parseMergeTreeConflictPaths(mergePreview.stdout);
  const generatedLockfileConflict =
    conflictPaths.length === 1 && conflictPaths[0] === generatedLockfilePath;
  const reviewPaths = ciReviewPaths(productSha, ciPaths);
  const mergeAcceptable = clean || generatedLockfileConflict;

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
        mergePreview: clean
          ? "clean"
          : generatedLockfileConflict
            ? "generated-lockfile"
            : "conflict",
        conflictPaths,
        ciReviewPaths: reviewPaths,
      },
      null,
      2,
    )}\n`,
  );
  if (!mergeAcceptable)
    process.stderr.write(`Merge conflicts: ${conflictPaths.join(", ") || "unknown paths"}\n`);
  if (reviewPaths.length > 0)
    process.stderr.write(`Upstream changes active CI: ${reviewPaths.join(", ")}\n`);
  if (!mergeAcceptable || reviewPaths.length > 0) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
