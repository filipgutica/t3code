import type { DesktopUpdateChannel } from "@t3tools/contracts";
import type { codexAuthHandoffUrl } from "@t3tools/shared/codexAuthHandoff";
import type { ElectronUpdaterFeedUrl } from "../electron/ElectronUpdater.ts";
import { resolveDefaultDesktopUpdateChannel } from "../updates/updateChannels.ts";
import { selectWorkbenchDesktopProduct } from "../workbench/desktopProduct.ts";

export interface DesktopProductIdentity {
  readonly appUserModelId: string;
  readonly linuxDesktopEntryName: string;
  readonly linuxWmClass: string;
  readonly scheme: string;
  readonly profileNames: {
    readonly current: string;
    readonly legacy: string;
    readonly fallback: string;
  };
}

/** Distribution decisions needed before Electron and its profile initialize. */
export interface DesktopProduct {
  readonly baseName: string;
  readonly showStageInDisplayName: boolean;
  readonly homeDirectoryName: string;
  readonly codexAuthScheme: NonNullable<Parameters<typeof codexAuthHandoffUrl>[2]>;
  readonly wslHome: string | null;
  readonly production: DesktopProductIdentity;
  readonly development: DesktopProductIdentity;
  readonly legacyProfileNames: readonly string[];
  readonly updates: {
    readonly feed: ElectronUpdaterFeedUrl | null;
    readonly disabledReason: (platform: NodeJS.Platform) => string | null;
    readonly isVersionForChannel: (version: string, channel: DesktopUpdateChannel) => boolean;
    readonly releaseNotesChannel: (
      version: string,
      channel: DesktopUpdateChannel,
    ) => DesktopUpdateChannel;
  };
}

const nativeProduct: DesktopProduct = Object.freeze({
  baseName: "T3 Code",
  showStageInDisplayName: true,
  homeDirectoryName: ".t3",
  codexAuthScheme: "t3code",
  wslHome: null,
  production: Object.freeze({
    appUserModelId: "com.t3tools.t3code",
    linuxDesktopEntryName: "com.t3tools.T3Code.desktop",
    linuxWmClass: "t3code",
    scheme: "t3code",
    profileNames: Object.freeze({
      current: "t3code-v2",
      legacy: "T3 Code (Alpha)",
      fallback: "t3code",
    }),
  }),
  development: Object.freeze({
    appUserModelId: "com.t3tools.t3code.dev",
    linuxDesktopEntryName: "com.t3tools.T3Code.Development.desktop",
    linuxWmClass: "t3code-dev",
    scheme: "t3code-dev",
    profileNames: Object.freeze({
      current: "t3code-dev",
      legacy: "T3 Code (Dev)",
      fallback: "t3code",
    }),
  }),
  // V1 used the branded profile when present and the executable name otherwise.
  legacyProfileNames: Object.freeze(["T3 Code (Alpha)", "t3code"]),
  updates: Object.freeze({
    feed: null,
    disabledReason: () => null,
    isVersionForChannel: (version: string, channel: DesktopUpdateChannel) =>
      resolveDefaultDesktopUpdateChannel(version) === channel,
    releaseNotesChannel: (_version: string, channel: DesktopUpdateChannel) => channel,
  }),
});

// Build constants select the immutable descriptor synchronously, including
// consumers whose protocol and profile constants initialize before app startup.
export const getDesktopProduct = (): DesktopProduct =>
  selectWorkbenchDesktopProduct() ?? nativeProduct;

export const getDesktopProductIdentity = (isDevelopment: boolean): DesktopProductIdentity => {
  const product = getDesktopProduct();
  return isDevelopment ? product.development : product.production;
};
