// @effect-diagnostics nodeBuiltinImport:off - Demo reset coordinates owned files and processes outside the application runtime.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { applyBaselineReset, planBaselineReset } from "./baseline.mts";
import { readConfig, requireHome } from "./environment.mts";
import { exportJiraAuth, importJiraAuth, type JiraAuthBundle } from "./jira-auth.mts";
import { launchDemo } from "./launch.mts";
import { stopDemo } from "./lifecycle.mts";
import { withDemoAccess } from "./access.mts";
import { setupLocal, verifyLocal } from "./local.mts";
import { syncDemoJira, linkDemoPullRequests } from "./integrations.mts";
import { inspectGitHub } from "./remotes.mts";
import { DEMO_REPOSITORIES } from "./repositories.mts";

export const hasJiraConnection = (home: string) => {
  const file = NodePath.join(home, "userdata", "state.sqlite");
  if (!NodeFS.existsSync(file)) return false;
  const db = new NodeSqlite.DatabaseSync(file, { readOnly: true });
  try {
    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workbench_jira_connections'",
      )
      .get();
    return Boolean(table && db.prepare("SELECT 1 FROM workbench_jira_connections LIMIT 1").get());
  } finally {
    db.close();
  }
};

/** Return the ready server so the wizard and Playwright share the complete reset lifecycle. */
export const resetToBaseline = async (input: {
  home: string;
  remoteApply: boolean;
  oauthBundle?: JiraAuthBundle;
  configure?: (home: string) => Promise<void>;
}) => {
  const home = requireHome(input.home);
  const plan = planBaselineReset({ home });
  if (NodeFS.existsSync(NodePath.join(home, "run.lock"))) await stopDemo(home);
  const oauthBundle =
    input.oauthBundle ?? (hasJiraConnection(home) ? await exportJiraAuth({ home }) : undefined);
  const settingsPath = NodePath.join(home, "userdata", "settings.json");
  const settings = NodeFS.existsSync(settingsPath)
    ? await NodeFSP.readFile(settingsPath)
    : undefined;
  await applyBaselineReset({ home, remoteApply: input.remoteApply });
  await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true, mode: 0o700 });
  if (settings) await NodeFSP.writeFile(settingsPath, settings, { mode: 0o600 });
  await input.configure?.(home);
  let server = await launchDemo({ home });
  try {
    if (oauthBundle) {
      // The first boot migrates a new database. Credentials are imported only while stopped.
      await server.stop();
      await importJiraAuth({ home, bundle: oauthBundle });
      server = await launchDemo({ home });
    }
    const config = readConfig(home);
    const names = (config.DEMO_GITHUB_REPOSITORIES ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    const ids = ["orbit-api", "orbit-web", "beacon-cli", "beacon-docs"];
    if (names.length !== 0 && names.length !== 2 && names.length !== 4)
      throw new Error(
        "Configure two Orbit repositories or all four Orbit/Beacon repositories, API first.",
      );
    const repositories = names.map((name) =>
      name.includes("/") ? name : `${config.DEMO_GITHUB_OWNER}/${name}`,
    );
    const repositoryRemotes = Object.fromEntries(
      repositories.map((name, index) => [ids[index], `https://github.com/${name}.git`]),
    );
    const repositoryCommits = Object.fromEntries(
      Object.entries(DEMO_REPOSITORIES)
        .filter(
          ([id, fixture]) =>
            repositoryRemotes[id] === `https://github.com/${fixture.repository}.git`,
        )
        .map(([id, fixture]) => [id, fixture.commit]),
    );
    await withDemoAccess(home, (access) =>
      setupLocal({
        home,
        ...access,
        repositoryRemotes,
        repositoryCommits,
        localOriginDirectory: NodePath.join(home, "git-remotes"),
        prepareWorkspaces: true,
      }),
    );
    if (repositories.length) {
      const inspected = await inspectGitHub({ repositories });
      if (inspected.missing.length)
        throw new Error(`Cannot access demo repositories: ${inspected.missing.join(", ")}`);
      await withDemoAccess(home, (access) =>
        linkDemoPullRequests({
          ...access,
          urls: inspected.repositories.flatMap((repo) => repo.pullRequests.map((pr) => pr.url)),
        }),
      );
    }
    const jira = plan.jira;
    if (jira) {
      if (!oauthBundle) throw new Error("The Jira baseline needs a preconnected OAuth bundle.");
      await withDemoAccess(home, (access) =>
        syncDemoJira({
          ...access,
          site: jira.site,
          projectKey: jira.projectKey,
          boardId: jira.boardId,
          sprintId: jira.sprintId,
        }),
      );
    }
    await withDemoAccess(home, (access) => verifyLocal({ home, ...access }));
    return { ...server, plan };
  } catch (error) {
    await server.stop();
    throw error;
  }
};
