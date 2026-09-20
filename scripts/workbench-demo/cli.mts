#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Standalone demo CLI owns host setup outside the application runtime.
import * as NodeUtil from "node:util";
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import { defaultHomeFor, requireHome, setupHome, readConfig } from "./environment.mts";
import { seedVisualHistory } from "./history.mts";
import { startDemo, stopDemo } from "./lifecycle.mts";
import { planBaselineReset } from "./baseline.mts";
import { resetToBaseline } from "./reset-to-baseline.mts";
import { exportJiraAuth, writeJiraAuthBundleFile } from "./jira-auth.mts";
import { snapshotJiraBaseline } from "./remotes.mts";
import { provisionGitHub, provisionJira, inspectGitHub, inspectJira } from "./remotes.mts";
import { recoverDisposableDemo, startDisposableDemo } from "./disposable.mts";
import { prepareDemoProfile } from "./prepare.mts";

import { setupLocal, verifyLocal } from "./local.mts";
import {
  linkDemoPullRequests,
  verifyDemoPullRequests,
  syncDemoJira,
  verifyDemoJira,
} from "./integrations.mts";
import { withDemoAccess } from "./access.mts";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const repositoryRoot = NodeURL.fileURLToPath(new URL("../../", import.meta.url));

const saveRemote = (home: string, key: string, value: unknown) => {
  const path = NodePath.join(home, "remotes.json");
  const previous: unknown = NodeFS.existsSync(path)
    ? JSON.parse(NodeFS.readFileSync(path, "utf8"))
    : {};
  if (typeof previous !== "object" || previous === null || Array.isArray(previous))
    throw new Error("Invalid remote resource manifest.");
  NodeFS.writeFileSync(path, JSON.stringify({ ...previous, [key]: value }, null, 2) + "\n", {
    mode: 0o600,
  });
};
const help = `Workbench demo kit (run with the repository's Node version)

node scripts/workbench-demo/cli.mts COMMAND [--home PATH]

  setup    Run the first-time setup wizard (bash scripts/workbench-demo/setup.sh)
  run      Start a fresh disposable demo from the connected profile; Ctrl-C cleans it up
  recover  Recover a stopped disposable demo and return its refreshed Jira grant

Maintenance: --help --maintenance (see scripts/workbench-demo/maintenance.md)

Default home: ${defaultHomeFor()}
Human account setup: bash scripts/workbench-demo/setup.sh
See scripts/workbench-demo/README.md for configuration and external resource reuse.
`;
const maintenanceHelp = `Workbench demo maintenance

node scripts/workbench-demo/cli.mts COMMAND [--home PATH]

  stop              Stop the tracked launcher (also used by CI)
  seed              Seed local fixtures in a running maintenance environment
  verify [--jira]   Check local fixtures and optionally Jira
  github [--apply]  Inspect or provision configured GitHub resources
  jira [--apply]    Inspect or provision configured Jira resources
  sync-jira         Sync the configured sprint into a Jira workspace
  capture-baseline --apply  Replace the recorded Jira baseline
  reset-baseline [--apply] [--remote-apply]  Restore regression fixtures
  export-jira-auth --output FILE  Export a stopped environment's private grant
  history           Add labeled screenshot-only history while stopped

Remote writes require --apply; remote baseline restoration also requires --remote-apply.
See scripts/workbench-demo/maintenance.md before changing shared fixtures.
`;
const { values, positionals } = NodeUtil.parseArgs({
  allowPositionals: true,
  options: {
    home: { type: "string", default: defaultHomeFor() },
    apply: { type: "boolean", default: false },
    preview: { type: "boolean", default: false },
    jira: { type: "boolean", default: false },
    "remote-apply": { type: "boolean", default: false },
    output: { type: "string" },
    run: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
    maintenance: { type: "boolean", default: false },
  },
});
const main = async () => {
  const command = positionals[0];
  if (values.apply && values.preview) throw new Error("Choose --preview or --apply, not both.");
  if (values.help || !command) {
    console.log(values.maintenance ? maintenanceHelp : help);
    return;
  }
  if (positionals.length !== 1) throw new Error("Expected one command. Use --help.");
  if (command === "init") {
    const home = setupHome(values.home);
    if (
      NodeFS.existsSync(NodePath.join(home, ".disposable-demo.lock")) ||
      NodeFS.existsSync(NodePath.join(home, "run.lock"))
    )
      throw new Error("Stop or recover the active demo before editing its saved profile.");
    console.log(`Demo home: ${home}`);
    return;
  }
  if (command === "setup") {
    const result = NodeChildProcess.spawnSync(
      "bash",
      [NodePath.join(repositoryRoot, "scripts/workbench-demo/setup.sh")],
      {
        cwd: repositoryRoot,
        env: { ...process.env, DEMO_HOME: values.home },
        stdio: "inherit",
      },
    );
    process.exitCode = result.status ?? 1;
    return;
  }
  const home = requireHome(values.home);
  if (command === "prepare") {
    await prepareDemoProfile({ home });
    return;
  }
  if (command === "export-jira-auth") {
    if (!values.output)
      throw new Error("Specify --output with a private file outside the checkout.");
    await writeJiraAuthBundleFile({ path: values.output, bundle: await exportJiraAuth({ home }) });
    console.log("Exported Jira connection to the requested private file.");
    return;
  }
  if (command === "reset-baseline") {
    if (!values.apply) {
      console.log(JSON.stringify(planBaselineReset({ home }), null, 2));
      return;
    }
    const server = await resetToBaseline({ home, remoteApply: values["remote-apply"] });
    console.log(`Baseline ready. Pairing URL: ${server.pairingUrl}`);
    const stop = () => {
      void server.stop();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    await server.exited;
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    return;
  }
  if (command === "start") {
    process.exitCode = await startDemo(home);
    return;
  }
  if (command === "run") {
    let session: Awaited<ReturnType<typeof startDisposableDemo>> | undefined;
    let stopRequested = false;
    const stop = () => {
      stopRequested = true;
      void session?.stop();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      console.log(`Preparing a fresh demo from ${home}; seeding repositories and checking Jira…`);
      session = await startDisposableDemo({ sourceHome: home });
      console.log(`Disposable demo home: ${session.runHome}`);
      console.log(`Pairing URL: ${session.pairingUrl}`);
      console.log("Ready. Press Ctrl-C to stop and clean up this demo.");
      if (stopRequested) await session.stop();
      await session.exited;
      await session.finish();
      console.log("Demo removed. Jira authorization saved for the next run.");
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
    return;
  }
  if (command === "recover") {
    if (!values.run) throw new Error("Specify --run PATH for the disposable demo to recover.");
    await recoverDisposableDemo({ sourceHome: home, runHome: values.run });
    console.log(`Recovered Jira authorization and removed disposable demo ${values.run}.`);
    return;
  }
  if (command === "stop") {
    console.log(await stopDemo(home));
    return;
  }
  if (command === "history") {
    console.log(JSON.stringify(seedVisualHistory(home), null, 2));
    return;
  }
  const config = readConfig(home);
  const required = (key: string) => {
    const value = config[key]?.trim();
    if (!value) throw new Error(`Set ${key} in ${home}/config.env using setup.sh.`);
    return value;
  };
  const repositories = () => {
    const owner = required("DEMO_GITHUB_OWNER");
    const configured = config.DEMO_GITHUB_REPOSITORIES?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const names = configured?.length
      ? configured
      : [
          `${config.DEMO_GITHUB_REPO_PREFIX || "workbench-demo"}-orbit-api`,
          `${config.DEMO_GITHUB_REPO_PREFIX || "workbench-demo"}-orbit-web`,
        ];
    return names.map((name) => (name.includes("/") ? name : `${owner}/${name}`));
  };
  const savedPath = NodePath.join(home, "remotes.json");
  const saved: unknown = NodeFS.existsSync(savedPath)
    ? JSON.parse(NodeFS.readFileSync(savedPath, "utf8"))
    : {};
  const jiraRecord =
    typeof saved === "object" && saved !== null && "jira" in saved ? saved.jira : undefined;
  const baseline =
    typeof saved === "object" && saved !== null && "jiraBaseline" in saved
      ? saved.jiraBaseline
      : undefined;
  const selectedSprint = () => {
    const value = Number(
      config.DEMO_JIRA_SPRINT_ID ||
        (typeof jiraRecord === "object" && jiraRecord !== null && "sprintId" in jiraRecord
          ? jiraRecord.sprintId
          : undefined),
    );
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("Set DEMO_JIRA_SPRINT_ID or provision the demo sprint first.");
    return value;
  };
  if (command === "capture-baseline") {
    if (!values.apply)
      throw new Error(
        "Capturing replaces the saved baseline. Use --apply once the demo is in its intended starting state.",
      );
    const captured = await snapshotJiraBaseline({
      site: required("DEMO_JIRA_SITE_URL"),
      projectKey: required("DEMO_JIRA_PROJECT_KEY"),
      boardId: Number(required("DEMO_JIRA_BOARD_ID")),
      sprintId: selectedSprint(),
      email: required("DEMO_JIRA_EMAIL"),
      token: required("DEMO_JIRA_API_TOKEN"),
    });
    saveRemote(home, "jiraBaseline", captured);
    console.log(`Captured ${captured.issues.length} Jira issues as the reset baseline.`);
    return;
  }
  const expectedJiraKeys = () => {
    if (
      typeof jiraRecord === "object" &&
      jiraRecord !== null &&
      "issues" in jiraRecord &&
      Array.isArray(jiraRecord.issues)
    )
      return jiraRecord.issues.flatMap((issue: unknown) =>
        typeof issue === "object" &&
        issue !== null &&
        "key" in issue &&
        typeof issue.key === "string"
          ? [issue.key]
          : [],
      );
    if (
      typeof baseline === "object" &&
      baseline !== null &&
      "keys" in baseline &&
      Array.isArray(baseline.keys)
    )
      return baseline.keys.filter((key: unknown): key is string => typeof key === "string");
    throw new Error("Run sync-jira to record the selected sprint's baseline before verification.");
  };
  if (command === "seed" || command === "verify") {
    const selected = config.DEMO_GITHUB_OWNER ? repositories() : [];
    if (selected.length !== 0 && selected.length !== 2)
      throw new Error("Configure exactly two GitHub repositories, in orbit-api,orbit-web order.");
    const remoteMap = selected.length
      ? {
          "orbit-api": `https://github.com/${selected[0]}.git`,
          "orbit-web": `https://github.com/${selected[1]}.git`,
        }
      : {};
    const result = await withDemoAccess(home, async (access) => {
      const local =
        command === "seed"
          ? await setupLocal({ home, ...access, repositoryRemotes: remoteMap })
          : await verifyLocal({ home, ...access });
      let github;
      if (selected.length) {
        github = await inspectGitHub({ repositories: selected });
        if (github.missing.length)
          throw new Error(`Missing GitHub repositories: ${github.missing.join(", ")}`);
        const urls = github.repositories.flatMap((repo) => repo.pullRequests.map((pr) => pr.url));
        if (!urls.length)
          throw new Error("The selected GitHub repositories have no demo pull requests.");
        if (config.DEMO_GITHUB_RESOURCE_MODE === "provision") {
          for (const repo of github.repositories) {
            const states = new Set(
              repo.pullRequests.map((pr) =>
                pr.state === "OPEN" ? (pr.isDraft ? "draft" : "open") : pr.state.toLowerCase(),
              ),
            );
            if (["draft", "open", "closed", "merged"].some((state) => !states.has(state)))
              throw new Error(
                `Demo PR scenarios have drifted in ${repo.fullName}. Run github --apply to reconcile supported states.`,
              );
          }
        }
        if (command === "seed") await linkDemoPullRequests({ ...access, urls: urls.slice(0, 8) });
        else await verifyDemoPullRequests({ ...access, urls: urls.slice(0, 8) });
      }
      const jira = values.jira
        ? await verifyDemoJira({
            ...access,
            site: required("DEMO_JIRA_SITE_URL"),
            boardId: Number(required("DEMO_JIRA_BOARD_ID")),
            projectKey: required("DEMO_JIRA_PROJECT_KEY"),
            sprintId: selectedSprint(),
            expectedKeys: expectedJiraKeys(),
          })
        : undefined;
      return {
        local,
        github: github ?? "not configured",
        jira: jira ?? "not checked; use --jira after sync-jira",
      };
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "sync-jira") {
    const sprintId = selectedSprint();
    const result = await withDemoAccess(home, (access) =>
      syncDemoJira({
        ...access,
        site: required("DEMO_JIRA_SITE_URL"),
        projectKey: required("DEMO_JIRA_PROJECT_KEY"),
        boardId: Number(required("DEMO_JIRA_BOARD_ID")),
        sprintId,
      }),
    );
    if (baseline === undefined)
      saveRemote(home, "jiraBaseline", {
        keys: result.links.filter((link) => link.active).map((link) => link.issue.key),
        sprintId,
      });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "github") {
    if (config.DEMO_GITHUB_RESOURCE_MODE === "reuse") {
      const result = await inspectGitHub({ repositories: repositories() });
      if (result.missing.length)
        throw new Error(`Cannot access repositories: ${result.missing.join(", ")}`);
      saveRemote(home, "github", result);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const result = await provisionGitHub({
      owner: required("DEMO_GITHUB_OWNER"),
      prefix: config.DEMO_GITHUB_REPO_PREFIX || "workbench-demo",
      apply: values.apply,
    });
    if (values.apply) saveRemote(home, "github", result);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "jira") {
    if (config.DEMO_JIRA_RESOURCE_MODE === "reuse") {
      const result = await inspectJira({
        site: required("DEMO_JIRA_SITE_URL"),
        projectKey: required("DEMO_JIRA_PROJECT_KEY"),
        email: config.DEMO_JIRA_EMAIL ?? "",
        token: config.DEMO_JIRA_API_TOKEN ?? "",
        boardId: Number(required("DEMO_JIRA_BOARD_ID")),
      });
      saveRemote(home, "jira", result);
      console.log(JSON.stringify(result, null, 2));
      if (!result.authenticated || result.warnings.length) process.exitCode = 1;
      return;
    }
    const boardId = Number(required("DEMO_JIRA_BOARD_ID"));
    if (!Number.isSafeInteger(boardId) || boardId <= 0)
      throw new Error("DEMO_JIRA_BOARD_ID must be a positive integer.");
    const result = await provisionJira({
      site: required("DEMO_JIRA_SITE_URL"),
      projectKey: required("DEMO_JIRA_PROJECT_KEY"),
      email: values.apply ? required("DEMO_JIRA_EMAIL") : "",
      token: values.apply ? required("DEMO_JIRA_API_TOKEN") : "",
      prefix: config.DEMO_GITHUB_REPO_PREFIX || "workbench-demo",
      boardId,
      apply: values.apply,
    });
    if (values.apply) {
      saveRemote(home, "jira", result);
      if ("warnings" in result && Array.isArray(result.warnings) && result.warnings.length)
        process.exitCode = 1;
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}. Use --help.`);
};
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Demo command failed.");
  process.exitCode = 1;
});
