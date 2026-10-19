// @effect-diagnostics nodeBuiltinImport:off - Release formatting reads Actions inputs and files.
import * as NodeFS from "node:fs";

import { formatWorkbenchReleaseNotes } from "./lib/workbench-release-notes.ts";

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} for Workbench release notes.`);
  return value;
};

if (import.meta.main) {
  const signedMacos = requiredEnv("SIGN_MACOS");
  if (signedMacos !== "true" && signedMacos !== "false") {
    throw new Error("SIGN_MACOS must be true or false.");
  }
  const channel = requiredEnv("RELEASE_CHANNEL");
  if (channel !== "latest" && channel !== "nightly") {
    throw new Error("RELEASE_CHANNEL must be latest or nightly.");
  }
  process.stdout.write(
    formatWorkbenchReleaseNotes({
      version: requiredEnv("RELEASE_VERSION"),
      generatedNotes: NodeFS.readFileSync(0, "utf8"),
      signedMacos: signedMacos === "true",
      sourceSha: requiredEnv("RELEASE_SHA"),
      previousTag: process.env.PREVIOUS_TAG ?? "",
      upstreamSha: process.env.UPSTREAM_SHA ?? "",
      upstreamBase: process.env.UPSTREAM_BASE ?? "",
      jiraBrokerUrl: requiredEnv("T3_WORKBENCH_JIRA_BROKER_URL"),
      dailyMetadata: channel === "nightly" ? requiredEnv("DAILY_METADATA_JSON") : undefined,
    }),
  );
}
