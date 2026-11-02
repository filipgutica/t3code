// @effect-diagnostics nodeBuiltinImport:off - Exercise release planning through its CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

const script = NodePath.resolve(import.meta.dirname, "resolve-workbench-daily-release.ts");
const sha = "a".repeat(40);
const stable = {
  tag_name: "workbench-v0.4.7",
  draft: false,
  published_at: "2026-10-30T00:00:00Z",
  body: "",
};
const published = (output: Record<string, string>, draft = false) => ({
  tag_name: output.tag,
  draft,
  published_at: draft ? null : "2026-11-01T00:00:00Z",
  body: `<!-- workbench-daily: ${output.metadata_json} -->`,
});
const run = (releases: unknown[] = [stable], args: string[] = []) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-release-"));
  try {
    const file = NodePath.join(root, "releases.json");
    NodeFS.writeFileSync(file, JSON.stringify([releases]));
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      [
        script,
        "--releases-file",
        file,
        "--sha",
        sha,
        "--date",
        "20261101",
        "--run-number",
        "9",
        "--run-id",
        "123",
        ...args,
      ],
      { cwd: root, encoding: "utf8" },
    );
    const output = Object.fromEntries(
      result.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1)];
        }),
    );
    return { ...result, output };
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
};

it("allows an own nightly when the same main source was already released", () => {
  const first = run();
  expect(first.status, first.stderr).toBe(0);
  const next = run([stable, published(first.output)], ["--run-number", "10", "--run-id", "124"]);
  expect(next.status, next.stderr).toBe(0);
  expect(next.output).toMatchObject({
    should_release: "true",
    version: "0.4.9-nightly.20261101.10",
    release_channel: "nightly",
  });
});

it.each([
  ["major", "1.0.0"],
  ["minor", "0.5.0"],
  ["patch", "0.4.8"],
])("allows an own stable with a %s bump", (bump, version) => {
  const result = run([stable], ["--channel", "stable", "--bump", bump!]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.output).toMatchObject({
    should_release: "true",
    version,
    release_channel: "latest",
    tag: `workbench-v${version}`,
  });
});

it.each([
  ["v2.0.0", "1.0.0"],
  ["v1.3.0", "0.5.0"],
  ["v1.2.4", "0.4.9"],
])("matches upstream %s while keeping Workbench's own version sequence", (upstream, expected) => {
  const prior = {
    ...stable,
    tag_name: "workbench-daily-v0.4.8-nightly.20261031.8",
    body: '<!-- workbench-daily: {"upstreamTag":"v1.2.3","runId":"122"} -->',
  };
  for (const channel of ["stable", "nightly"]) {
    const result = run([stable, prior], ["--channel", channel, "--upstream-tag", upstream!]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.output.version).toBe(
      channel === "stable" ? expected : `${expected}-nightly.20261101.9`,
    );
    expect(JSON.parse(result.output.metadata_json!).upstreamTag).toBe(upstream);
  }
});

it("continues a nightly base and promotes it to stable without applying the upstream bump twice", () => {
  const prior = {
    ...stable,
    tag_name: "workbench-daily-v1.0.0-nightly.20261031.8",
    body: '<!-- workbench-daily: {"upstreamTag":"v2.0.0-nightly.20261031.1","runId":"122"} -->',
  };
  const nightly = run([stable, prior], ["--upstream-tag", "v2.0.0-nightly.20261101.2"]);
  expect(nightly.status, nightly.stderr).toBe(0);
  expect(nightly.output.version).toBe("1.0.0-nightly.20261101.9");
  const promotion = run([stable, prior], ["--channel", "stable", "--upstream-tag", "v2.0.0"]);
  expect(promotion.status, promotion.stderr).toBe(0);
  expect(promotion.output.version).toBe("1.0.0");
});

it("applies successive upstream minor bumps to the current Workbench nightly base", () => {
  const prior = {
    ...stable,
    tag_name: "workbench-daily-v0.5.0-nightly.20261031.8",
    body: '<!-- workbench-daily: {"upstreamTag":"v1.3.0-nightly.20261031.1","runId":"122"} -->',
  };
  const result = run([stable, prior], ["--upstream-tag", "v1.4.0-nightly.20261101.2"]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.output.version).toBe("0.6.0-nightly.20261101.9");
});

it("deduplicates an upstream event without blocking an own release of that source", () => {
  const first = run([stable], ["--upstream-tag", "v1.2.4"]);
  expect(first.status, first.stderr).toBe(0);
  const releases = [stable, published(first.output)];
  const automatic = run(releases, [
    "--upstream-tag",
    "v1.2.4",
    "--run-id",
    "124",
    "--run-number",
    "10",
  ]);
  expect(automatic.output).toMatchObject({ should_release: "false", reason: "already-mirrored" });
  const own = run(releases, ["--run-id", "124", "--run-number", "10"]);
  expect(own.output.should_release).toBe("true");
});

it("keeps a rerun's version and treats a completed publication as idempotent", () => {
  const first = run();
  const retry = run([stable, published(first.output, true)]);
  expect(retry.status, retry.stderr).toBe(0);
  expect(retry.output).toMatchObject({ should_release: "true", version: first.output.version });
  expect(run([stable, published(first.output)]).output).toMatchObject({
    should_release: "false",
    reason: "already-published",
  });
});

it("does not require Git history, upstream provenance, or old assets to release main", () => {
  const legacy = {
    ...stable,
    tag_name: "workbench-daily-v0.4.8-nightly.20261031.8",
    body: '<!-- workbench-daily: {"upstreamBase":"unrelated","sourceSha":"older"} -->',
    assets: [],
  };
  const result = run([stable, legacy]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.output.should_release).toBe("true");
});
