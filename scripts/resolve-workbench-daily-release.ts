// @effect-diagnostics nodeBuiltinImport:off - Release planning reads Git and Actions inputs.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeUtil from "node:util";

const NUMBER = "(0|[1-9]\\d*)";
const STABLE_TAG = new RegExp(`^workbench-v${NUMBER}\\.${NUMBER}\\.${NUMBER}$`);
const DAILY_TAG = new RegExp(
  `^workbench-daily-v${NUMBER}\\.${NUMBER}\\.${NUMBER}-nightly\\.(\\d{8})\\.([1-9]\\d*)$`,
);
const SHA = /^[a-f0-9]{40}$/;
// Only the strict stable and nightly grammars above reach this comparison.
// Keeping the planner dependency-free lets the read-only resolve jobs run before installation.
const compareReleaseVersions = (left: string, right: string): number => {
  const a = left.split(/[-.]/);
  const b = right.split(/[-.]/);
  for (const index of [0, 1, 2]) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference !== 0) return difference;
  }
  if (a.length === 3 || b.length === 3) return Number(a.length === 3) - Number(b.length === 3);
  return Number(a[4]) - Number(b[4]) || Number(a[5]) - Number(b[5]);
};
const REQUIRED_ASSETS = [
  "nightly.yml",
  "nightly-linux.yml",
  "nightly-mac.yml",
  "workbench-release.json",
  "SHA256SUMS.txt",
];

interface Release {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  body: string;
  assets: ReadonlyArray<{ name: string }>;
}

interface Metadata {
  schemaVersion: 1;
  channel: "nightly";
  version: string;
  tag: string;
  sourceSha: string;
  date: string;
  runNumber: number;
  runId: string;
  sourceVersions: { desktop: string; server: string; web: string; contracts: string };
  upstreamProviderCompatibilityVersion: string;
  upstreamBase: string;
}

const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }
  return value as Record<string, unknown>;
};
const string = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("Expected a JSON string");
  return value;
};
const git = (...args: string[]): string =>
  NodeChildProcess.execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
const validDate = (value: string): boolean => {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && day > 0 && day <= (days[month - 1] ?? 0);
};
const readReleases = (file: string): Release[] => {
  const raw: unknown = JSON.parse(NodeFS.readFileSync(file, "utf8"));
  if (!Array.isArray(raw)) throw new Error("Expected GitHub release pages");
  return raw.flat().map((entry: unknown) => {
    const value = object(entry);
    if (typeof value.draft !== "boolean" || typeof value.prerelease !== "boolean") {
      throw new Error("Release visibility is missing");
    }
    if (!Array.isArray(value.assets)) throw new Error("Release assets are missing");
    return {
      tag_name: string(value.tag_name),
      draft: value.draft,
      prerelease: value.prerelease,
      published_at: value.published_at === null ? null : string(value.published_at),
      body: value.body === null ? "" : string(value.body),
      assets: value.assets.map((asset: unknown) => ({ name: string(object(asset).name) })),
    };
  });
};

const readMetadata = (release: Release): Metadata => {
  const marker = release.body.match(/<!-- workbench-daily: ([^\n]+) -->/);
  if (!marker?.[1]) throw new Error(`Missing daily provenance: ${release.tag_name}`);
  const value = object(JSON.parse(marker[1]));
  const versions = object(value.sourceVersions);
  const tag = string(value.tag);
  const match = tag.match(DAILY_TAG);
  const date = string(value.date);
  const runNumber = value.runNumber;
  const sourceSha = string(value.sourceSha);
  const runId = string(value.runId);
  const upstreamBase = string(value.upstreamBase);
  if (
    value.schemaVersion !== 1 ||
    value.channel !== "nightly" ||
    !match ||
    tag !== release.tag_name ||
    value.version !== tag.slice("workbench-daily-v".length) ||
    date !== match[4] ||
    !validDate(date) ||
    !Number.isSafeInteger(runNumber) ||
    runNumber !== Number(match[5]) ||
    !SHA.test(sourceSha) ||
    !/^[1-9]\d*$/.test(runId) ||
    !SHA.test(upstreamBase)
  )
    throw new Error(`Invalid daily provenance: ${release.tag_name}`);
  return {
    schemaVersion: 1,
    channel: "nightly",
    version: string(value.version),
    tag,
    sourceSha,
    date,
    runNumber: Number(runNumber),
    runId,
    sourceVersions: {
      desktop: string(versions.desktop),
      server: string(versions.server),
      web: string(versions.web),
      contracts: string(versions.contracts),
    },
    upstreamProviderCompatibilityVersion: string(value.upstreamProviderCompatibilityVersion),
    upstreamBase,
  };
};

const tagSource = (tag: string): string => git("rev-parse", "--verify", `${tag}^{commit}`);
const isAncestor = (ancestor: string, descendant: string): boolean => {
  try {
    NodeChildProcess.execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "status" in error && error.status === 1)
      return false;
    throw error;
  }
};
const sourceMetadata = (sha: string) => {
  const read = (path: string) => object(JSON.parse(git("show", `${sha}:${path}`)));
  const server = read("apps/server/package.json");
  return {
    sourceVersions: {
      desktop: string(read("apps/desktop/package.json").version),
      server: string(server.version),
      web: string(read("apps/web/package.json").version),
      contracts: string(read("packages/contracts/package.json").version),
    },
    upstreamProviderCompatibilityVersion: string(
      object(server.workbench).upstreamProviderCompatibilityVersion,
    ),
    upstreamBase: string(read("scripts/workbench-ci-scope.json").upstreamBase),
  };
};

const run = () => {
  const { values } = NodeUtil.parseArgs({
    options: {
      "releases-file": { type: "string" },
      date: { type: "string" },
      "run-number": { type: "string" },
      "run-id": { type: "string" },
      sha: { type: "string" },
      "github-output": { type: "string" },
    },
  });
  const sha = values.sha ?? "";
  const date = values.date ?? "";
  const runNumber = Number(values["run-number"]);
  const runId = values["run-id"] ?? "";
  if (
    !SHA.test(sha) ||
    !validDate(date) ||
    !/^[1-9]\d*$/.test(values["run-number"] ?? "") ||
    !Number.isSafeInteger(runNumber) ||
    !/^[1-9]\d*$/.test(runId) ||
    !values["releases-file"]
  ) {
    throw new Error("Expected an exact SHA, UTC date, positive run number/id and release file");
  }
  const main = new Set(git("rev-list", "--first-parent", "origin/main").split("\n"));
  if (!main.has(sha)) throw new Error("Daily source must be a first-parent main checkpoint");
  const releases = readReleases(values["releases-file"]);
  const ordinary = releases
    .filter((r) => !r.draft && r.published_at && STABLE_TAG.test(r.tag_name))
    .sort((a, b) => compareReleaseVersions(b.tag_name.slice(11), a.tag_name.slice(11)));
  const stable = ordinary.find((r) => !r.prerelease);
  const versionFloor = ordinary[0];
  if (!stable || !versionFloor) throw new Error("A published stable Workbench release is required");
  const stableSha = tagSource(stable.tag_name);
  if (!main.has(stableSha)) throw new Error("Stable source is outside first-parent main");
  const published = releases
    .filter((r) => !r.draft && r.published_at && DAILY_TAG.test(r.tag_name))
    .map((release) => {
      const metadata = readMetadata(release);
      if (
        !release.prerelease ||
        !REQUIRED_ASSETS.every((name) => release.assets.some((a) => a.name === name)) ||
        tagSource(release.tag_name) !== metadata.sourceSha ||
        !main.has(metadata.sourceSha)
      ) {
        throw new Error(`Incomplete or mismatched published daily release: ${release.tag_name}`);
      }
      return metadata;
    })
    .sort((a, b) => compareReleaseVersions(b.version, a.version));
  const latest = published[0];
  const priorRun = published.find((r) => r.runId === runId);
  const draft = releases.find(
    (r) =>
      r.draft &&
      DAILY_TAG.test(r.tag_name) &&
      new RegExp(`"runId"\\s*:\\s*"${runId}"`).test(r.body),
  );
  const resumed = draft ? readMetadata(draft) : undefined;
  const previous = priorRun ?? resumed;
  if (
    previous &&
    (previous.sourceSha !== sha ||
      previous.date !== date ||
      previous.runNumber !== runNumber ||
      previous.runId !== runId)
  ) {
    throw new Error("Run provenance changed; refusing to replace its release");
  }
  const identity = sourceMetadata(sha);
  if (
    previous &&
    (JSON.stringify(previous.sourceVersions) !== JSON.stringify(identity.sourceVersions) ||
      previous.upstreamProviderCompatibilityVersion !==
        identity.upstreamProviderCompatibilityVersion ||
      previous.upstreamBase !== identity.upstreamBase)
  ) {
    throw new Error("Source identity changed; refusing to resume its release");
  }
  // Ordinary previews are candidates on the existing Stable feed, but do not
  // prove that a signed daily has delivered this checkpoint on every platform.
  const floorVersion = versionFloor.tag_name.slice("workbench-v".length);
  const segments = floorVersion.split(".").map(Number);
  const nextPatch = (segments[2] ?? 0) + 1;
  if (!segments.every(Number.isSafeInteger) || !Number.isSafeInteger(nextPatch))
    throw new Error("Stable version cannot be incremented safely");
  const nextStable = `${segments[0]}.${segments[1]}.${nextPatch}`;
  const dailyBase = latest?.version.split("-")[0];
  const base =
    dailyBase && compareReleaseVersions(dailyBase, nextStable) > 0 ? dailyBase : nextStable;
  const version = previous?.version ?? `${base}-nightly.${date}.${runNumber}`;
  const metadata: Metadata = previous ?? {
    schemaVersion: 1,
    channel: "nightly",
    version,
    tag: `workbench-daily-v${version}`,
    sourceSha: sha,
    date,
    runNumber,
    runId,
    ...identity,
  };
  const reason = priorRun
    ? "already-published"
    : sha === latest?.sourceSha || sha === stableSha
      ? "unchanged"
      : compareReleaseVersions(version, floorVersion) <= 0 ||
          (latest &&
            (compareReleaseVersions(version, latest.version) <= 0 ||
              isAncestor(sha, latest.sourceSha))) ||
          isAncestor(sha, stableSha)
        ? "stale-run"
        : resumed
          ? "resume-draft"
          : "build";
  const result = {
    should_release: reason === "build" || reason === "resume-draft" ? "true" : "false",
    reason,
    sha,
    version,
    tag: metadata.tag,
    previous_tag: latest?.tag ?? stable.tag_name,
    metadata_json: JSON.stringify(metadata),
  };
  const output = Object.entries(result)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  if (values["github-output"]) NodeFS.appendFileSync(values["github-output"], output);
  else process.stdout.write(output);
};

if (import.meta.main) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
