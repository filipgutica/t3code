import desktopPackageJson from "../../apps/desktop/package.json" with { type: "json" };
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { DesktopBuildProduct } from "./desktop-build-product.ts";

const WORKBENCH_DISTRIBUTION = desktopPackageJson.workbenchDistribution;

const MAC_WORKBENCH_SIGNING_ENVIRONMENT_VARIABLES = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
] as const;

export class MissingMacWorkbenchSigningCredentialsError extends Schema.TaggedError<MissingMacWorkbenchSigningCredentialsError>()(
  "MissingMacWorkbenchSigningCredentialsError",
  {
    missing: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `Signed Workbench macOS builds require ${this.missing.join(", ")}.`;
  }
}

export const isMacWorkbenchSigningConfigurationError = Schema.is(
  MissingMacWorkbenchSigningCredentialsError,
);

export class MacWorkbenchSigningConfigurationResolutionError extends Schema.TaggedError<MacWorkbenchSigningConfigurationResolutionError>()(
  "MacWorkbenchSigningConfigurationResolutionError",
  {
    cause: Schema.Defect(),
  },
) {
  static fromCause(
    cause: unknown,
  ): MissingMacWorkbenchSigningCredentialsError | MacWorkbenchSigningConfigurationResolutionError {
    return isMacWorkbenchSigningConfigurationError(cause)
      ? cause
      : new MacWorkbenchSigningConfigurationResolutionError({ cause });
  }

  override get message(): string {
    return "Failed to resolve macOS Workbench signing configuration.";
  }
}

export class WorkbenchMacBuildReuseError extends Schema.TaggedError<WorkbenchMacBuildReuseError>()(
  "WorkbenchMacBuildReuseError",
  {},
) {
  override get message(): string {
    return "Workbench macOS packaging cannot use --skip-build because signing state is compiled into the desktop bundle.";
  }
}

/**
 * Workbench uses a Developer ID certificate and App Store Connect API key for
 * distribution signing. It deliberately does not use the upstream app's
 * Associated Domains entitlement or provisioning profile.
 *
 * `APPLE_API_KEY` is the path to the temporary `.p8` file consumed by
 * electron-builder's notarytool integration. CI writes that file from the
 * secret contents before invoking this script.
 */
export function resolveMacWorkbenchSigningConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): void {
  const missing = MAC_WORKBENCH_SIGNING_ENVIRONMENT_VARIABLES.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new MissingMacWorkbenchSigningCredentialsError({ missing: [...missing] });
  }
}

export function validateWorkbenchMacBuildMode(input: {
  readonly workbench: boolean;
  readonly platform: "mac" | "linux" | "win";
  readonly skipBuild: boolean;
}): WorkbenchMacBuildReuseError | undefined {
  if (input.workbench && input.platform === "mac" && input.skipBuild) {
    return new WorkbenchMacBuildReuseError();
  }
  return undefined;
}

export function resolveDesktopBundleBuildEnvironment(input: {
  readonly baseEnv: Readonly<NodeJS.ProcessEnv>;
  readonly workbench: boolean;
  readonly platform: "mac" | "linux" | "win";
  readonly signed: boolean;
}): NodeJS.ProcessEnv {
  const buildEnv: NodeJS.ProcessEnv = { ...input.baseEnv };
  if (input.workbench && input.platform === "mac") {
    buildEnv.T3CODE_WORKBENCH_MAC_SIGNED = input.signed ? "1" : "0";
  }
  return buildEnv;
}

/** All fork packaging choices, applied before the native installer mechanics run. */
export const selectWorkbenchDesktopBuildProduct = (input: {
  readonly updateChannel: "latest" | "nightly";
  readonly workbench: boolean;
  readonly platform: "mac" | "linux" | "win";
  readonly signed: boolean;
}): DesktopBuildProduct | null => {
  if (!input.workbench) return null;
  return {
    appId: WORKBENCH_DISTRIBUTION.appId,
    packageName: "t3code-workbench",
    productName: WORKBENCH_DISTRIBUTION.productName,
    artifactName: "T3-Code-Workbench-${version}-${arch}.${ext}",
    protocols: [
      { name: WORKBENCH_DISTRIBUTION.productName, schemes: [WORKBENCH_DISTRIBUTION.scheme] },
    ],
    // Emit metadata for draft previews too. The runtime only accepts published
    // Workbench tags in this repository.
    publish: [
      {
        provider: "github",
        owner: "filipgutica",
        repo: "t3code",
        channel: input.updateChannel,
        releaseType: "prerelease",
      },
    ],
    mac: {
      hardenedRuntime: input.signed,
      forceCodeSigning: input.platform === "mac" && input.signed,
      // Renaming Electron requires a complete ad-hoc signature for previews.
      ...(!input.signed ? { identity: "-", notarize: false } : {}),
      usePasskeySigning: false,
    },
    linux: {
      executableName: WORKBENCH_DISTRIBUTION.executableName,
      includeDeb: false,
      includeNativeDebMetadata: false,
    },
    validateBuildMode: (skipBuild) => {
      const error = validateWorkbenchMacBuildMode({ ...input, skipBuild });
      return error === undefined ? Effect.void : Effect.fail(error);
    },
    validateSigningEnvironment: (env) =>
      input.platform === "mac" && input.signed
        ? Effect.try({
            try: () => resolveMacWorkbenchSigningConfiguration(env),
            catch: MacWorkbenchSigningConfigurationResolutionError.fromCause,
          })
        : Effect.void,
    bundleEnvironment: (baseEnv) => resolveDesktopBundleBuildEnvironment({ ...input, baseEnv }),
  };
};
