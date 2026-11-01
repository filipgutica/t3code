// @effect-diagnostics nodeBuiltinImport:off - Exercise published release selection against real Git history.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

const script = NodePath.resolve(import.meta.dirname, "workbench-published-release.ts");
const stepScript = (file: string, name: string) => {
  const workflow = NodeFS.readFileSync(
    NodePath.resolve(import.meta.dirname, "../.github/workflows", file),
    "utf8",
  );
  const step = workflow.split(`name: ${name}\n`)[1]?.split(/\n      - /)[0];
  const body = step?.split("        run: |\n")[1];
  if (!body) throw new Error(`Missing workflow shell step: ${name}`);
  return body.replace(/^          /gm, "");
};
const nightly = {
  tag_name: "v0.1.7-nightly.20261101.4035",
  draft: false,
  prerelease: true,
  published_at: "2026-11-01T15:18:38Z",
};
const fixture = (body: (f: ReturnType<typeof setup>) => void) => {
  const f = setup();
  try {
    body(f);
  } finally {
    NodeFS.rmSync(f.root, { recursive: true, force: true });
  }
};
const setup = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-published-"));
  const git = (...args: string[]) =>
    NodeChildProcess.execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const write = (path: string, value: unknown) => {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, path), JSON.stringify(value));
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
  write("source", "published upstream");
  const upstream = commit();
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "tag",
    "-a",
    nightly.tag_name,
    "-m",
    "published",
    upstream,
  );
  git("update-ref", "refs/remotes/upstream/published", git("rev-parse", nightly.tag_name));
  write("scripts/workbench-ci-scope.json", { upstreamBase: upstream });
  const synced = commit();
  write("owner-change", "preserved owner integration");
  const owner = commit();
  git("switch", "-qc", "upstream-change", upstream);
  write("source", "unreleased upstream");
  const unreleased = commit();
  git("checkout", "--detach", owner);
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "merge",
    "--no-commit",
    "--no-ff",
    unreleased,
  );
  write("scripts/workbench-ci-scope.json", { upstreamBase: unreleased });
  const main = commit();
  const run = (releases: unknown[] = [nightly], args: string[] = []) => {
    const file = NodePath.join(root, ".git", "releases.json");
    NodeFS.writeFileSync(file, JSON.stringify([releases]));
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      [script, "--releases-file", file, ...args],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    return { ...result, output: result.status === 0 ? JSON.parse(result.stdout) : null };
  };
  const runStep = (file: string, name: string, release: unknown) => {
    const releases = NodePath.join(root, ".git", "workflow-releases.json");
    NodeFS.writeFileSync(releases, JSON.stringify(release));
    NodeFS.symlinkSync(script, NodePath.join(root, "scripts/workbench-published-release.ts"));
    try {
      return NodeChildProcess.spawnSync(
        "bash",
        [
          "-e",
          "-o",
          "pipefail",
          "-c",
          `
        gh() { cat "$WORKFLOW_RELEASES"; }
        git() {
          if [[ "$1" == fetch && "$3" == https://github.com/pingdotgg/t3code.git ]]; then
            command git fetch --no-tags "$PWD" "$4"
          else command git "$@"; fi
        }
        ${stepScript(file, name)}
      `,
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            WORKFLOW_RELEASES: releases,
            RUNNER_TEMP: NodePath.join(root, ".git"),
            GITHUB_OUTPUT: NodePath.join(root, ".git", "outputs"),
            CAPTURED_SHA: main,
            PUBLISHED_UPSTREAM_TAG: nightly.tag_name,
            DAILY_METADATA_JSON: JSON.stringify({ upstreamBase: upstream }),
          },
        },
      );
    } finally {
      NodeFS.unlinkSync(NodePath.join(root, "scripts/workbench-published-release.ts"));
    }
  };
  return { root, git, write, commit, upstream, synced, owner, unreleased, main, run, runStep };
};

it("selects the latest publication across stable and nightly, ignoring drafts and unpublished entries", () =>
  fixture((f) => {
    const stable = {
      ...nightly,
      tag_name: "v0.1.8",
      prerelease: false,
      published_at: "2026-11-01T16:00:00Z",
    };
    const result = f.run([
      { ...nightly, tag_name: "v0.1.9", published_at: "2026-11-01T18:00:00Z", draft: true },
      { ...nightly, tag_name: "v0.2.0", published_at: null },
      stable,
      nightly,
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toMatchObject({ tag: "v0.1.8", channel: "stable" });
  }));

it("rejects an unsupported or ambiguous latest publication instead of silently choosing an older release", () =>
  fixture((f) => {
    expect(
      f.run([nightly, { ...nightly, tag_name: "candidate", published_at: "2026-11-01T18:00:00Z" }])
        .status,
    ).toBe(1);
    expect(f.run([nightly, { ...nightly, tag_name: "v0.1.8", prerelease: false }]).status).toBe(1);
  }));

it("resolves annotated tags and selects the newest eligible main checkpoint including owner changes", () =>
  fixture((f) => {
    const result = f.run([nightly], ["--main", f.main]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toMatchObject({
      eligible: "true",
      sha: f.owner,
      upstream_sha: f.upstream,
    });
  }));

it("rejects an explicit source ahead of the published baseline and sources outside first-parent main", () =>
  fixture((f) => {
    const ahead = f.run([nightly], ["--source", f.main]);
    expect(ahead.status).toBe(1);
    expect(ahead.stderr).toContain("published upstream baseline");
    f.git("update-ref", "refs/remotes/origin/main", f.owner);
    const outside = f.run([nightly], ["--source", f.main]);
    expect(outside.status).toBe(1);
    expect(outside.stderr).toContain("first-parent main");
  }));

it("keeps a selected published pin valid when a newer release arrives, but rejects withdrawn releases", () =>
  fixture((f) => {
    const newer = {
      ...nightly,
      tag_name: "v0.1.8",
      prerelease: false,
      published_at: "2026-11-01T18:00:00Z",
    };
    const selected = f.run([newer, nightly], ["--tag", nightly.tag_name, "--source", f.owner]);
    expect(selected.status, selected.stderr).toBe(0);
    expect(selected.output).toMatchObject({ tag: nightly.tag_name, sha: f.owner });
    expect(f.run([newer], ["--tag", nightly.tag_name, "--source", f.owner]).status).toBe(1);
    expect(
      f.run([{ ...nightly, draft: true }], ["--tag", nightly.tag_name, "--source", f.owner]).status,
    ).toBe(1);
  }));

it("reports no eligible checkpoint and rejects a moved published tag or a false ancestry claim", () =>
  fixture((f) => {
    f.git("update-ref", "refs/remotes/upstream/published", f.main);
    const absent = f.run([nightly], ["--main", f.main]);
    expect(absent.status, absent.stderr).toBe(0);
    expect(absent.output).toMatchObject({ eligible: "false", reason: "no-published-source" });
    expect(f.run([nightly], ["--source", f.owner]).status).toBe(1);
    f.git("checkout", "--orphan", "unrelated");
    f.git("rm", "-rf", ".");
    f.write("unrelated", "different history");
    const unrelated = f.commit();
    f.git("update-ref", "refs/remotes/upstream/published", unrelated);
    f.git("update-ref", "refs/remotes/origin/main", f.owner);
    f.git("checkout", "--detach", f.owner);
    f.write("scripts/workbench-ci-scope.json", { upstreamBase: unrelated });
    const falseClaim = f.commit();
    expect(f.run([nightly], ["--source", falseClaim]).status).toBe(1);
  }));

it("executes the daily workflow selection against real history without selecting unreleased main", () =>
  fixture((f) => {
    const result = f.runStep(
      "workbench-daily-release.yml",
      "Select a checkpoint with the latest published upstream release",
      [[nightly]],
    );
    expect(result.status, result.stderr).toBe(0);
    expect(NodeFS.readFileSync(NodePath.join(f.root, ".git", "outputs"), "utf8")).toContain(
      `sha=${f.owner}\n`,
    );
  }));

it("executes the publication guard and refuses withdrawn or moved upstream tags", () =>
  fixture((f) => {
    const file = "workbench-release.yml";
    const name = "Verify published upstream source before nightly publication";
    const valid = f.runStep(file, name, nightly);
    expect(valid.status, valid.stderr).toBe(0);
    expect(f.runStep(file, name, { ...nightly, draft: true }).status).not.toBe(0);
    f.git("tag", "-f", nightly.tag_name, f.main);
    const moved = f.runStep(file, name, nightly);
    expect(moved.status).not.toBe(0);
  }));
