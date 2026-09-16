import desktopPackageJson from "../../package.json" with { type: "json" };

declare const __T3CODE_WORKBENCH_DISTRIBUTION__: typeof desktopPackageJson.workbenchDistribution;

declare const __T3CODE_WORKBENCH_BUILD__: boolean | undefined;
declare const __T3CODE_WORKBENCH_MAC_SIGNED__: boolean | undefined;

/** Selected at build time so installed forks never inherit upstream's local identity. */
export const isWorkbenchBuild = (): boolean =>
  typeof __T3CODE_WORKBENCH_BUILD__ !== "undefined" && __T3CODE_WORKBENCH_BUILD__;

export const isWorkbenchMacSigned = (): boolean =>
  typeof __T3CODE_WORKBENCH_MAC_SIGNED__ !== "undefined" && __T3CODE_WORKBENCH_MAC_SIGNED__;

// Bundles inline this data to avoid a package.json initialization edge in the desktop cycle.
// Direct source consumers, including tests, use the same canonical package metadata.
export const WORKBENCH_DISTRIBUTION =
  typeof __T3CODE_WORKBENCH_DISTRIBUTION__ === "undefined"
    ? desktopPackageJson.workbenchDistribution
    : __T3CODE_WORKBENCH_DISTRIBUTION__;
