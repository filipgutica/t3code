import type { DesktopProduct, DesktopProductIdentity } from "../app/DesktopProduct.ts";
import type { DesktopUpdateChannel } from "@t3tools/contracts";
import { resolveDefaultDesktopUpdateChannel } from "../updates/updateChannels.ts";
import type { ElectronUpdaterFeedUrl } from "../electron/ElectronUpdater.ts";
import { WorkbenchGithubProvider } from "./WorkbenchGithubProvider.ts";
import { getWorkbenchDistribution, isWorkbenchMacSigned } from "./distribution.ts";

const isStablePromotion = (version: string, channel: DesktopUpdateChannel): boolean =>
  channel === "nightly" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version);

const makeProduct = (signed: boolean): DesktopProduct | null => {
  const distribution = getWorkbenchDistribution();
  if (distribution === null) return null;
  const identity = (isDevelopment: boolean): DesktopProductIdentity =>
    Object.freeze({
      appUserModelId: distribution.appId,
      linuxDesktopEntryName: distribution.desktopEntryName,
      linuxWmClass: distribution.executableName,
      scheme: `${distribution.scheme}${isDevelopment ? "-dev" : ""}`,
      profileNames: Object.freeze({
        current: isDevelopment ? distribution.executableName : `${distribution.executableName}-v2`,
        legacy: distribution.executableName,
        fallback: distribution.executableName,
      }),
    });
  return Object.freeze({
    baseName: distribution.productName,
    showStageInDisplayName: false,
    homeDirectoryName: distribution.homeDirectoryName,
    codexAuthScheme: "t3code-workbench",
    wslHome: `~/${distribution.homeDirectoryName}`,
    production: identity(false),
    development: identity(true),
    legacyProfileNames: Object.freeze([distribution.executableName]),
    updates: Object.freeze({
      feed: Object.freeze({
        provider: "custom",
        updateProvider: WorkbenchGithubProvider,
        channel: "latest",
      } satisfies ElectronUpdaterFeedUrl),
      disabledReason: (platform: NodeJS.Platform) =>
        platform === "darwin" && !signed
          ? "Automatic updates for unsigned T3 Code Workbench macOS builds require manual installation from the GitHub release page."
          : null,
      isVersionForChannel: (version: string, channel: DesktopUpdateChannel) =>
        resolveDefaultDesktopUpdateChannel(version) === channel ||
        isStablePromotion(version, channel),
      releaseNotesChannel: (version: string, channel: DesktopUpdateChannel) =>
        isStablePromotion(version, channel) ? "latest" : channel,
    }),
  });
};

/** Static build identity; no late registration can change an initialized profile or scheme. */
export const selectWorkbenchDesktopProduct = (): DesktopProduct | null =>
  makeProduct(isWorkbenchMacSigned());
