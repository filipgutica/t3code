import {
  Provider,
  parseUpdateInfo,
  resolveFiles,
} from "electron-updater/out/providers/Provider.js";
import type { UpdateInfo } from "electron-updater";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider.js";
import type { ResolvedUpdateFileInfo } from "electron-updater/out/types.js";
import * as Schema from "effect/Schema";

const WORKBENCH_RELEASES_API = "https://api.github.com/repos/filipgutica/t3code/releases";
const WORKBENCH_DOWNLOAD_BASE = "https://github.com/filipgutica/t3code/releases/download";
const WORKBENCH_TAG = /^workbench-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const GithubRelease = Schema.Struct({
  draft: Schema.Boolean,
  tag_name: Schema.String,
  name: Schema.NullOr(Schema.String),
  body: Schema.NullOr(Schema.String),
  published_at: Schema.NullOr(Schema.String),
  assets: Schema.Array(
    Schema.Struct({
      name: Schema.String,
    }),
  ),
});
const GithubReleases = Schema.Array(GithubRelease);
const decodeGithubReleases = Schema.decodeUnknownSync(GithubReleases);

export type WorkbenchGithubRelease = typeof GithubRelease.Type;

export interface WorkbenchUpdateInfo extends UpdateInfo {
  readonly tag: string;
}

interface WorkbenchGithubOptions {
  readonly channel?: string | null;
}

interface UpdaterVersionSource {
  readonly currentVersion: { readonly version: string };
}

/** Returns the highest published Workbench release from GitHub's API response. */
export function selectLatestWorkbenchRelease(
  releases: readonly WorkbenchGithubRelease[],
  requiredAssetName?: string,
): (WorkbenchGithubRelease & { readonly version: string }) | null {
  let latest: (WorkbenchGithubRelease & { readonly version: string }) | null = null;

  for (const release of releases) {
    if (release.draft || release.published_at === null) continue;
    if (requiredAssetName && !release.assets.some((asset) => asset.name === requiredAssetName)) {
      continue;
    }

    const match = WORKBENCH_TAG.exec(release.tag_name);
    if (!match) continue;

    const version = `${match[1]}.${match[2]}.${match[3]}`;
    if (latest === null || compareVersions(version, latest.version) > 0) {
      latest = { ...release, version };
    }
  }

  return latest;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);

  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return difference;
  }

  return 0;
}

function releaseBaseUrl(tag: string): URL {
  return new URL(`${WORKBENCH_DOWNLOAD_BASE}/${encodeURIComponent(tag)}/`);
}

function makeNoUpdateInfo(version: string, tag = `workbench-v${version}`): WorkbenchUpdateInfo {
  return {
    version,
    files: [],
    path: "",
    sha512: "",
    releaseDate: "1970-01-01T00:00:00.000Z",
    releaseName: null,
    releaseNotes: null,
    tag,
  };
}

/**
 * electron-updater's built-in GitHub provider uses `/releases/latest`, which
 * excludes prereleases and does not filter the tag namespace. Workbench releases use a
 * separate `workbench-v` namespace and may be published as prereleases, so
 * resolve the release explicitly before delegating manifest/file handling to
 * electron-updater's shared provider helpers.
 */
export class WorkbenchGithubProvider extends Provider<WorkbenchUpdateInfo> {
  private readonly options: WorkbenchGithubOptions;
  private readonly currentVersion: string;

  constructor(
    options: WorkbenchGithubOptions,
    updater: UpdaterVersionSource,
    runtimeOptions: ProviderRuntimeOptions,
  ) {
    super(runtimeOptions);
    this.options = options;
    this.currentVersion = updater.currentVersion.version;
  }

  async getLatestVersion(): Promise<WorkbenchUpdateInfo> {
    const releases: WorkbenchGithubRelease[] = [];
    for (let page = 1; ; page += 1) {
      const releasesResponse = await this.httpRequest(
        new URL(`${WORKBENCH_RELEASES_API}?per_page=100&page=${page}`),
        { Accept: "application/vnd.github+json" },
      );
      if (releasesResponse === null) break;

      let pageReleases: readonly WorkbenchGithubRelease[];
      try {
        pageReleases = decodeGithubReleases(JSON.parse(releasesResponse));
      } catch (cause) {
        throw new Error("GitHub returned an invalid Workbench release list.", { cause });
      }

      releases.push(...pageReleases);
      if (pageReleases.length < 100) break;
    }

    const channelFile = this.channelFileName();
    const latestOverall = selectLatestWorkbenchRelease(releases);
    const latest = selectLatestWorkbenchRelease(releases, channelFile);
    const selected =
      latest ??
      (latestOverall && compareVersions(latestOverall.version, this.currentVersion) <= 0
        ? latestOverall
        : null);
    if (selected === null) {
      // A release can be visible before its platform manifest is uploaded,
      // and an empty repository is a valid no-update state. Returning the
      // installed version keeps those cases quiet instead of surfacing a
      // transient 404 as an updater error.
      return makeNoUpdateInfo(this.currentVersion);
    }

    const tag = selected.tag_name;
    if (compareVersions(selected.version, this.currentVersion) <= 0) {
      // Do not fetch a manifest for an older release. This matters while a
      // release is being assembled, because GitHub can expose the release
      // before all platform manifests have been uploaded.
      return makeNoUpdateInfo(this.currentVersion);
    }

    const channelUrl = new URL(channelFile, releaseBaseUrl(tag));
    const updateResponse = await this.httpRequest(channelUrl, {
      Accept: "text/yaml, text/plain, */*",
    });
    const updateInfo = parseUpdateInfo(updateResponse, channelFile, channelUrl);
    if (updateInfo.version !== selected.version) {
      throw new Error(
        `Workbench release ${tag} manifest version ${updateInfo.version} does not match ${selected.version}.`,
      );
    }

    return {
      ...updateInfo,
      version: selected.version,
      releaseName: selected.name ?? updateInfo.releaseName ?? null,
      releaseNotes: selected.body ?? updateInfo.releaseNotes ?? null,
      tag,
    };
  }

  resolveFiles(updateInfo: WorkbenchUpdateInfo): Array<ResolvedUpdateFileInfo> {
    const baseUrl = releaseBaseUrl(updateInfo.tag);
    for (const file of updateInfo.files) {
      const resolvedUrl = new URL(file.url, baseUrl);
      if (
        resolvedUrl.origin !== baseUrl.origin ||
        !resolvedUrl.pathname.startsWith(baseUrl.pathname)
      ) {
        throw new Error(`Workbench update asset is outside its GitHub release: ${file.url}`);
      }
    }

    return resolveFiles(updateInfo, baseUrl);
  }

  private channelFileName(): string {
    if (this.options.channel === "latest" || this.options.channel == null) {
      return `${this.getDefaultChannelName()}.yml`;
    }

    return `${this.getCustomChannelName(this.options.channel)}.yml`;
  }
}
