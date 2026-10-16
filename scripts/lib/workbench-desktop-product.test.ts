import { assert, it } from "@effect/vitest";

import {
  MacWorkbenchSigningConfigurationResolutionError,
  MissingMacWorkbenchSigningCredentialsError,
  WorkbenchMacBuildReuseError,
  resolveMacWorkbenchSigningConfiguration,
  resolveDesktopBundleBuildEnvironment,
  validateWorkbenchMacBuildMode,
} from "./workbench-desktop-product.ts";

it("rejects Workbench macOS packaging when reusing a differently compiled bundle", () => {
  assert.doesNotThrow(() =>
    validateWorkbenchMacBuildMode({ workbench: true, platform: "mac", skipBuild: false }),
  );
  assert.doesNotThrow(() =>
    validateWorkbenchMacBuildMode({ workbench: false, platform: "mac", skipBuild: true }),
  );
  const error = validateWorkbenchMacBuildMode({
    workbench: true,
    platform: "mac",
    skipBuild: true,
  });
  assert.instanceOf(error, WorkbenchMacBuildReuseError);
});

it("compiles the Workbench macOS update gate from the signing mode", () => {
  const signed = resolveDesktopBundleBuildEnvironment({
    baseEnv: { T3CODE_WORKBENCH_MAC_SIGNED: "0", KEEP_ME: "yes" },
    workbench: true,
    platform: "mac",
    signed: true,
  });
  const unsigned = resolveDesktopBundleBuildEnvironment({
    baseEnv: { T3CODE_WORKBENCH_MAC_SIGNED: "1", KEEP_ME: "yes" },
    workbench: true,
    platform: "mac",
    signed: false,
  });
  const official = resolveDesktopBundleBuildEnvironment({
    baseEnv: { T3CODE_WORKBENCH_MAC_SIGNED: "1", KEEP_ME: "yes" },
    workbench: false,
    platform: "mac",
    signed: true,
  });

  assert.equal(signed.T3CODE_WORKBENCH_MAC_SIGNED, "1");
  assert.equal(unsigned.T3CODE_WORKBENCH_MAC_SIGNED, "0");
  assert.equal(official.T3CODE_WORKBENCH_MAC_SIGNED, "1");
  assert.equal(unsigned.KEEP_ME, "yes");
});

it("requires distribution and notarization credentials for signed Workbench builds", () => {
  const complete = {
    CSC_LINK: "base64-encoded-p12",
    CSC_KEY_PASSWORD: "password",
    APPLE_API_KEY: "/tmp/AuthKey_TEST.p8",
    APPLE_API_KEY_ID: "TESTKEYID",
    APPLE_API_ISSUER: "00000000-0000-0000-0000-000000000000",
  };
  assert.doesNotThrow(() => resolveMacWorkbenchSigningConfiguration(complete));

  const error = assert.throws(() =>
    resolveMacWorkbenchSigningConfiguration({
      CSC_LINK: complete.CSC_LINK,
      APPLE_API_KEY: complete.APPLE_API_KEY,
      APPLE_API_KEY_ID: complete.APPLE_API_KEY_ID,
    }),
  );
  assert.instanceOf(error, MissingMacWorkbenchSigningCredentialsError);
  assert.deepStrictEqual(error.missing, ["CSC_KEY_PASSWORD", "APPLE_API_ISSUER"]);
  assert.equal(
    error.message,
    "Signed Workbench macOS builds require CSC_KEY_PASSWORD, APPLE_API_ISSUER.",
  );
  assert.notInclude(JSON.stringify(error), complete.CSC_LINK);
});

it("preserves known Workbench signing configuration errors at the build boundary", () => {
  const knownError = new MissingMacWorkbenchSigningCredentialsError({
    missing: ["CSC_LINK"],
  });
  const error = MacWorkbenchSigningConfigurationResolutionError.fromCause(knownError);

  assert.strictEqual(error, knownError);
  assert.instanceOf(error, MissingMacWorkbenchSigningCredentialsError);
});
