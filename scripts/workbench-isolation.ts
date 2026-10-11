// @effect-diagnostics nodeBuiltinImport:off - Read-only repository boundary gate.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import { Schema } from "effect";
import {
  IntegrationPolicy,
  collectWorkbenchImports,
  isRuntimeSource,
  readRuntimeSources,
  validateWorkbenchIntegrations,
} from "./lib/workbench-isolation.ts";

const git = (args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", [...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
const root = process.cwd();
const args = process.argv.slice(2);
const report = args[0] === "--report";
const ref = report && args[1] === "--ref" ? args[2] : undefined;
if ((!report && args.length) || (report && args.length !== 1 && !(ref && args.length === 3)))
  throw new Error("Usage: node scripts/workbench-isolation.ts [--report [--ref <commit>]]");
const files = [
  ...new Set(
    git(
      ref
        ? ["ls-tree", "-r", "--name-only", "-z", ref, "--", "apps", "packages", "infra", "scripts"]
        : [
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            "--",
            "apps",
            "packages",
            "infra",
            "scripts",
          ],
    )
      .split("\0")
      .filter(Boolean),
  ),
];
const readCommittedSources = (reference: string) => {
  const sourceFiles = files.filter(isRuntimeSource);
  const blobs = NodeChildProcess.execFileSync("git", ["cat-file", "--batch"], {
    input: `${sourceFiles.map((file) => `${reference}:${file}`).join("\n")}\n`,
    maxBuffer: 128 * 1024 * 1024,
  });
  let offset = 0;
  return new Map(
    sourceFiles.map((file) => {
      const end = blobs.indexOf(10, offset);
      const [, kind, rawSize] = blobs.toString("utf8", offset, end).split(" ");
      const size = Number(rawSize);
      if (kind !== "blob" || !Number.isSafeInteger(size) || size < 0)
        throw new Error(`Cannot read committed source: ${file}`);
      const content = blobs.toString("utf8", end + 1, end + 1 + size);
      offset = end + 1 + size + 1;
      return [file, content];
    }),
  );
};
const sources = ref ? readCommittedSources(ref) : readRuntimeSources(root, files);
const imports = collectWorkbenchImports({ root, sources });
const result = {
  sourceFiles: new Set(imports.map((edge) => edge.source)).size,
  importSites: imports.length,
  imports,
};
if (report) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  const policy = Schema.decodeUnknownSync(IntegrationPolicy)(
    JSON.parse(NodeFS.readFileSync("scripts/workbench-isolation-policy.json", "utf8")),
  );
  const violations = validateWorkbenchIntegrations({ imports, policy });
  if (violations.length) {
    process.stderr.write(`${violations.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Workbench host boundary passed: ${result.importSites} reviewed imports in ${result.sourceFiles} composition files.\n`,
    );
  }
}
