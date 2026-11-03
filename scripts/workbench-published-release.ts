// @effect-diagnostics nodeBuiltinImport:off - Select the upstream release before installation.
import * as NodeFS from "node:fs";
import * as NodeUtil from "node:util";

const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-nightly\.\d{8}\.[1-9]\d*)?$/;

try {
  const { values } = NodeUtil.parseArgs({
    options: {
      "releases-file": { type: "string" },
      tag: { type: "string" },
      "github-output": { type: "string" },
    },
    strict: true,
  });
  if (!values["releases-file"]) throw new Error("Require --releases-file");
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
  const version = match.slice(1, 4).map(Number);
  const previous = releases
    .slice(releases.indexOf(release) + 1)
    .map((r) => r.tag.match(TAG)?.slice(1, 4).map(Number))
    .find((v) => v !== undefined) ?? [0, 0, 0];
  output.bump =
    version[0] !== previous[0]
      ? "major"
      : version[1] !== previous[1]
        ? "minor"
        : version[2] !== previous[2]
          ? "patch"
          : "none";
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
