// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Host-side first-run setup owns the demo process and private profile files.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { withDemoAccess } from "./access.mts";
import { readConfig, requireHome } from "./environment.mts";
import { launchDemo } from "./launch.mts";
import { linkDemoPullRequests } from "./integrations.mts";
import { setupLocal, verifyLocal } from "./local.mts";
import { inspectGitHub } from "./remotes.mts";
import { DEMO_REPOSITORIES } from "./repositories.mts";

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

export const prepareDemoProfile = async (input: { readonly home: string }): Promise<void> => {
  const home = requireHome(input.home);
  const config = readConfig(home);
  const { repositories, remotes, commits } = repositorySetup(config);

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
  const signal = () => {
    interrupted = true;
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

    await withDemoAccess(home, (access) => verifyLocal({ home, ...access }));
    await stop();
    if (interrupted) throw new Error("Setup was canceled; the setup profile was kept.");
    console.log("Setup complete.");
  } finally {
    process.off("SIGINT", signal);
    process.off("SIGTERM", signal);
    await stop();
  }
};
