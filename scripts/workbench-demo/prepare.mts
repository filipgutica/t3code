// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off - Host-side first-run setup owns the demo process and private profile files.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeReadlinePromises from "node:readline/promises";

import { withDemoAccess } from "./access.mts";
import { readConfig, requireHome } from "./environment.mts";
import { launchDemo } from "./launch.mts";
import { linkDemoPullRequests, syncDemoJira, verifyDemoJira } from "./integrations.mts";
import { setupLocal, verifyLocal } from "./local.mts";
import { inspectGitHub, snapshotJiraBaseline } from "./remotes.mts";
import { DEMO_REPOSITORIES } from "./repositories.mts";
import { hasJiraConnection } from "./reset-to-baseline.mts";

const saveRemote = (home: string, key: string, value: unknown): void => {
  const path = NodePath.join(home, "remotes.json");
  const previous: unknown = NodeFS.existsSync(path)
    ? JSON.parse(NodeFS.readFileSync(path, "utf8"))
    : {};
  if (typeof previous !== "object" || previous === null || Array.isArray(previous))
    throw new Error("Invalid remote resource manifest.");
  NodeFS.writeFileSync(path, `${JSON.stringify({ ...previous, [key]: value }, null, 2)}\n`, {
    mode: 0o600,
  });
};

type DemoConfig = { readonly [key: string]: string | undefined };

const required = (config: DemoConfig, key: string): string => {
  const value = config[key]?.trim();
  if (!value) throw new Error(`Set ${key} in the saved demo profile before setup.`);
  return value;
};

const repositoriesFor = (config: DemoConfig): ReadonlyArray<string> => {
  const owner = required(config, "DEMO_GITHUB_OWNER");
  const names = config.DEMO_GITHUB_REPOSITORIES?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const selected = names?.length
    ? names
    : [
        `${config.DEMO_GITHUB_REPO_PREFIX || "workbench-demo"}-orbit-api`,
        `${config.DEMO_GITHUB_REPO_PREFIX || "workbench-demo"}-orbit-web`,
      ];
  return selected.map((name) => (name.includes("/") ? name : `${owner}/${name}`));
};

const repositorySetup = (config: DemoConfig) => {
  const repositories = repositoriesFor(config);
  if (repositories.length !== 2 && repositories.length !== 4)
    throw new Error("Configure two GitHub repositories, or all four, before setup.");
  const ids = ["orbit-api", "orbit-web", "beacon-cli", "beacon-docs"];
  const remotes = Object.fromEntries(
    repositories.map((name, index) => [ids[index], `https://github.com/${name}.git`]),
  );
  const commits = Object.fromEntries(
    Object.entries(DEMO_REPOSITORIES)
      .filter(([id, fixture]) => remotes[id] === `https://github.com/${fixture.repository}.git`)
      .map(([id, fixture]) => [id, fixture.commit]),
  );
  return { repositories, remotes, commits };
};

const isJiraAuthorizationFailure = (error: unknown): boolean =>
  error instanceof Error &&
  /(connect this jira site|unauthori[sz]ed|forbidden|credential|expired|\b401\b|\b403\b)/i.test(
    error.message,
  );

const waitForAuthorization = async (
  pairingUrl: string,
  cancellationSignal?: AbortSignal,
): Promise<void> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Setup needs an interactive terminal for the browser authorization step.");
  console.log(`\nPairing URL: ${pairingUrl}`);
  console.log(
    "Open it and choose Connect Atlassian if Workbench needs authorization; do not import Jira issues in the browser.",
  );
  const readline = NodeReadlinePromises.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const controller = new AbortController();
  let interrupted = false;
  const onInterrupt = () => {
    interrupted = true;
    controller.abort();
    readline.close();
  };
  const onClose = () => {
    if (!interrupted) controller.abort();
  };
  const onExternalCancel = () => onInterrupt();
  readline.once("SIGINT", onInterrupt);
  readline.once("close", onClose);
  cancellationSignal?.addEventListener("abort", onExternalCancel, { once: true });
  try {
    await readline.question("Press Enter here when Jira authorization is complete: ", {
      signal: controller.signal,
    });
    if (interrupted)
      throw new Error("Jira authorization was canceled; the setup profile was kept.");
  } catch (error) {
    if (interrupted || (error instanceof Error && error.name === "AbortError"))
      throw new Error("Jira authorization was canceled; the setup profile was kept.", {
        cause: error,
      });
    throw error;
  } finally {
    readline.off("SIGINT", onInterrupt);
    readline.off("close", onClose);
    cancellationSignal?.removeEventListener("abort", onExternalCancel);
    readline.close();
  }
};

export const prepareDemoProfile = async (input: {
  readonly home: string;
  readonly authorize?: (pairingUrl: string) => Promise<void>;
}): Promise<void> => {
  const home = requireHome(input.home);
  const config = readConfig(home);
  const { repositories, remotes, commits } = repositorySetup(config);
  const site = required(config, "DEMO_JIRA_SITE_URL");
  const projectKey = required(config, "DEMO_JIRA_PROJECT_KEY");
  const boardId = Number(required(config, "DEMO_JIRA_BOARD_ID"));
  const savedPath = NodePath.join(home, "remotes.json");
  const saved: unknown = NodeFS.existsSync(savedPath)
    ? JSON.parse(NodeFS.readFileSync(savedPath, "utf8"))
    : {};
  const jiraRecord =
    typeof saved === "object" && saved !== null && "jira" in saved ? saved.jira : undefined;
  const sprintId = Number(
    config.DEMO_JIRA_SPRINT_ID ||
      (typeof jiraRecord === "object" && jiraRecord !== null && "sprintId" in jiraRecord
        ? jiraRecord.sprintId
        : undefined),
  );
  const email = required(config, "DEMO_JIRA_EMAIL");
  const token = required(config, "DEMO_JIRA_API_TOKEN");
  if (
    !Number.isSafeInteger(boardId) ||
    boardId <= 0 ||
    !Number.isSafeInteger(sprintId) ||
    sprintId <= 0
  )
    throw new Error(
      "The selected Jira board and sprint must be positive integer IDs. Set DEMO_JIRA_SPRINT_ID or run the provisioning commands in scripts/workbench-demo/maintenance.md, then rerun setup.",
    );

  await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true, mode: 0o700 });
  let server: Awaited<ReturnType<typeof launchDemo>> | undefined;
  let stopping: Promise<void> | undefined;
  const stop = async (): Promise<void> => {
    if (!server) return;
    stopping ??= server.stop();
    await stopping;
    await server.exited;
  };
  let interrupted = false;
  const cancellation = new AbortController();
  const signal = () => {
    interrupted = true;
    cancellation.abort();
    void stop();
  };
  process.once("SIGINT", signal);
  process.once("SIGTERM", signal);
  try {
    server = await launchDemo({ home });
    if (interrupted) throw new Error("Setup was canceled; the setup profile was kept.");
    const inspected = await inspectGitHub({ repositories });
    if (inspected.missing.length)
      throw new Error(`Cannot access demo repositories: ${inspected.missing.join(", ")}`);
    const urls = inspected.repositories.flatMap((repo) => repo.pullRequests.map((pr) => pr.url));
    if (!urls.length)
      throw new Error("The selected GitHub repositories have no demo pull requests.");
    saveRemote(home, "github", inspected);

    await withDemoAccess(home, async (access) => {
      await setupLocal({
        home,
        ...access,
        repositoryRemotes: remotes,
        repositoryCommits: commits,
        prepareWorkspaces: true,
      });
      await linkDemoPullRequests({ ...access, urls: urls.slice(0, 8) });
    });

    const authorize =
      input.authorize ??
      ((pairingUrl: string) => waitForAuthorization(pairingUrl, cancellation.signal));
    const hadJiraConnection = hasJiraConnection(home);
    if (!hadJiraConnection) await authorize(server.pairingUrl);
    if (interrupted) throw new Error("Setup was canceled; the setup profile was kept.");
    const sync = () =>
      withDemoAccess(home, (access) =>
        syncDemoJira({ ...access, site, projectKey, boardId, sprintId }),
      );
    let synced;
    try {
      synced = await sync();
    } catch (error) {
      if (!hadJiraConnection || !isJiraAuthorizationFailure(error)) throw error;
      console.log(
        "The saved Jira grant needs attention. Reconnect Jira using this pairing URL, then continue.",
      );
      await authorize(server.pairingUrl);
      synced = await sync();
    }
    const expectedKeys = synced.links.filter((link) => link.active).map((link) => link.issue.key);
    await withDemoAccess(home, (access) =>
      verifyDemoJira({
        ...access,
        site,
        projectKey,
        boardId,
        sprintId,
        expectedKeys,
        requireEpic: false,
      }),
    );
    await withDemoAccess(home, (access) => verifyLocal({ home, ...access }));
    await stop();

    const baseline = await snapshotJiraBaseline({
      site,
      projectKey,
      boardId,
      sprintId,
      email,
      token,
    });
    if (interrupted) throw new Error("Setup was canceled; the setup profile was kept.");
    const importedKeys = new Set(expectedKeys);
    const missing = baseline.issues
      .map((issue) => issue.key)
      .filter((key) => !importedKeys.has(key));
    if (missing.length)
      throw new Error(
        `The selected Jira sprint contains issues Workbench did not import: ${missing.join(", ")}. Assign them to the connected account or choose a sprint with only demo issues, then rerun setup.`,
      );
    saveRemote(home, "jiraBaseline", baseline);
    console.log(
      `Setup complete. Captured ${baseline.issues.length} Jira issues as the disposable baseline.`,
    );
  } finally {
    process.off("SIGINT", signal);
    process.off("SIGTERM", signal);
    await stop();
  }
};
