// @effect-diagnostics nodeBuiltinImport:off - Allocate release versions from GitHub release history.
import * as NodeFS from "node:fs";
import * as NodeUtil from "node:util";

type Release = {
  tag_name: string;
  draft: boolean;
  published_at: string | null;
  body: string | null;
};
type Bump = "major" | "minor" | "patch" | "none";
const baseVersion = (tag: string) =>
  tag
    .match(/^(?:workbench-(?:daily-)?v|v)(\d+)\.(\d+)\.(\d+)/)
    ?.slice(1, 4)
    .map(Number);
const compare = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
const increment = (version: number[], bump: Bump) =>
  bump === "major"
    ? [version[0]! + 1, 0, 0]
    : bump === "minor"
      ? [version[0]!, version[1]! + 1, 0]
      : bump === "patch"
        ? [version[0]!, version[1]!, version[2]! + 1]
        : version;
const metadata = (release: Release): Record<string, unknown> => {
  const match = release.body?.match(/<!-- workbench-daily: ([^\n]+) -->/);
  try {
    const value: unknown = match ? JSON.parse(match[1]!) : {};
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

try {
  const { values } = NodeUtil.parseArgs({
    options: {
      "releases-file": { type: "string" },
      date: { type: "string" },
      "run-number": { type: "string" },
      "run-id": { type: "string" },
      sha: { type: "string" },
      channel: { type: "string", default: "nightly" },
      bump: { type: "string", default: "patch" },
      "upstream-tag": { type: "string", default: "" },
      "github-output": { type: "string" },
    },
  });
  if (
    !values["releases-file"] ||
    !/^[a-f0-9]{40}$/.test(values.sha ?? "") ||
    !/^\d{8}$/.test(values.date ?? "") ||
    !/^[1-9]\d*$/.test(values["run-number"] ?? "") ||
    !/^[1-9]\d*$/.test(values["run-id"] ?? "") ||
    !["nightly", "stable"].includes(values.channel!) ||
    !["major", "minor", "patch", "none"].includes(values.bump!)
  )
    throw new Error("Expected release history, SHA, date, run identity, channel and version bump");
  const raw: unknown = JSON.parse(NodeFS.readFileSync(values["releases-file"], "utf8"));
  if (!Array.isArray(raw)) throw new Error("Expected GitHub release pages");
  const releases = (raw.flat() as Release[]).filter((r) =>
    /^workbench-(?:daily-)?v/.test(r.tag_name),
  );
  const published = releases
    .filter((r) => !r.draft && r.published_at)
    .sort((a, b) => Date.parse(b.published_at!) - Date.parse(a.published_at!));
  const priorRun = releases.find((r) => String(metadata(r).runId ?? "") === values["run-id"]);
  const mirrored = values["upstream-tag"]
    ? releases.find((r) => metadata(r).upstreamTag === values["upstream-tag"])
    : undefined;
  const allocated = priorRun ?? mirrored;
  const lastUpstream = published
    .map(metadata)
    .find((m) => typeof m.upstreamTag === "string" && m.upstreamTag);
  let bump = values.bump as Bump;
  const previous = lastUpstream && baseVersion(String(lastUpstream.upstreamTag));
  const current = baseVersion(values["upstream-tag"]!);
  if (previous && current)
    bump =
      current[0] !== previous[0]
        ? "major"
        : current[1] !== previous[1]
          ? "minor"
          : current[2] !== previous[2]
            ? "patch"
            : "none";
  const stable = releases.filter((r) => /^workbench-v\d+\.\d+\.\d+$/.test(r.tag_name));
  const stableBase = stable
    .map((r) => baseVersion(r.tag_name)!)
    .sort((a, b) => compare(b, a))[0] ?? [0, 0, 0];
  let base = stableBase;
  const nightlyBase = releases
    .filter((r) => r.tag_name.startsWith("workbench-daily-v"))
    .map((r) => baseVersion(r.tag_name))
    .filter((v): v is number[] => Boolean(v))
    .sort((a, b) => compare(b, a))[0];
  if (nightlyBase && compare(nightlyBase, base) > 0) base = nightlyBase;
  base = increment(base, bump);
  if (bump === "none" && stable.some((r) => r.tag_name === `workbench-v${base.join(".")}`))
    base = increment(base, "patch");
  const channel = values.channel === "stable" ? "latest" : "nightly";
  const version =
    allocated?.tag_name.replace(/^workbench-(?:daily-)?v/, "") ??
    (channel === "latest"
      ? base.join(".")
      : `${base.join(".")}-nightly.${values.date}.${values["run-number"]}`);
  const tag = `workbench-${channel === "nightly" ? "daily-" : ""}v${version}`;
  const reason =
    priorRun && !priorRun.draft
      ? "already-published"
      : mirrored && !mirrored.draft
        ? "already-mirrored"
        : "build";
  const identity = {
    schemaVersion: 2,
    channel,
    version,
    tag,
    sourceSha: values.sha,
    date: values.date,
    runNumber: Number(values["run-number"]),
    runId: values["run-id"],
    ...(values["upstream-tag"] ? { upstreamTag: values["upstream-tag"] } : {}),
  };
  const result = {
    should_release: String(reason === "build"),
    reason,
    sha: values.sha!,
    release_channel: channel,
    version,
    tag,
    previous_tag:
      published.find((r) => channel === "nightly" || /^workbench-v\d+\.\d+\.\d+$/.test(r.tag_name))
        ?.tag_name ?? "",
    metadata_json: JSON.stringify(identity),
  };
  const output = Object.entries(result)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  if (values["github-output"]) NodeFS.appendFileSync(values["github-output"], output);
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
