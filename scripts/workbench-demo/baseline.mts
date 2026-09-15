// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off - This host-side helper coordinates the disposable demo fixture.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { readConfig, requireHome, resetHome } from "./environment.mts";
import {
  resetJira,
  validateJiraBaseline,
  type JiraBaseline,
  type JiraBaselineResetResult,
  type JiraProvisionPlan,
} from "./remotes.mts";

export const DEMO_BASELINE_VERSION = 1;

type RemoteManifest = {
  readonly jiraBaseline?: unknown;
};

export type DemoBaselinePlan = {
  readonly version: typeof DEMO_BASELINE_VERSION;
  readonly home: string;
  readonly actions: readonly string[];
  readonly githubRepositories: readonly string[];
  readonly jira?: JiraBaseline;
};

export type DemoBaselineResult = {
  readonly plan: DemoBaselinePlan;
  readonly local: string;
  readonly jira?: JiraBaselineResetResult | JiraProvisionPlan;
};

export type PlanBaselineResetOptions = {
  readonly home: string;
};

export type ApplyBaselineResetOptions = PlanBaselineResetOptions & {
  readonly remoteApply?: boolean;
  readonly fetcher?: typeof fetch;
};

const readRemoteManifest = (home: string): RemoteManifest => {
  const path = NodePath.join(home, "remotes.json");
  if (!NodeFS.existsSync(path)) return {};
  const value: unknown = JSON.parse(NodeFS.readFileSync(path, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid remote resource manifest.");
  }
  return value as RemoteManifest;
};

const configuredRepositories = (config: NodeJS.Dict<string>): readonly string[] =>
  (config.DEMO_GITHUB_REPOSITORIES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const readJiraBaseline = (
  config: NodeJS.Dict<string>,
  manifest: RemoteManifest,
): JiraBaseline | undefined => {
  const value = manifest.jiraBaseline;
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid Jira baseline in the remote resource manifest.");
  }
  const record = value as Record<string, unknown>;
  const sprintId = Number(record.sprintId ?? config.DEMO_JIRA_SPRINT_ID);
  const boardId = Number(config.DEMO_JIRA_BOARD_ID);
  const boardName = record.boardName;
  const sprintName = record.sprintName;
  if (typeof boardName !== "string" || typeof sprintName !== "string") {
    throw new Error(
      "Jira baseline is incomplete; record boardName and sprintName before resetting the demo.",
    );
  }
  if (!Array.isArray(record.issues)) {
    throw new Error(
      "Jira baseline is incomplete; record the full issue fields before resetting the demo.",
    );
  }
  const issues = record.issues.flatMap((issue: unknown) => {
    if (typeof issue !== "object" || issue === null || Array.isArray(issue)) return [];
    const item = issue as Record<string, unknown>;
    if (typeof item.key !== "string") return [];
    if (
      typeof item.summary !== "string" ||
      typeof item.description !== "string" ||
      !Array.isArray(item.labels) ||
      item.labels.some((label) => typeof label !== "string") ||
      (item.assigneeAccountId !== null && typeof item.assigneeAccountId !== "string") ||
      (item.epicKey !== null && typeof item.epicKey !== "string") ||
      typeof item.state !== "string"
    ) {
      throw new Error(
        `Jira baseline issue ${item.key} is incomplete; record summary, description, labels, assigneeAccountId, epicKey, and state.`,
      );
    }
    return [
      {
        key: item.key,
        summary: item.summary,
        description: item.description,
        labels: item.labels,
        assigneeAccountId: item.assigneeAccountId,
        epicKey: item.epicKey,
        state: item.state as JiraBaseline["issues"][number]["state"],
      },
    ];
  });
  const site = config.DEMO_JIRA_SITE_URL?.trim();
  const projectKey = config.DEMO_JIRA_PROJECT_KEY?.trim();
  if (!site || !projectKey || !Number.isSafeInteger(boardId) || boardId <= 0) {
    throw new Error("Jira site, project key, and board ID are required for a Jira baseline.");
  }
  if (!Number.isSafeInteger(sprintId) || sprintId <= 0) {
    throw new Error("Jira sprint ID is required for a Jira baseline.");
  }
  return validateJiraBaseline({
    site,
    projectKey,
    boardId,
    boardName,
    sprintId,
    sprintName,
    issues,
  });
};

/** Build the write-free reset plan shared by the wizard, CLI, and CI. */
export const planBaselineReset = ({ home: input }: PlanBaselineResetOptions): DemoBaselinePlan => {
  const home = requireHome(input);
  const config = readConfig(home);
  const manifest = readRemoteManifest(home);
  const githubRepositories = configuredRepositories(config);
  const jira = readJiraBaseline(config, manifest);
  return {
    version: DEMO_BASELINE_VERSION,
    home,
    actions: [
      `Archive local demo state for ${home}.`,
      ...(githubRepositories.length
        ? [`Recreate local clones for ${githubRepositories.join(", ")}.`]
        : ["Recreate the four synthetic local demo repositories."]),
      ...(jira === undefined
        ? ["Retain Jira connection and remote manifest; no Jira issue baseline is recorded."]
        : [
            `Re-add ${jira.issues.length} explicitly owned Jira issue(s) to sprint ${jira.sprintId}.`,
            "Restore any recorded Jira workflow states.",
          ]),
    ],
    githubRepositories,
    ...(jira === undefined ? {} : { jira }),
  };
};

/**
 * Apply a baseline reset. Remote reconciliation is deliberately opt-in so a
 * local demo reset remains safe; CI and the interactive wizard pass
 * `remoteApply: true` after showing this plan to the operator.
 */
export const applyBaselineReset = async ({
  home: input,
  remoteApply = false,
  fetcher,
}: ApplyBaselineResetOptions): Promise<DemoBaselineResult> => {
  const plan = planBaselineReset({ home: input });
  let jira: DemoBaselineResult["jira"];
  if (remoteApply && plan.jira === undefined) {
    throw new Error(
      "A Jira baseline is required for a remote reset; capture the intended sprint state first.",
    );
  }
  if (remoteApply && plan.jira !== undefined) {
    const config = readConfig(plan.home);
    jira = await resetJira({
      baseline: plan.jira,
      email: config.DEMO_JIRA_EMAIL ?? "",
      token: config.DEMO_JIRA_API_TOKEN ?? "",
      apply: true,
      ...(fetcher === undefined ? {} : { fetcher }),
    });
  }
  return {
    plan,
    local: resetHome({ home: plan.home, apply: true }),
    ...(jira === undefined ? {} : { jira }),
  };
};

const runAsCommand = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const homeIndex = args.indexOf("--home");
  const home = homeIndex >= 0 ? args[homeIndex + 1] : undefined;
  if (home === undefined || home.length === 0) {
    throw new Error("Usage: node scripts/workbench-demo/baseline.mts --home PATH [--apply]");
  }
  const apply = args.includes("--apply");
  const remoteApply = args.includes("--remote-apply");
  if (remoteApply && !apply) throw new Error("--remote-apply requires --apply.");
  const result = apply
    ? await applyBaselineReset({ home, remoteApply })
    : planBaselineReset({ home });
  console.log(JSON.stringify(result, null, 2));
};

if (process.argv[1] === NodeURL.fileURLToPath(import.meta.url)) {
  runAsCommand().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Demo baseline reset failed.");
    process.exitCode = 1;
  });
}
