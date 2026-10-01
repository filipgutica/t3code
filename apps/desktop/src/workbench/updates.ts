import type { DesktopUpdateChannel } from "@t3tools/contracts";
import type { ElectronUpdaterFeedUrl } from "../electron/ElectronUpdater.ts";
import { WorkbenchGithubProvider } from "../electron/WorkbenchGithubProvider.ts";
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
  isWorkbenchBuild() ? "latest" : channel;

export const getWorkbenchAutoUpdateDisabledReason = (platform: NodeJS.Platform): string | null =>
  isWorkbenchBuild() && platform === "darwin" && !isWorkbenchMacSigned()
    ? "Automatic updates for unsigned T3 Code Workbench macOS builds require manual installation from the GitHub release page."
    : null;
