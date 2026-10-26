// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - This host-side helper coordinates the disposable demo fixture.
import * as NodeURL from "node:url";

import { readConfig, requireHome, resetHome } from "./environment.mts";

export const DEMO_BASELINE_VERSION = 1;

export type DemoBaselinePlan = {
  readonly version: typeof DEMO_BASELINE_VERSION;
  readonly home: string;
  readonly actions: readonly string[];
  readonly githubRepositories: readonly string[];
};

export type DemoBaselineResult = {
  readonly plan: DemoBaselinePlan;
  readonly local: string;
};

export type PlanBaselineResetOptions = {
  readonly home: string;
};

const configuredRepositories = (config: NodeJS.Dict<string>): readonly string[] =>
  (config.DEMO_GITHUB_REPOSITORIES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

/** Build the write-free reset plan shared by the wizard, CLI, and CI. */
export const planBaselineReset = ({ home: input }: PlanBaselineResetOptions): DemoBaselinePlan => {
  const home = requireHome(input);
  const githubRepositories = configuredRepositories(readConfig(home));
  return {
    version: DEMO_BASELINE_VERSION,
    home,
    actions: [
      `Archive local demo state for ${home}.`,
      githubRepositories.length
        ? `Recreate local clones for ${githubRepositories.join(", ")}.`
        : "Recreate the four synthetic local demo repositories.",
    ],
    githubRepositories,
  };
};

/** Apply a local baseline reset. Remote GitHub resources are never changed. */
export const applyBaselineReset = ({
  home: input,
}: PlanBaselineResetOptions): DemoBaselineResult => {
  const plan = planBaselineReset({ home: input });
  return { plan, local: resetHome({ home: plan.home, apply: true }) };
};

const runAsCommand = (): void => {
  const args = process.argv.slice(2);
  const homeIndex = args.indexOf("--home");
  const home = homeIndex >= 0 ? args[homeIndex + 1] : undefined;
  if (home === undefined || home.length === 0) {
    throw new Error("Usage: node scripts/workbench-demo/baseline.mts --home PATH [--apply]");
  }
  const result = args.includes("--apply")
    ? applyBaselineReset({ home })
    : planBaselineReset({ home });
  console.log(JSON.stringify(result, null, 2));
};

if (process.argv[1] === NodeURL.fileURLToPath(import.meta.url)) {
  try {
    runAsCommand();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Demo baseline reset failed.");
    process.exitCode = 1;
  }
}
