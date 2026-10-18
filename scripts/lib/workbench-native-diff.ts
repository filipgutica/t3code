// @effect-diagnostics nodeBuiltinImport:off - Read-only Git patch accounting.
import * as NodeChildProcess from "node:child_process";
import { isWorkbenchForkPath } from "./workbench-isolation.ts";

interface PatchSize {
  added: number;
  deleted: number;
  binary: boolean;
}

const emptyPatch = (): PatchSize => ({ added: 0, deleted: 0, binary: false });
const size = (patch: PatchSize) => patch.added + patch.deleted;

const pathKind = (path: string, upstreamPaths: ReadonlySet<string>) => {
  if (
    /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?|Cargo\.lock)$/.test(
      path,
    )
  )
    return "generated lockfile";
  return upstreamPaths.has(path) ? "upstream-owned" : "fork-added outside boundary";
};

export const collectNativeDiff = ({
  root,
  base,
  head = "HEAD",
}: {
  root: string;
  base?: string | undefined;
  head?: string | undefined;
}) => {
  const git = (args: ReadonlyArray<string>) =>
    NodeChildProcess.execFileSync("git", [...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const resolve = (ref: string) =>
    git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim();
  const headSha = resolve(head);
  const policy: unknown = JSON.parse(git(["show", `${headSha}:scripts/workbench-ci-scope.json`]));
  if (
    typeof policy !== "object" ||
    policy === null ||
    !("upstreamBase" in policy) ||
    typeof policy.upstreamBase !== "string" ||
    !/^[a-f0-9]{40}$/.test(policy.upstreamBase)
  )
    throw new Error("Invalid upstreamBase in scripts/workbench-ci-scope.json at head");
  const upstream = resolve(policy.upstreamBase);
  git(["merge-base", "--is-ancestor", upstream, headSha]);
  const baseSha = git(["merge-base", resolve(base ?? upstream), headSha]).trim();
  const baselineIntegratedAtBase = git(["merge-base", upstream, baseSha]).trim() === upstream;
  const treePaths = (ref: string) =>
    new Set(git(["ls-tree", "-r", "--name-only", "-z", ref]).split("\0").filter(Boolean));
  const upstreamPaths = treePaths(upstream);
  const basePaths = treePaths(baseSha);
  const headPaths = treePaths(headSha);
  // Disable renames so each path's residual includes the cost of removing the old
  // upstream path and adding its replacement, including moves across ownership.
  const patches = (from: string, to: string) => {
    const result = new Map<string, PatchSize>();
    for (const record of git([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--numstat",
      "-z",
      from,
      to,
      "--",
    ])
      .split("\0")
      .filter(Boolean)) {
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record);
      if (!match) throw new Error("Invalid Git numstat record");
      const [, added, deleted, path] = match;
      if (path === undefined) throw new Error("Missing Git numstat path");
      result.set(path, {
        added: added === "-" ? 0 : Number(added),
        deleted: deleted === "-" ? 0 : Number(deleted),
        binary: added === "-",
      });
    }
    return result;
  };
  const atBase = patches(upstream, baseSha);
  const atHead = patches(upstream, headSha);
  const files = [...patches(baseSha, headSha)]
    .filter(([path]) => !isWorkbenchForkPath(path))
    .map(([path, pr]) => {
      const before = atBase.get(path) ?? emptyPatch();
      const after = atHead.get(path) ?? emptyPatch();
      return {
        path,
        kind: pathKind(path, upstreamPaths),
        change: !basePaths.has(path) ? "added" : !headPaths.has(path) ? "deleted" : "modified",
        newOutsideBoundary: !basePaths.has(path) && headPaths.has(path),
        pr,
        base: before,
        head: after,
        growth: before.binary || after.binary ? null : size(after) - size(before),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  return { base: baseSha, head: headSha, upstream, baselineIntegratedAtBase, files };
};

export const renderNativeDiff = (report: ReturnType<typeof collectNativeDiff>) => {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll("|", "&#124;")
      .replaceAll("`", "&#96;")
      .replaceAll(/\r?\n/g, " ");
  const patch = (value: PatchSize) =>
    value.binary ? "binary (line count unavailable)" : `+${value.added}/−${value.deleted}`;
  return [
    "## Native diff (report only)",
    "",
    `Merge base: ${report.base}; head: ${report.head}; integrated upstream: ${report.upstream}.`,
    "PR changes and base residuals start at the merge base of the requested base and head. Residual = added + deleted lines against the same upstream baseline. Renames appear as deletion/addition paths; binary sizes are unavailable. No patch-size threshold is enforced.",
    ...(!report.baselineIntegratedAtBase
      ? ["**Baseline is not integrated at base; base residuals also include upstream changes.**"]
      : []),
    "",
    ...(report.files.length
      ? [
          "| Outside-boundary path | Classification | PR +/− | Residual at base +/− | Residual at head +/− | Growth (lines) |",
          "| --- | --- | --- | --- | --- | --- |",
          ...report.files.map(
            (file) =>
              `| ${escape(file.path)} (${file.change}) | ${file.newOutsideBoundary ? "**NEW PATH**; " : ""}${file.kind} | ${patch(file.pr)} | ${patch(file.base)} | ${patch(file.head)} | ${file.growth === null ? "unavailable" : file.growth > 0 ? `**GROWTH +${file.growth}**` : file.growth} |`,
          ),
        ]
      : ["No outside-boundary paths changed."]),
    "",
  ].join("\n");
};
