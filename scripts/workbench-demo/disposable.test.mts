// @effect-diagnostics nodeBuiltinImport:off - Disposable runner tests use private temporary homes.
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { it as test } from "vite-plus/test";

import { setupHome } from "./environment.mts";
import { finishDisposableRun, recoverDisposableDemo } from "./disposable.mts";

const writeLock = async (
  sourceHome: string,
  runHome: string,
  extra: Record<string, unknown> = {},
) => {
  await NodeFSP.writeFile(
    NodePath.join(sourceHome, ".disposable-demo.lock"),
    `${JSON.stringify({
      version: 1,
      sourceHome,
      runHome,
      createdAt: "2026-01-01T00:00:00.000Z",
      pid: process.pid,
      ...extra,
    })}\n`,
    { mode: 0o600 },
  );
};

test("finishes a stopped run by deleting it, its reset archive, and the lock", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-disposable-test-"));
  try {
    const source = setupHome(NodePath.join(root, "source"));
    const run = setupHome(NodePath.join(source, "runs", "run-success"));
    await NodeFSP.mkdir(`${run}.backup-123`);
    await writeLock(source, run);

    await finishDisposableRun(source, run);

    NodeAssert.equal(NodeFS.existsSync(run), false);
    NodeAssert.equal(NodeFS.existsSync(`${run}.backup-123`), false);
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(source, ".disposable-demo.lock")), false);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

test("recovers an interrupted run through the public recovery path", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-disposable-test-"));
  try {
    const source = setupHome(NodePath.join(root, "source"));
    const run = setupHome(NodePath.join(source, "runs", "run-interrupted"));
    await writeLock(source, run);

    await recoverDisposableDemo({ sourceHome: source, runHome: run });

    NodeAssert.equal(NodeFS.existsSync(run), false);
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(source, ".disposable-demo.lock")), false);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

test("recovers an older lock even if its run directory is already gone", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-disposable-test-"));
  try {
    const source = setupHome(NodePath.join(root, "source"));
    const run = NodePath.join(source, "runs", "run-recovered");
    await NodeFSP.mkdir(NodePath.dirname(run), { recursive: true });
    await writeLock(source, run, { phase: "auth-saved" });

    await recoverDisposableDemo({ sourceHome: source, runHome: run });

    NodeAssert.equal(NodeFS.existsSync(NodePath.join(source, ".disposable-demo.lock")), false);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects recovery for a run that does not match the source lock", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "demo-disposable-test-"));
  try {
    const source = setupHome(NodePath.join(root, "source"));
    const lockedRun = NodePath.join(source, "runs", "run-locked");
    const requestedRun = NodePath.join(source, "runs", "run-other");
    await NodeFSP.mkdir(requestedRun, { recursive: true });
    await writeLock(source, lockedRun);

    await NodeAssert.rejects(
      recoverDisposableDemo({ sourceHome: source, runHome: requestedRun }),
      /source lock does not point/,
    );
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
