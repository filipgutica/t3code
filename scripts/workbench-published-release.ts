// @effect-diagnostics nodeBuiltinImport:off - Resolve published release and Git source identity before installation.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeUtil from "node:util";

const SHA = /^[a-f0-9]{40}$/;
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-nightly\.\d{8}\.[1-9]\d*)?$/;
const git = (...args: string[]) =>
  NodeChildProcess.execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

try {
  const { values } = NodeUtil.parseArgs({
    options: {
      "releases-file": { type: "string" },
      tag: { type: "string" },
      main: { type: "string" },
      source: { type: "string" },
      "github-output": { type: "string" },
    },
    strict: true,
  });
  if (!values["releases-file"] || (values.main && values.source))
    throw new Error("Require --releases-file and at most one of --main or --source");
  const raw: unknown = JSON.parse(NodeFS.readFileSync(values["releases-file"], "utf8"));
  if (!Array.isArray(raw)) throw new Error("Expected GitHub release pages");
  const releases = raw
    .flat()
    .map((value: unknown) => {
      if (
        typeof value !== "object" ||
        value === null ||
        !("tag_name" in value) ||
        !("draft" in value) ||
        !("prerelease" in value) ||
        !("published_at" in value) ||
        typeof value.tag_name !== "string" ||
        typeof value.draft !== "boolean" ||
        typeof value.prerelease !== "boolean" ||
        (value.published_at !== null && typeof value.published_at !== "string")
      )
        throw new Error("Invalid GitHub release");
      return {
        tag: value.tag_name,
        draft: value.draft,
        prerelease: value.prerelease,
        publishedAt: value.published_at,
      };
    })
    .filter((release) => !release.draft && release.publishedAt !== null);
  for (const release of releases)
    if (!Number.isFinite(Date.parse(release.publishedAt!)))
      throw new Error("Invalid publication date");
  releases.sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!));
  const selected = values.tag
    ? releases.filter((release) => release.tag === values.tag)
    : releases.filter((release) => release.publishedAt === releases[0]?.publishedAt);
  if (selected.length !== 1) throw new Error("Missing or ambiguous published upstream release");
  const release = selected[0]!;
  const match = release.tag.match(TAG);
  if (!match || release.prerelease !== Boolean(match[4]))
    throw new Error(`Unsupported published upstream release: ${release.tag}`);
  const output: Record<string, string> = {
    tag: release.tag,
    channel: release.prerelease ? "nightly" : "stable",
  };
  if (values.main || values.source) {
    const requested = values.main ?? values.source!;
    if (!SHA.test(requested)) throw new Error("Source must be a full Git SHA");
    const pin = git("rev-parse", "--verify", "refs/remotes/upstream/published^{commit}");
    const main = values.main ?? git("rev-parse", "refs/remotes/origin/main");
    const checkpoints = git("rev-list", "--first-parent", main).split("\n");
    if (values.source && !checkpoints.includes(values.source))
      throw new Error("Selected source must be on first-parent main");
    const eligible = (sha: string) => {
      let baseline: unknown;
      try {
        baseline = JSON.parse(git("show", `${sha}:scripts/workbench-ci-scope.json`)).upstreamBase;
      } catch {
        return false;
      }
      if (baseline !== pin) return false;
      const ancestry = NodeChildProcess.spawnSync("git", ["merge-base", "--is-ancestor", pin, sha]);
      if (ancestry.status === 1) return false;
      if (ancestry.status !== 0) throw new Error("Cannot verify published upstream ancestry");
      return true;
    };
    const sha = (values.source ? [values.source] : checkpoints).find(eligible);
    if (!sha && values.source)
      throw new Error("Source does not match the published upstream baseline and ancestry");
    Object.assign(output, {
      upstream_sha: pin,
      eligible: String(Boolean(sha)),
      reason: sha ? "published-source" : "no-published-source",
      sha: sha ?? "",
    });
  }
  if (values["github-output"])
    NodeFS.appendFileSync(
      values["github-output"],
      Object.entries(output)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  process.stdout.write(`${JSON.stringify(output)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
