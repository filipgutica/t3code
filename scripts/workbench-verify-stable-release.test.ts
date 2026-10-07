// @effect-diagnostics nodeBuiltinImport:off - Exercise the recovery CLI with real artifact bytes.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import { expect, it } from "vite-plus/test";

const sha = "a".repeat(40);
const script = NodePath.resolve(import.meta.dirname, "workbench-verify-stable-release.ts");
const hash = (data: string, algorithm = "sha256") =>
  NodeCrypto.createHash(algorithm)
    .update(data)
    .digest(algorithm === "sha512" ? "base64" : "hex");

function fixture(body: (f: ReturnType<typeof setup>) => void) {
  const f = setup();
  try {
    body(f);
  } finally {
    NodeFS.rmSync(f.root, { recursive: true, force: true });
  }
}

function setup() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-stable-"));
  const files: Record<string, string> = {};
  const manifest = (names: string[]) =>
    `version: '0.0.22'\nfiles:\n${names.map((name) => `  - url: ${name}\n    sha512: ${hash(files[name]!, "sha512")}\n    size: ${Buffer.byteLength(files[name]!)}`).join("\n")}\nreleaseDate: '2026-10-06T00:00:00Z'\n`;
  const platforms = ["linux-x64", "mac-arm64", "mac-x64", "win-x64"];
  for (const platform of platforms) {
    const [os, arch] = platform.split("-");
    const suffixes =
      os === "mac"
        ? [`${arch}.zip`, `${arch}.dmg`]
        : os === "win"
          ? ["x64.exe"]
          : ["x86_64.AppImage"];
    const names = suffixes.map((suffix) => `T3-Code-Workbench-0.0.22-${suffix}`);
    const payload: Record<string, string> = {};
    for (const name of names) {
      payload[name] = files[name] = `installer bytes for ${name}`;
      if (os !== "linux")
        payload[`${name}.blockmap`] = files[`${name}.blockmap`] = `map for ${name}`;
    }
    const infoName = `WORKBENCH-BUILD-INFO-${platform}.txt`;
    payload[infoName] = files[infoName] =
      `T3 Code Workbench desktop build\nVersion: 0.0.22\nCommit: ${sha}\nPlatform: ${os}\nArchitecture: ${arch}\nSigning status: ${os === "mac" ? "SIGNED AND NOTARIZED" : "UNSIGNED"}\nJira broker: https://workbench-auth.fgutica.workers.dev\n`;
    const manifestName =
      os === "mac"
        ? `latest-mac${arch === "x64" ? "-x64" : ""}.yml`
        : os === "linux"
          ? "latest-linux.yml"
          : "latest.yml";
    payload[manifestName] = files[manifestName] = manifest(names);
    payload[`SHA256SUMS-${platform}.txt`] = Object.keys(payload)
      .sort()
      .map((name) => `${hash(payload[name]!)}  ${name}\n`)
      .join("");
    const dir = NodePath.join(root, "artifacts", `workbench-desktop-${platform}`);
    NodeFS.mkdirSync(dir, { recursive: true });
    for (const [name, data] of Object.entries(payload))
      NodeFS.writeFileSync(NodePath.join(dir, name), data);
  }
  files["latest-mac.yml"] = manifest(
    Object.keys(files).filter((name) => /\.(zip|dmg)$/.test(name)),
  );
  delete files["latest-mac-x64.yml"];
  files["SHA256SUMS.txt"] = Object.keys(files)
    .sort()
    .map((name) => `${hash(files[name]!)}  ${name}\n`)
    .join("");
  const release = {
    id: 405421054,
    tag_name: "workbench-v0.0.22",
    target_commitish: sha,
    draft: true,
    prerelease: false,
    assets: Object.entries(files).map(([name, data]) => ({
      name,
      size: Buffer.byteLength(data),
      digest: `sha256:${hash(data)}`,
      state: "uploaded",
    })),
  };
  const run = {
    id: 37575614686,
    run_attempt: 2,
    path: ".github/workflows/workbench-release.yml",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: sha,
    status: "completed",
    conclusion: "success",
    repository: { full_name: "filipgutica/t3code" },
    head_repository: { full_name: "filipgutica/t3code" },
  };
  const step = (name: string) => ({ name, status: "completed", conclusion: "success" });
  const jobs = {
    jobs: [
      { name: "Resolve release metadata", steps: [step("Validate macOS signing credentials")] },
      { name: "Workbench quality gates", steps: [] },
      { name: "Build WSL CLI runtime (linux-x64)", steps: [] },
      ...["Build macOS arm64", "Build macOS x64", "Build Linux x64", "Build Windows x64"].map(
        (name) => ({
          name,
          steps: [
            step("Configure macOS signing"),
            step("Verify macOS signature and optional notarization"),
          ],
        }),
      ),
      {
        name: "Create Workbench GitHub Release",
        steps: [step("Verify package checksums"), step("Create draft release")],
      },
    ].map((job) => ({
      ...job,
      run_id: run.id,
      run_attempt: 2,
      status: "completed",
      conclusion: "success",
    })),
  };
  const artifacts = {
    artifacts: platforms.map((platform, index) => ({
      id: index + 1,
      digest: `sha256:${"a".repeat(64)}`,
      name: `workbench-desktop-${platform}`,
      expired: false,
      size_in_bytes: 100,
      workflow_run: { id: run.id, head_sha: sha },
    })),
  };
  const downloaded = structuredClone(artifacts);
  const releases = [release];
  const ci = ["workbench-ci.yml", "workbench-quality.yml"].map((name) => [
    {
      workflow_runs: [
        {
          path: `.github/workflows/${name}`,
          head_branch: "main",
          head_sha: sha,
          event: "push",
          run_number: 1,
          run_attempt: 1,
          status: "completed",
          conclusion: "success",
        },
      ],
    },
  ]);
  const invoke = () => {
    for (const [name, value] of Object.entries({
      release,
      run,
      jobs: [jobs],
      artifacts: [artifacts],
      "artifacts-downloaded": [downloaded],
      releases: [releases],
      "ci-feature": ci[0],
      "ci-quality": ci[1],
    }))
      NodeFS.writeFileSync(NodePath.join(root, `${name}.json`), JSON.stringify(value));
    return NodeChildProcess.spawnSync(
      process.execPath,
      [
        script,
        "--evidence-dir",
        root,
        "--version",
        "0.0.22",
        "--sha",
        sha,
        "--release-id",
        String(release.id),
        "--run-id",
        String(run.id),
      ],
      { encoding: "utf8" },
    );
  };
  return { root, release, releases, run, jobs, artifacts, ci, invoke };
}

function rejects(f: ReturnType<typeof setup>, message: string) {
  const result = f.invoke();
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain(message);
}

it("verifies existing signed Stable assets without changing them and recognizes a published retry", () =>
  fixture((f) => {
    const before = NodeFS.readFileSync(
      NodePath.join(f.root, "artifacts/workbench-desktop-mac-arm64/latest-mac.yml"),
    );
    const result = f.invoke();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      action: "publish",
      assetCount: 19,
      sourceSha: sha,
    });
    expect(
      NodeFS.readFileSync(
        NodePath.join(f.root, "artifacts/workbench-desktop-mac-arm64/latest-mac.yml"),
      ),
    ).toEqual(before);
    f.release.draft = false;
    expect(JSON.parse(f.invoke().stdout).action).toBe("already-published");
  }));

it("rejects asset corruption, missing assets, and a different release source", () =>
  fixture((f) => {
    f.release.assets[0]!.digest = `sha256:${"0".repeat(64)}`;
    rejects(f, "Release asset differs");
    f.release.assets.pop();
    rejects(f, "Release inventory");
    f.release.target_commitish = "b".repeat(40);
    rejects(f, "Release identity");
  }));

it("rejects skipped signing, unsuccessful or untrusted runs, expired artifacts, and stale source CI", () =>
  fixture((f) => {
    const signing = f.jobs.jobs[0]!.steps[0]!;
    signing.conclusion = "skipped";
    rejects(f, "Signing verification");
    signing.conclusion = "success";
    f.run.conclusion = "failure";
    rejects(f, "Build run");
    f.run.conclusion = "success";
    f.run.head_branch = "feature";
    rejects(f, "Build run");
    f.run.head_branch = "main";
    f.artifacts.artifacts[0]!.expired = true;
    rejects(f, "Build artifacts");
    f.artifacts.artifacts[0]!.expired = false;
    f.ci[0]![0]!.workflow_runs.push({
      ...f.ci[0]![0]!.workflow_runs[0]!,
      run_attempt: 2,
      conclusion: "failure",
    });
    rejects(f, "Source CI");
  }));

it("rejects corrupted artifact bytes and a checksummed build-info source mismatch", () =>
  fixture((f) => {
    const file = NodePath.join(
      f.root,
      "artifacts/workbench-desktop-mac-arm64/WORKBENCH-BUILD-INFO-mac-arm64.txt",
    );
    NodeFS.writeFileSync(file, NodeFS.readFileSync(file, "utf8").replace(sha, "b".repeat(40)));
    rejects(f, "Platform checksum");
    const checksum = NodePath.join(
      f.root,
      "artifacts/workbench-desktop-mac-arm64/SHA256SUMS-mac-arm64.txt",
    );
    const infoName = NodePath.basename(file);
    NodeFS.writeFileSync(
      checksum,
      NodeFS.readFileSync(checksum, "utf8").replace(
        new RegExp(`[a-f0-9]{64}  ${infoName}`),
        `${hash(NodeFS.readFileSync(file, "utf8"))}  ${infoName}`,
      ),
    );
    rejects(f, "Build identity/signing differs");
  }));

it("rejects replaced artifacts and a Stable draft superseded during recovery", () =>
  fixture((f) => {
    f.artifacts.artifacts[0]!.id = 99;
    rejects(f, "Build artifacts changed after download");
    f.artifacts.artifacts[0]!.id = 1;
    f.releases.push({ ...f.release, id: 123, tag_name: "workbench-v0.0.23", draft: false });
    rejects(f, "Stable version is superseded");
    f.releases.at(-1)!.prerelease = true;
    rejects(f, "Stable version is superseded");
    f.release.draft = false;
    expect(JSON.parse(f.invoke().stdout).action).toBe("already-published");
  }));
