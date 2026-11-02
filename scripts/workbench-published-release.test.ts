// @effect-diagnostics nodeBuiltinImport:off - Exercise the published-tag selection CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

const script = NodePath.resolve(import.meta.dirname, "workbench-published-release.ts");
const nightly = {
  tag_name: "v0.1.7-nightly.20261101.4035",
  draft: false,
  prerelease: true,
  published_at: "2026-11-01T15:18:38Z",
};
const run = (releases: unknown[]) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-published-"));
  try {
    const file = NodePath.join(root, "releases.json");
    NodeFS.writeFileSync(file, JSON.stringify([releases]));
    const result = NodeChildProcess.spawnSync(process.execPath, [script, "--releases-file", file], {
      cwd: root,
      encoding: "utf8",
    });
    return { ...result, output: result.status === 0 ? JSON.parse(result.stdout) : null };
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
};

it("selects the latest published stable or nightly while ignoring drafts and unpublished entries", () => {
  const result = run([
    nightly,
    { ...nightly, tag_name: "v0.1.8", prerelease: false, published_at: "2026-11-01T16:00:00Z" },
    { ...nightly, tag_name: "v0.1.9", draft: true, published_at: "2026-11-01T18:00:00Z" },
    { ...nightly, tag_name: "v0.2.0", published_at: null },
  ]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.output).toMatchObject({ tag: "v0.1.8", channel: "stable" });
});

it("rejects an unsupported or ambiguous latest publication rather than choosing an older tag", () => {
  expect(
    run([nightly, { ...nightly, tag_name: "candidate", published_at: "2026-11-01T18:00:00Z" }])
      .status,
  ).toBe(1);
  expect(run([nightly, { ...nightly, tag_name: "v0.1.8", prerelease: false }]).status).toBe(1);
});

it.each([
  ["v1.0.0", "major"],
  ["v0.2.0", "minor"],
  ["v0.1.8", "patch"],
  ["v0.2.0-nightly.20261102.1", "minor"],
])("reports the upstream bump type for %s", (tag, bump) => {
  const result = run([
    { ...nightly, tag_name: "v0.1.7", prerelease: false },
    {
      ...nightly,
      tag_name: tag,
      prerelease: tag!.includes("-nightly."),
      published_at: "2026-11-02T00:00:00Z",
    },
  ]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.output.bump).toBe(bump);
});
