import distribution from "./distribution.json" with { type: "json" };

declare const __T3CODE_WORKBENCH_DISTRIBUTION__: typeof distribution;

declare const __T3CODE_WORKBENCH_BUILD__: boolean | undefined;
declare const __T3CODE_WORKBENCH_MAC_SIGNED__: boolean | undefined;

export const isWorkbenchMacSigned = (): boolean =>
  typeof __T3CODE_WORKBENCH_MAC_SIGNED__ !== "undefined" && __T3CODE_WORKBENCH_MAC_SIGNED__;

// Bundles inline this descriptor before product initialization.
// Direct source consumers use the same Workbench-owned data.
const WORKBENCH_DISTRIBUTION =
  typeof __T3CODE_WORKBENCH_DISTRIBUTION__ === "undefined"
    ? distribution
    : __T3CODE_WORKBENCH_DISTRIBUTION__;

/** Selected at build time so installed forks never inherit upstream's local identity. */
export const getWorkbenchDistribution = () =>
  typeof __T3CODE_WORKBENCH_BUILD__ !== "undefined" && __T3CODE_WORKBENCH_BUILD__
    ? WORKBENCH_DISTRIBUTION
    : null;
