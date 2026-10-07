// @effect-diagnostics nodeBuiltinImport:off - Exercise release planning with real Git history.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

const script = NodePath.resolve(import.meta.dirname, "resolve-workbench-daily-release.ts");
const fixture = (body: (f: ReturnType<typeof setup>) => void) => {
  const f = setup();
  try {
    body(f);
  } finally {
    NodeFS.rmSync(f.root, { recursive: true, force: true });
  }
};
const setup = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-daily-"));
  const git = (...args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  const write = (path: string, content: unknown) => {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(root, path),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  };
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "checkpoint",
    );
    const sha = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", sha);
    return sha;
  };
  git("init", "-q");
  write("initial", "upstream");
  const upstream = commit();
  for (const path of ["apps/desktop", "apps/web", "packages/contracts"])
    write(`${path}/package.json`, { version: "0.0.45" });
  write("apps/server/package.json", {
    version: "0.0.45",
    workbench: { upstreamProviderCompatibilityVersion: "0.0.46" },
  });
  write("scripts/workbench-ci-scope.json", { upstreamBase: upstream });
  const stableSha = commit();
  git("tag", "workbench-v0.0.21");
  write("change", "first changed day");
  const sha = commit();
  const stable = {
    tag_name: "workbench-v0.0.21",
    draft: false,
    prerelease: false,
    published_at: "2026-10-06T04:46:00Z",
    body: "Stable",
    assets: [],
  };
  const run = (
    releases: unknown[] = [stable],
    options: { sha?: string; date?: string; number?: string; id?: string } = {},
  ) => {
    // Keep Actions inputs out of committed installable source.
    const file = NodePath.join(root, ".git", "releases.json");
    NodeFS.writeFileSync(file, JSON.stringify([releases]));
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      [
        script,
        "--releases-file",
        file,
        "--date",
        options.date ?? "20261007",
        "--run-number",
        options.number ?? "9",
        "--run-id",
        options.id ?? "123",
        "--sha",
        options.sha ?? sha,
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
  };
  const published = (output: Record<string, string>, draft = false) => ({
    tag_name: output.tag,
    draft,
    prerelease: true,
    published_at: draft ? null : "2026-10-07T07:00:00Z",
    body: `<!-- workbench-daily: ${output.metadata_json} -->`,
    assets: [
      "nightly.yml",
      "nightly-linux.yml",
      "nightly-mac.yml",
      "workbench-release.json",
      "SHA256SUMS.txt",
    ].map((name) => ({ name })),
  });
  return { root, git, write, commit, upstream, stableSha, sha, stable, run, published };
};

it("plans a changed main checkpoint from the independent stable version and records source identity", () =>
  fixture((f) => {
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toMatchObject({
      should_release: "true",
      reason: "build",
      sha: f.sha,
      version: "0.0.22-nightly.20261007.9",
      tag: "workbench-daily-v0.0.22-nightly.20261007.9",
      previous_tag: "workbench-v0.0.21",
    });
    expect(JSON.parse(result.output.metadata_json!)).toMatchObject({
      sourceSha: f.sha,
      upstreamBase: f.upstream,
      runId: "123",
      runNumber: 9,
      sourceVersions: { desktop: "0.0.45", server: "0.0.45", web: "0.0.45", contracts: "0.0.45" },
      upstreamProviderCompatibilityVersion: "0.0.46",
    });
    expect(f.run([f.stable], { sha: f.stableSha }).output).toMatchObject({
      should_release: "false",
      reason: "unchanged",
    });
  }));

it("skips successful reruns and unchanged days, resumes only matching drafts, and excludes failed checkpoints", () =>
  fixture((f) => {
    const first = f.run().output;
    f.git("tag", first.tag!, f.sha);
    const release = f.published(first);
    expect(f.run([f.stable, release]).output).toMatchObject({
      should_release: "false",
      reason: "already-published",
    });
    expect(
      f.run([f.stable, release], { date: "20261008", number: "10", id: "124" }).output,
    ).toMatchObject({ should_release: "false", reason: "unchanged" });
    expect(f.run([f.stable, f.published(first, true)]).output).toMatchObject({
      should_release: "true",
      reason: "resume-draft",
      version: first.version,
    });
    const changedRun = f.run([f.stable, f.published(first, true)], { date: "20261008" });
    expect(changedRun.status).toBe(1);
    expect(changedRun.stderr).toContain("Run provenance changed");
    const forged = f.published(
      {
        ...first,
        metadata_json: JSON.stringify({
          ...JSON.parse(first.metadata_json!),
          upstreamBase: f.stableSha,
        }),
      },
      true,
    );
    const invalidIdentity = f.run([f.stable, forged]);
    expect(invalidIdentity.status).toBe(1);
    expect(invalidIdentity.stderr).toContain("Source identity changed");
    const wrongRun = f.published(
      {
        ...first,
        metadata_json: JSON.stringify({ ...JSON.parse(first.metadata_json!), runId: "999" }),
      },
      true,
    );
    wrongRun.body += '\nUnrelated example: {"runId":"123"}';
    const invalidRun = f.run([f.stable, wrongRun]);
    expect(invalidRun.status).toBe(1);
    expect(invalidRun.stderr).toContain("Run provenance changed");
    const noPriorDraft = f.run([f.stable, f.published(first, true)], { number: "10", id: "124" });
    expect(noPriorDraft.output).toMatchObject({
      should_release: "true",
      reason: "build",
      version: "0.0.22-nightly.20261007.10",
    });
  }));

it("orders date/run builds numerically and lets the stable sequence advance independently", () =>
  fixture((f) => {
    const first = f.run().output;
    f.git("tag", first.tag!, f.sha);
    f.write("change", "second changed day");
    const next = f.commit();
    const second = f.run([f.stable, f.published(first)], { sha: next, number: "10", id: "124" });
    expect(second.output).toMatchObject({
      should_release: "true",
      version: "0.0.22-nightly.20261007.10",
    });
    f.git("tag", second.output.tag!, next);
    expect(
      f.run([f.stable, f.published(first), f.published(second.output)], {
        sha: f.sha,
        date: "20261008",
        number: "11",
        id: "125",
      }).output,
    ).toMatchObject({ should_release: "false", reason: "stale-run" });
    f.git("tag", "workbench-v0.0.22", next);
    f.write("change", "after stable promotion");
    const afterStable = f.commit();
    const stable = { ...f.stable, tag_name: "workbench-v0.0.22" };
    expect(
      f.run([f.stable, stable, f.published(first)], {
        sha: afterStable,
        date: "20261008",
        number: "11",
        id: "125",
      }).output,
    ).toMatchObject({ should_release: "true", version: "0.0.23-nightly.20261008.11" });
    expect(
      f.run([f.stable, f.published(second.output)], {
        sha: afterStable,
        date: "20261006",
        number: "8",
        id: "122",
      }).output,
    ).toMatchObject({ should_release: "false", reason: "stale-run" });
  }));

it("fails closed on incomplete publication, forged provenance and sources outside main's first-parent history", () =>
  fixture((f) => {
    const first = f.run().output;
    f.git("tag", first.tag!, f.stableSha);
    const release = f.published(first);
    const mismatch = f.run([f.stable, release]);
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain("mismatched published daily");
    f.git("tag", "-f", first.tag!, f.sha);
    for (const missing of ["nightly-mac.yml", "SHA256SUMS.txt"]) {
      const incomplete = f.run([
        f.stable,
        { ...release, assets: release.assets.filter((a) => a.name !== missing) },
      ]);
      expect(incomplete.status).toBe(1);
      expect(incomplete.stderr).toContain("Incomplete");
    }
    f.git("switch", "-qc", "unreviewed-side", f.stableSha);
    f.write("side", "unreviewed");
    f.git("add", ".");
    f.git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "side",
    );
    const side = f.git("rev-parse", "HEAD");
    f.git("switch", "--detach", f.sha);
    f.git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "merge",
      "--no-ff",
      "-m",
      "reviewed merge",
      "unreviewed-side",
    );
    const merged = f.git("rev-parse", "HEAD");
    f.git("update-ref", "refs/remotes/origin/main", merged);
    f.git("merge-base", "--is-ancestor", side, merged);
    const rejected = f.run([f.stable], { sha: side });
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("first-parent main checkpoint");
    expect(f.run([f.stable], { sha: merged }).output).toMatchObject({
      should_release: "true",
      sha: merged,
    });
    expect(f.run([f.stable], { date: "20260230" }).status).toBe(1);
  }));
