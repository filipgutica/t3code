#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import { evaluateWorkbenchQuality } from "./lib/workbench-quality.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
const baseRef = NodeProcess.env.FALLOW_AUDIT_BASE ?? "HEAD^";
const ownedPaths = [
  "packages/workbench",
  "apps/server/src/workbench",
  "apps/web/src/workbench",
  "packages/contracts/src/workbench*",
];

const diff = NodeChildProcess.execFileSync(
  "git",
  ["diff", "--no-ext-diff", "--unified=0", baseRef, "--", ...ownedPaths],
  { cwd: root, encoding: "utf8" },
);

if (!diff.trim()) {
  console.log("No Workbench changes to audit.");
  NodeProcess.exit(0);
}

const result = NodeChildProcess.spawnSync(
  "fallow",
  [
    "--config",
    "packages/workbench/.fallowrc.jsonc",
    "audit",
    "--gate",
    "new-only",
    "--base",
    baseRef,
    "--diff-stdin",
    "--no-css",
    "--no-css-deep",
    "--format",
    "json",
    "--quiet",
  ],
  {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    input: diff,
    stdio: ["pipe", "pipe", "inherit"],
  },
);

if (result.error) throw result.error;
NodeProcess.stdout.write(result.stdout);

// Audit exit 1 can come from upstream/project-wide findings. This gate owns only
// new Workbench complexity and clones; the existing package gate owns dead code.
if (result.status !== 0 && result.status !== 1) NodeProcess.exit(result.status ?? 2);
const failures = evaluateWorkbenchQuality({ report: JSON.parse(result.stdout), diff });
for (const failure of failures) console.error(failure);
NodeProcess.exit(failures.length > 0 ? 1 : 0);
