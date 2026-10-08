// @effect-diagnostics nodeBuiltinImport:off - Read-only release recovery validation before publication.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import {
  mergeUpdateManifests,
  parseUpdateManifest,
  serializeUpdateManifest,
} from "./lib/update-manifest.ts";

interface Run {
  id: number;
  run_attempt: number;
  path: string;
  event: string;
  head_branch: string;
  head_sha: string;
  status: string;
  conclusion: string;
  repository: { full_name: string };
  head_repository: { full_name: string };
}
interface Job {
  name: string;
  run_id: number;
  run_attempt: number;
  status: string;
  conclusion: string;
  steps: Array<{ name: string; status: string; conclusion: string }>;
}
interface Asset {
  name: string;
  size: number;
  digest: string;
  state: string;
}
interface Release {
  id: number;
  tag_name: string;
  target_commitish: string;
  draft: boolean;
  prerelease: boolean;
  assets: Asset[];
}
interface Artifact {
  id: number;
  digest: string;
  name: string;
  expired: boolean;
  size_in_bytes: number;
  workflow_run: { id: number; head_sha: string };
}
interface PushRun {
  path: string;
  event: string;
  head_branch: string;
  head_sha: string;
  run_number: number;
  run_attempt: number;
  status: string;
  conclusion: string;
}
interface File {
  size: number;
  sha256: string;
  sha512: string;
  text?: string;
}
const platforms = ["linux-x64", "mac-arm64", "mac-x64", "win-x64"];
const repository = "filipgutica/t3code";

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function textFile(text: string): File {
  return {
    size: Buffer.byteLength(text),
    sha256: NodeCrypto.createHash("sha256").update(text).digest("hex"),
    sha512: NodeCrypto.createHash("sha512").update(text).digest("base64"),
    text,
  };
}
async function inspectFile(path: string): Promise<File> {
  requireCondition(NodeFS.lstatSync(path).isFile(), `Artifact contains a non-file: ${path}`);
  const sha256 = NodeCrypto.createHash("sha256");
  const sha512 = NodeCrypto.createHash("sha512");
  for await (const chunk of NodeFS.createReadStream(path)) {
    sha256.update(chunk);
    sha512.update(chunk);
  }
  return {
    size: NodeFS.lstatSync(path).size,
    sha256: sha256.digest("hex"),
    sha512: sha512.digest("base64"),
    ...(/\.(txt|yml)$/.test(path) ? { text: NodeFS.readFileSync(path, "utf8") } : {}),
  };
}

async function main() {
  const { values } = NodeUtil.parseArgs({
    options: Object.fromEntries(
      ["evidence-dir", "version", "sha", "release-id", "run-id"].map((key) => [
        key,
        { type: "string" as const },
      ]),
    ),
  });
  const dir = values["evidence-dir"];
  const version = values.version;
  const sha = values.sha;
  const releaseId = Number(values["release-id"]);
  const runId = Number(values["run-id"]);
  requireCondition(
    dir &&
      version &&
      /^\d+\.\d+\.\d+$/.test(version) &&
      sha &&
      /^[a-f0-9]{40}$/.test(sha) &&
      Number.isSafeInteger(releaseId) &&
      releaseId > 0 &&
      Number.isSafeInteger(runId) &&
      runId > 0,
    "Invalid recovery identity",
  );
  const read = <T>(name: string): T =>
    JSON.parse(NodeFS.readFileSync(NodePath.join(dir, `${name}.json`), "utf8")) as T;
  const release = read<Release>("release");
  requireCondition(
    release.id === releaseId &&
      release.tag_name === `workbench-v${version}` &&
      release.target_commitish === sha &&
      release.prerelease === false &&
      typeof release.draft === "boolean",
    "Release identity differs from selected signed Stable draft",
  );
  const run = read<Run>("run");
  requireCondition(
    run.id === runId &&
      run.path === ".github/workflows/workbench-release.yml" &&
      run.event === "workflow_dispatch" &&
      run.head_branch === "main" &&
      run.repository.full_name === repository &&
      run.head_repository.full_name === repository &&
      run.status === "completed" &&
      run.conclusion === "success",
    "Build run is not a successful trusted main Stable build",
  );
  const jobs = read<Array<{ jobs: Job[] }>>("jobs").flatMap((page) => page.jobs);
  const expectedJobs = [
    "Resolve release metadata",
    "Workbench quality gates",
    "Build WSL CLI runtime (linux-x64)",
    "Build macOS arm64",
    "Build macOS x64",
    "Build Linux x64",
    "Build Windows x64",
    "Create Workbench GitHub Release",
  ];
  for (const name of expectedJobs) {
    const matching = jobs.filter((job) => job.name === name);
    requireCondition(
      matching.length === 1 &&
        matching[0]!.run_id === runId &&
        matching[0]!.run_attempt === run.run_attempt &&
        matching[0]!.status === "completed" &&
        matching[0]!.conclusion === "success",
      `Build job missing, stale or unsuccessful: ${name}`,
    );
  }
  const stepPassed = (jobName: string, stepName: string) =>
    jobs
      .find((job) => job.name === jobName)
      ?.steps.some(
        (step) =>
          step.name === stepName && step.status === "completed" && step.conclusion === "success",
      );
  requireCondition(
    stepPassed("Resolve release metadata", "Validate macOS signing credentials") &&
      ["Build macOS arm64", "Build macOS x64"].every(
        (name) =>
          stepPassed(name, "Configure macOS signing") &&
          stepPassed(name, "Verify macOS signature and optional notarization"),
      ),
    "Signing verification did not pass for both Mac architectures",
  );
  requireCondition(
    stepPassed("Create Workbench GitHub Release", "Verify package checksums") &&
      stepPassed("Create Workbench GitHub Release", "Create draft release"),
    "Stable draft/checksum steps did not pass",
  );
  for (const [file, path] of [
    ["ci-feature", ".github/workflows/workbench-ci.yml"],
    ["ci-quality", ".github/workflows/workbench-quality.yml"],
  ]) {
    const runs = read<Array<{ workflow_runs: PushRun[] }>>(file!)
      .flatMap((page) => page.workflow_runs)
      .filter(
        (r) =>
          r.path === path && r.event === "push" && r.head_branch === "main" && r.head_sha === sha,
      )
      .sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt);
    requireCondition(
      runs[0]?.status === "completed" && runs[0]?.conclusion === "success",
      `Source CI is missing, pending or failed: ${path}`,
    );
  }
  const artifacts = read<Array<{ artifacts: Artifact[] }>>("artifacts")
    .flatMap((page) => page.artifacts)
    .filter((artifact) => artifact.name.startsWith("workbench-desktop-"));
  requireCondition(
    artifacts.length === platforms.length &&
      platforms.every((platform) => {
        const matching = artifacts.filter(
          (artifact) => artifact.name === `workbench-desktop-${platform}`,
        );
        return (
          matching.length === 1 &&
          Number.isSafeInteger(matching[0]!.id) &&
          matching[0]!.id > 0 &&
          /^sha256:[a-f0-9]{64}$/.test(matching[0]!.digest) &&
          !matching[0]!.expired &&
          matching[0]!.size_in_bytes > 0 &&
          matching[0]!.workflow_run.id === runId &&
          matching[0]!.workflow_run.head_sha === run.head_sha
        );
      }),
    "Build artifacts are missing, expired, duplicate or from another run",
  );
  const downloaded = read<Array<{ artifacts: Artifact[] }>>("artifacts-downloaded")
    .flatMap((page) => page.artifacts)
    .filter((artifact) => artifact.name.startsWith("workbench-desktop-"));
  requireCondition(
    downloaded.length === artifacts.length &&
      artifacts.every((artifact) =>
        downloaded.some(
          (original) =>
            original.name === artifact.name &&
            original.id === artifact.id &&
            original.digest === artifact.digest,
        ),
      ),
    "Build artifacts changed after download",
  );
  if (release.draft) {
    // The Workbench Stable feed accepts workbench-vX.Y.Z previews too; preserve its version floor.
    const selected = version.split(".").map(BigInt);
    const newer = read<Release[][]>("releases")
      .flat()
      .some((other) => {
        const match = /^workbench-v(\d+)\.(\d+)\.(\d+)$/.exec(other.tag_name);
        if (other.draft || !match) return false;
        const numbers = match.slice(1).map(BigInt);
        for (let index = 0; index < 3; index++) {
          if (numbers[index] !== selected[index]) return numbers[index]! > selected[index]!;
        }
        return other.id !== release.id;
      });
    requireCondition(!newer, "Stable version is superseded by another published release");
  }

  const files = new Map<string, File>();
  for (const platform of platforms) {
    const artifactDir = NodePath.join(dir, "artifacts", `workbench-desktop-${platform}`);
    const local = new Map<string, File>();
    for (const name of NodeFS.readdirSync(artifactDir))
      local.set(name, await inspectFile(NodePath.join(artifactDir, name)));
    const checksumName = `SHA256SUMS-${platform}.txt`;
    const checksums = local.get(checksumName)?.text;
    requireCondition(checksums, `Platform checksum missing: ${platform}`);
    const checked = new Set<string>();
    for (const line of checksums.trimEnd().split("\n")) {
      const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
      requireCondition(
        match && !checked.has(match[2]!) && local.get(match[2]!)?.sha256 === match[1],
        `Platform checksum mismatch: ${platform}`,
      );
      checked.add(match[2]!);
    }
    requireCondition(
      checked.size === local.size - 1,
      `Platform checksum inventory mismatch: ${platform}`,
    );
    local.delete(checksumName);
    const [os, arch] = platform.split("-");
    const info = local.get(`WORKBENCH-BUILD-INFO-${platform}.txt`)?.text;
    for (const line of [
      `Version: ${version}`,
      `Commit: ${sha}`,
      `Platform: ${os}`,
      `Architecture: ${arch}`,
      `Signing status: ${os === "mac" ? "SIGNED AND NOTARIZED" : "UNSIGNED"}`,
    ])
      requireCondition(
        info?.split("\n").filter((entry) => entry === line).length === 1,
        `Build identity/signing differs: ${platform}`,
      );
    for (const [name, file] of local) {
      requireCondition(!files.has(name), `Duplicate artifact file: ${name}`);
      files.set(name, file);
    }
  }
  const mac = mergeUpdateManifests(
    parseUpdateManifest(files.get("latest-mac.yml")?.text ?? "", "latest-mac.yml", "macOS"),
    parseUpdateManifest(files.get("latest-mac-x64.yml")?.text ?? "", "latest-mac-x64.yml", "macOS"),
    "macOS",
  );
  files.set("latest-mac.yml", textFile(serializeUpdateManifest(mac, { platformLabel: "macOS" })));
  files.delete("latest-mac-x64.yml");
  const base = `T3-Code-Workbench-${version}-`;
  for (const [name, installers] of [
    ["latest-mac.yml", ["arm64.zip", "arm64.dmg", "x64.zip", "x64.dmg"]],
    ["latest-linux.yml", ["x86_64.AppImage"]],
    ["latest.yml", ["x64.exe"]],
  ] as const) {
    const manifest = parseUpdateManifest(files.get(name)?.text ?? "", name, name);
    requireCondition(
      manifest.version === version &&
        manifest.files.length === installers.length &&
        installers.every((suffix) =>
          manifest.files.some((entry) => entry.url === `${base}${suffix}`),
        ),
      `Updater manifest inventory/version differs: ${name}`,
    );
    for (const entry of manifest.files)
      requireCondition(
        files.get(entry.url)?.sha512 === entry.sha512 && files.get(entry.url)?.size === entry.size,
        `Updater manifest checksum differs: ${entry.url}`,
      );
  }
  const expected = [
    "latest.yml",
    "latest-linux.yml",
    "latest-mac.yml",
    ...platforms.map((platform) => `WORKBENCH-BUILD-INFO-${platform}.txt`),
    ...["arm64.zip", "arm64.dmg", "x64.zip", "x64.dmg", "x64.exe"].flatMap((suffix) => [
      `${base}${suffix}`,
      `${base}${suffix}.blockmap`,
    ]),
    `${base}x86_64.AppImage`,
  ].sort();
  requireCondition(
    JSON.stringify([...files.keys()].sort()) === JSON.stringify(expected),
    "Artifact inventory differs from complete signed Stable payload",
  );
  files.set(
    "SHA256SUMS.txt",
    textFile(
      [...files.keys()]
        .sort()
        .map((name) => `${files.get(name)!.sha256}  ${name}\n`)
        .join(""),
    ),
  );
  requireCondition(
    release.assets.length === files.size &&
      new Set(release.assets.map((asset) => asset.name)).size === files.size,
    "Release inventory is incomplete or duplicated",
  );
  for (const asset of release.assets) {
    const file = files.get(asset.name);
    requireCondition(
      file &&
        asset.state === "uploaded" &&
        asset.size === file.size &&
        asset.size > 0 &&
        asset.digest === `sha256:${file.sha256}`,
      `Release asset differs from successful signed build: ${asset.name}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({ action: release.draft ? "publish" : "already-published", releaseId, runId, sourceSha: sha, assetCount: files.size })}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
