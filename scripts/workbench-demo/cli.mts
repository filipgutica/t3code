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
import { provisionGitHub, inspectGitHub } from "./remotes.mts";
import { recoverDisposableDemo, startDisposableDemo } from "./disposable.mts";
import { prepareDemoProfile } from "./prepare.mts";

import { setupLocal, verifyLocal } from "./local.mts";
import { linkDemoPullRequests, verifyDemoPullRequests } from "./integrations.mts";
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
  run      Start a fresh disposable demo from the saved profile; Ctrl-C cleans it up
  recover  Stop and remove a disposable demo left by an interrupted run

Maintenance: --help --maintenance (see scripts/workbench-demo/maintenance.md)

Default home: ${defaultHomeFor()}
Human account setup: bash scripts/workbench-demo/setup.sh
See scripts/workbench-demo/README.md for configuration and external resource reuse.
`;
const maintenanceHelp = `Workbench demo maintenance

node scripts/workbench-demo/cli.mts COMMAND [--home PATH]

  stop              Stop the tracked launcher (also used by CI)
  seed              Seed local fixtures in a running maintenance environment
  verify            Check local fixtures and linked GitHub PRs
  github [--apply]  Inspect or provision configured GitHub resources
  reset-baseline [--apply]  Restore regression fixtures
  history           Add labeled screenshot-only history while stopped

Remote writes require --apply.
See scripts/workbench-demo/maintenance.md before changing shared fixtures.
`;
const { values, positionals } = NodeUtil.parseArgs({
  allowPositionals: true,
  options: {
    home: { type: "string", default: defaultHomeFor() },
    apply: { type: "boolean", default: false },
    preview: { type: "boolean", default: false },
    run: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
    maintenance: { type: "boolean", default: false },
    built: { type: "boolean", default: false },
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
  if (command === "reset-baseline") {
    if (!values.apply) {
      console.log(JSON.stringify(planBaselineReset({ home }), null, 2));
      return;
    }
    const server = await resetToBaseline({ home });
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
    process.exitCode = await startDemo(home, { built: values.built });
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
      console.log(`Preparing a fresh demo from ${home}; seeding repositories…`);
      session = await startDisposableDemo({ sourceHome: home });
      console.log(`Disposable demo home: ${session.runHome}`);
      console.log(`Pairing URL: ${session.pairingUrl}`);
      console.log("Ready. Press Ctrl-C to stop and clean up this demo.");
      if (stopRequested) await session.stop();
      await session.exited;
      await session.finish();
      console.log("Demo removed.");
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
    return;
  }
  if (command === "recover") {
    if (!values.run) throw new Error("Specify --run PATH for the disposable demo to recover.");
    await recoverDisposableDemo({ sourceHome: home, runHome: values.run });
    console.log(`Removed disposable demo ${values.run}.`);
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
      return { local, github: github ?? "not configured" };
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
  throw new Error(`Unknown command: ${command}. Use --help.`);
};
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Demo command failed.");
  process.exitCode = 1;
});
