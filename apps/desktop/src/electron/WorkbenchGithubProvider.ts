import {
  Provider,
  parseUpdateInfo,
  resolveFiles,
} from "electron-updater/out/providers/Provider.js";
import type { UpdateInfo } from "electron-updater";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider.js";
import type { ResolvedUpdateFileInfo } from "electron-updater/out/types.js";
import type { DesktopUpdateChannel } from "@t3tools/contracts";
import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Schema from "effect/Schema";

const WORKBENCH_RELEASES_API = "https://api.github.com/repos/filipgutica/t3code/releases";
const WORKBENCH_DOWNLOAD_BASE = "https://github.com/filipgutica/t3code/releases/download";
const WORKBENCH_TAG = /^workbench-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const WORKBENCH_DAILY_TAG =
  /^workbench-daily-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-nightly\.[1-9]\d{7}\.(?:0|[1-9]\d*))$/;

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
  readonly channel?: string | null;
  readonly allowDowngrade?: boolean;
}

/** Nightly includes daily builds and their stable promotion; latest includes only stable tags. */
export function selectLatestWorkbenchRelease(
  releases: readonly WorkbenchGithubRelease[],
  requiredAssetName?: string | ((channel: DesktopUpdateChannel) => string),
  channel: DesktopUpdateChannel = "latest",
):
  | (WorkbenchGithubRelease & { readonly version: string; readonly channel: DesktopUpdateChannel })
  | null {
  let latest:
    | (WorkbenchGithubRelease & {
        readonly version: string;
        readonly channel: DesktopUpdateChannel;
      })
    | null = null;

  for (const release of releases) {
    if (release.draft || release.published_at === null) continue;
    const match = WORKBENCH_TAG.exec(release.tag_name);
    const dailyMatch = channel === "nightly" ? WORKBENCH_DAILY_TAG.exec(release.tag_name) : null;
    const version = match ? `${match[1]}.${match[2]}.${match[3]}` : dailyMatch?.[1];
    if (!version) continue;
    const releaseChannel = match ? "latest" : "nightly";
    const assetName =
      typeof requiredAssetName === "function"
        ? requiredAssetName(releaseChannel)
        : requiredAssetName;
    if (assetName && !release.assets.some((asset) => asset.name === assetName)) continue;

    if (latest === null || compareSemverVersions(version, latest.version) > 0) {
      latest = { ...release, version, channel: releaseChannel };
    }
  }

  return latest;
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
 * separate stable and daily namespaces and may be published as prereleases, so
 * resolve the release explicitly before delegating manifest/file handling to
 * electron-updater's shared provider helpers.
 */
export class WorkbenchGithubProvider extends Provider<WorkbenchUpdateInfo> {
  private readonly options: WorkbenchGithubOptions;
  private readonly currentVersion: string;
  private readonly updater: UpdaterVersionSource;

  constructor(
    options: WorkbenchGithubOptions,
    updater: UpdaterVersionSource,
    runtimeOptions: ProviderRuntimeOptions,
  ) {
    super(runtimeOptions);
    this.options = options;
    this.currentVersion = updater.currentVersion.version;
    this.updater = updater;
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

    const channel = this.updater.channel ?? this.options.channel ?? "latest";
    if (channel !== "latest" && channel !== "nightly") return makeNoUpdateInfo(this.currentVersion);
    const selected = selectLatestWorkbenchRelease(
      releases,
      (releaseChannel) => this.channelFileName(releaseChannel),
      channel,
    );
    if (selected === null) {
      // A release can be visible before its platform manifest is uploaded,
      // and an empty repository is a valid no-update state. Returning the
      // installed version keeps those cases quiet instead of surfacing a
      // transient 404 as an updater error.
      return makeNoUpdateInfo(this.currentVersion);
    }

    const tag = selected.tag_name;
    const comparison = compareSemverVersions(selected.version, this.currentVersion);
    // Native nightly polling keeps allowDowngrade=true. Only a deliberate
    // switch back to latest may offer an older release; ordinary polls stay monotonic.
    const stableSwitchBack = channel === "latest" && this.updater.allowDowngrade === true;
    if (comparison === 0 || (comparison < 0 && !stableSwitchBack)) {
      return makeNoUpdateInfo(this.currentVersion);
    }

    const channelFile = this.channelFileName(selected.channel);
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

  private channelFileName(channel: DesktopUpdateChannel): string {
    if (channel === "latest") {
      return `${this.getDefaultChannelName()}.yml`;
    }

    return `${this.getCustomChannelName(channel)}.yml`;
  }
}
