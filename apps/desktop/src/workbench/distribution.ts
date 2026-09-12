import desktopPackageJson from "../../package.json" with { type: "json" };

declare const __T3CODE_WORKBENCH_BUILD__: boolean | undefined;

/** Selected at build time so installed forks never inherit upstream's local identity. */
export const isWorkbenchBuild = (): boolean =>
  typeof __T3CODE_WORKBENCH_BUILD__ !== "undefined" && __T3CODE_WORKBENCH_BUILD__;

export const WORKBENCH_DISTRIBUTION = desktopPackageJson.workbenchDistribution;
