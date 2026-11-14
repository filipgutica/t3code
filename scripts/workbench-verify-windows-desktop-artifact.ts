import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";

import {
  resolveDesktopProductName,
  verifyWindowsPackagedRuntime,
} from "./build-desktop-artifact.ts";

export const verifyWorkbenchWindowsDesktopArtifact = Effect.fn(
  "workbench.verifyWindowsDesktopArtifact",
)(function* (input: {
  readonly packagedAppDir: string;
  readonly buildVersion: string;
  readonly targetArch: "arm64" | "x64";
  readonly verbose: boolean;
}) {
  yield* verifyWindowsPackagedRuntime({
    packagedAppDir: input.packagedAppDir,
    appExecutableName: `${resolveDesktopProductName(input.buildVersion, true)}.exe`,
    targetArch: input.targetArch,
    verbose: input.verbose,
  });
});

export const runWorkbenchWindowsVerification = (
  input: Parameters<typeof verifyWorkbenchWindowsDesktopArtifact>[0],
) =>
  verifyWorkbenchWindowsDesktopArtifact(input).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
