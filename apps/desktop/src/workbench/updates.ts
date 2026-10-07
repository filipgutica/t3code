import type { DesktopUpdateChannel } from "@t3tools/contracts";
import type { ElectronUpdaterFeedUrl } from "../electron/ElectronUpdater.ts";
import { WorkbenchGithubProvider } from "../electron/WorkbenchGithubProvider.ts";
import { resolveDefaultDesktopUpdateChannel } from "../updates/updateChannels.ts";
import { isWorkbenchBuild, isWorkbenchMacSigned } from "./distribution.ts";

export const getWorkbenchUpdateFeed = (): ElectronUpdaterFeedUrl | null =>
  isWorkbenchBuild()
    ? ({
        provider: "custom",
        updateProvider: WorkbenchGithubProvider,
        channel: "latest",
      } as ElectronUpdaterFeedUrl)
    : null;

export const resolveDesktopUpdateChannel = (channel: DesktopUpdateChannel): DesktopUpdateChannel =>
  channel;

const isWorkbenchStablePromotion = (version: string, channel: DesktopUpdateChannel): boolean =>
  isWorkbenchBuild() &&
  channel === "nightly" &&
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version);

export const isDesktopUpdateForChannel = (
  version: string,
  channel: DesktopUpdateChannel,
): boolean =>
  resolveDefaultDesktopUpdateChannel(version) === channel ||
  isWorkbenchStablePromotion(version, channel);

export const resolveDesktopUpdateReleaseNotesChannel = (
  version: string,
  channel: DesktopUpdateChannel,
): DesktopUpdateChannel => (isWorkbenchStablePromotion(version, channel) ? "latest" : channel);

export const getWorkbenchAutoUpdateDisabledReason = (platform: NodeJS.Platform): string | null =>
  isWorkbenchBuild() && platform === "darwin" && !isWorkbenchMacSigned()
    ? "Automatic updates for unsigned T3 Code Workbench macOS builds require manual installation from the GitHub release page."
    : null;
