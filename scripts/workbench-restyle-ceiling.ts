#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - one-shot CI gate over a child process.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const RULE = "shadcn(no-restyle)";
const WORKBENCH_PATH_PREFIX = "apps/web/src/workbench/";
const WORKBENCH_INTEGRATION_FILES = ["apps/web/src/routes/workbench.tsx"] as const;

// Measured after merging upstream's error-level no-restyle rule: 37 Workbench
// findings and 2 route integrations. Lower these as components adopt variants.
export const WORKBENCH_RESTYLE_CEILING = 37;
export const WORKBENCH_INTEGRATION_RESTYLE_CEILING = 2;

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

interface LintDiagnostic {
  readonly code: string;
  readonly filename: string;
}

interface LintReport {
  readonly diagnostics: ReadonlyArray<LintDiagnostic>;
}

export interface RestylePartitions {
  readonly workbench: number;
  readonly workbenchIntegration: number;
}

export function classifyRestyleFindings(report: LintReport): RestylePartitions {
  const partitions = { workbench: 0, workbenchIntegration: 0 };

  for (const diagnostic of report.diagnostics) {
    if (diagnostic.code !== RULE) continue;

    if (diagnostic.filename.startsWith(WORKBENCH_PATH_PREFIX)) {
      partitions.workbench += 1;
    } else if (WORKBENCH_INTEGRATION_FILES.some((filename) => filename === diagnostic.filename)) {
      partitions.workbenchIntegration += 1;
    }
  }

  return partitions;
}

function evaluatePartition(
  label: string,
  count: number,
  ceiling: number,
): { readonly ok: boolean; readonly message: string } {
  if (count > ceiling) {
    return {
      ok: false,
      message: `${RULE} (${label}): ${count} findings exceed the ceiling of ${ceiling}.`,
    };
  }

  return {
    ok: true,
    message: `${RULE} (${label}): ${count} findings, ${ceiling - count} below the ceiling of ${ceiling}.`,
  };
}

export function evaluateRestylePartitions(partitions: RestylePartitions): {
  readonly ok: boolean;
  readonly messages: ReadonlyArray<string>;
} {
  const workbench = evaluatePartition("Workbench", partitions.workbench, WORKBENCH_RESTYLE_CEILING);
  const integration = evaluatePartition(
    "Workbench integration",
    partitions.workbenchIntegration,
    WORKBENCH_INTEGRATION_RESTYLE_CEILING,
  );

  return {
    ok: workbench.ok && integration.ok,
    messages: [workbench.message, integration.message],
  };
}

function main() {
  const result = NodeChildProcess.spawnSync(
    "vp",
    ["lint", "--format", "json", WORKBENCH_PATH_PREFIX, ...WORKBENCH_INTEGRATION_FILES],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "Workbench lint failed");
  }

  const report = JSON.parse(result.stdout) as LintReport;
  const partitions = classifyRestyleFindings(report);
  const verdict = evaluateRestylePartitions(partitions);
  process.stdout.write(`${verdict.messages.join("\n")}\n`);
  process.exitCode = verdict.ok ? 0 : 1;
}

if (
  process.argv[1] !== undefined &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  main();
}
