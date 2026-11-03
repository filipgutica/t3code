// @effect-diagnostics nodeBuiltinImport:off - Execute the actual release workflow shell boundaries.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

const workflow = NodeFS.readFileSync(
  NodePath.resolve(import.meta.dirname, "../.github/workflows/workbench-release.yml"),
  "utf8",
);
const step = (name: string) => {
  const body = workflow
    .slice(workflow.lastIndexOf(`name: ${name}\n`))
    ?.split(/\n      - /)[0]
    ?.split("        run: |\n")[1];
  if (!body) throw new Error(`Missing release step: ${name}`);
  return body.replace(/^          /gm, "").replaceAll("${{ inputs.release_mode }}", "release");
};
const fixture = (body: (root: string) => void) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-release-workflow-"));
  try {
    body(root);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
};
const sha = "a".repeat(40);
const ciRun = (path: string, conclusion = "success", source = sha, status = "completed") => ({
  workflow_runs: [
    {
      path: `.github/workflows/${path}`,
      head_sha: source,
      event: "push",
      status,
      conclusion,
      run_number: 1,
      run_attempt: 1,
    },
  ],
});
const write = (root: string, name: string, value: unknown) =>
  NodeFS.writeFileSync(NodePath.join(root, name), JSON.stringify(value));
const run = (
  root: string,
  name: string | string[],
  preamble: string,
  env: Record<string, string> = {},
) =>
  NodeChildProcess.spawnSync(
    "bash",
    [
      "-e",
      "-o",
      "pipefail",
      "-c",
      `${preamble}\n${(typeof name === "string" ? [name] : name)
        .sort((a, b) => workflow.indexOf(`name: ${a}\n`) - workflow.indexOf(`name: ${b}\n`))
        .map(step)
        .join("\n")}`,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        RUNNER_TEMP: root,
        GITHUB_REPOSITORY: "filipgutica/t3code",
        RELEASE_SHA: sha,
        ...env,
      },
    },
  );
const ciPreamble = `
  gh() {
    case "$*" in
      *workbench-ci.yml*) cat "$RUNNER_TEMP/feature.json"
        if [[ -f "$RUNNER_TEMP/next-feature.json" ]]; then mv "$RUNNER_TEMP/next-feature.json" "$RUNNER_TEMP/feature.json"; fi ;;
      *workbench-quality.yml*) cat "$RUNNER_TEMP/quality.json" ;;
      *) return 1 ;;
    esac
  }
  sleep() { echo wait >> "$RUNNER_TEMP/waits"; }
`;

it("records the automatic upstream event in stable release notes", () => {
  const metadata = JSON.stringify({ schemaVersion: 2, upstreamTag: "v1.3.0" });
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    [NodePath.resolve(import.meta.dirname, "workbench-release-notes.ts")],
    {
      input: "## Changes\n- A merged change\n",
      encoding: "utf8",
      env: {
        ...process.env,
        SIGN_MACOS: "true",
        RELEASE_CHANNEL: "latest",
        RELEASE_VERSION: "0.5.0",
        RELEASE_SHA: sha,
        DAILY_METADATA_JSON: metadata,
      },
    },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain(`<!-- workbench-daily: ${metadata} -->`);
});

it.each([
  ["release", "false", 1],
  ["release", "true", 0],
  ["unsigned-preview", "false", 0],
  ["build-only", "false", 0],
])("resolves mode %s with signing %s (exit %s)", (mode, signed, status) =>
  fixture((root) => {
    const result = run(
      root,
      "Resolve release metadata",
      'git() { printf "%s\\n" "$RELEASE_SHA"; }',
      {
        RELEASE_MODE: mode!,
        SIGN_MACOS: signed!,
        RELEASE_CHANNEL: "latest",
        RELEASE_VERSION: "0.5.0",
        PREVIOUS_TAG: "",
        METADATA_JSON: "",
        GITHUB_RUN_ID: "123",
        GITHUB_OUTPUT: NodePath.join(root, "outputs"),
      },
    );
    expect(result.status, result.stderr).toBe(status);
    if (status !== 0) expect(result.stderr).toContain("require signed and notarized macOS builds");
  }),
);

it("admits a release when both named CI workflows passed on the exact commit", () =>
  fixture((root) => {
    write(root, "feature.json", [ciRun("workbench-ci.yml")]);
    write(root, "quality.json", [ciRun("workbench-quality.yml")]);
    const result = run(root, "Wait for feature CI and quality on the released commit", ciPreamble);
    expect(result.status, result.stderr).toBe(0);
    expect(NodeFS.existsSync(NodePath.join(root, "waits"))).toBe(false);
  }));

it.each(["feature", "quality"])(
  "rejects a failed %s gate even if another commit passed",
  (failed) =>
    fixture((root) => {
      for (const [name, path] of [
        ["feature", "workbench-ci.yml"],
        ["quality", "workbench-quality.yml"],
      ]) {
        const current = ciRun(path!, name === failed ? "failure" : "success");
        const other = ciRun(path!, "success", "b".repeat(40));
        write(root, `${name}.json`, [
          { workflow_runs: [...other.workflow_runs, ...current.workflow_runs] },
        ]);
      }
      const result = run(
        root,
        "Wait for feature CI and quality on the released commit",
        ciPreamble,
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("has not passed");
    }),
);

it("waits for pending CI and releases when that exact commit passes", () =>
  fixture((root) => {
    write(root, "feature.json", [ciRun("workbench-ci.yml", "", sha, "in_progress")]);
    write(root, "next-feature.json", [ciRun("workbench-ci.yml")]);
    write(root, "quality.json", [ciRun("workbench-quality.yml")]);
    const result = run(root, "Wait for feature CI and quality on the released commit", ciPreamble);
    expect(result.status, result.stderr).toBe(0);
    expect(NodeFS.readFileSync(NodePath.join(root, "waits"), "utf8")).toBe("wait\n");
  }));

it.each([
  ["latest", "false", "true", false],
  ["nightly", "true", "false", false],
  ["latest", "false", "true", true],
  ["nightly", "true", "false", true],
])(
  "publishes channel %s, prerelease %s, latest %s, existing draft %s",
  (channel, prerelease, latest, existingDraft) =>
    fixture((root) => {
      const assets = NodePath.join(root, "release-assets");
      NodeFS.mkdirSync(assets);
      const bytes = "built installer bytes";
      NodeFS.writeFileSync(NodePath.join(assets, "installer.zip"), bytes);
      NodeFS.mkdirSync(NodePath.join(root, "scripts/lib"), { recursive: true });
      for (const file of ["workbench-release-notes.ts", "lib/workbench-release-notes.ts"]) {
        NodeFS.copyFileSync(
          NodePath.join(import.meta.dirname, file),
          NodePath.join(root, "scripts", file),
        );
      }
      if (existingDraft) NodeFS.writeFileSync(NodePath.join(root, "old-tag"), "commit A");
      write(root, "uploaded.json", {
        id: 7,
        draft: true,
        assets: [
          {
            name: "installer.zip",
            state: "uploaded",
            size: Buffer.byteLength(bytes),
            digest: `sha256:${NodeCrypto.createHash("sha256").update(bytes).digest("hex")}`,
          },
        ],
      });
      const tag =
        channel === "nightly" ? "workbench-daily-v0.5.0-nightly.20261101.9" : "workbench-v0.5.0";
      write(root, "history.json", [
        existingDraft
          ? [
              {
                id: 6,
                tag_name: tag,
                draft: true,
                target_commitish: "b".repeat(40),
                body: "old source notes",
                assets: [{ name: "stale-preview.zip" }],
              },
            ]
          : [],
      ]);
      const preamble = `
      gh() {
        echo "$*" >> "$RUNNER_TEMP/calls"
        if [[ "$1" == api ]]; then
          case "$*" in
            *"generate-notes"*)
              if [[ -f "$RUNNER_TEMP/old-tag" ]]; then echo 'old source changes'; else echo 'current source changes'; fi ;;
            *"--method POST"*|*"/releases/"*) cat "$RUNNER_TEMP/uploaded.json" ;;
            *) cat "$RUNNER_TEMP/history.json" ;;
          esac
        fi
        if [[ "$1 $2" == 'release delete' ]]; then rm "$RUNNER_TEMP/old-tag"; fi
      }
    `;
      const result = run(
        root,
        ["Generate release notes from pull requests", "Publish the complete Workbench release"],
        preamble,
        {
          RELEASE_TAG: tag,
          RELEASE_CHANNEL: channel!,
          RELEASE_VERSION: "0.5.0",
          SIGN_MACOS: "true",
          PREVIOUS_TAG: "",
        },
      );
      expect(result.status, result.stderr).toBe(0);
      const calls = NodeFS.readFileSync(NodePath.join(root, "calls"), "utf8");
      expect(calls).toContain(
        `release edit ${tag} --repo filipgutica/t3code --draft=false --prerelease=${prerelease} --latest=${latest}`,
      );
      expect(calls).not.toContain("pingdotgg");
      if (existingDraft) {
        const deletion = calls.indexOf(
          `release delete ${tag} --repo filipgutica/t3code --yes --cleanup-tag`,
        );
        expect(deletion).toBeGreaterThanOrEqual(0);
        expect(calls.indexOf("generate-notes")).toBeGreaterThan(deletion);
      }
      const created = JSON.parse(
        NodeFS.readFileSync(NodePath.join(root, "workbench-create-release.json"), "utf8"),
      );
      expect(created).toMatchObject({
        target_commitish: sha,
        body: expect.stringContaining("current source changes"),
        tag_name: tag,
      });
      expect(created.body).not.toContain("old source changes");
    }),
);
