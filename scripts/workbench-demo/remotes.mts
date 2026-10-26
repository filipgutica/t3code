// @effect-diagnostics nodeBuiltinImport:off - The demo provisioner shells out to the user's CLI tools.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

export const WORKBENCH_DEMO_MARKER = "t3-workbench-demo";

type CommandResult = {
  readonly stdout: string;
  readonly stderr: string;
};

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: { readonly cwd?: string },
) => Promise<CommandResult>;

const defaultCommandRunner: CommandRunner = async (command, args, options) => {
  const result = await execFile(command, [...args], {
    cwd: options?.cwd,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { stdout: result.stdout, stderr: result.stderr };
};

const slug = (value: string, label: string): string => {
  const result = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!result) throw new Error(`${label} must contain at least one letter or number.`);
  return result;
};

const parseJson = <T,>(result: CommandResult, command: string): T => {
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(`The ${command} command returned invalid JSON.`);
  }
};

const isCommandFailure = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const code = Reflect.get(error, "code");
  return code === 1 || code === 2 || code === 404;
};

const runOptional = async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await operation();
  } catch (error) {
    if (isCommandFailure(error)) return undefined;
    throw error;
  }
};

type GitHubRepo = {
  readonly nameWithOwner: string;
  readonly description?: string | null;
  readonly url?: string;
  readonly defaultBranchRef?: { readonly name: string } | null;
};

type GitHubPullRequest = {
  readonly number: number;
  readonly title: string;
  readonly headRefName: string;
  readonly state: string;
  readonly isDraft: boolean;
  readonly url: string;
  readonly mergedAt?: string | null;
};

type GitHubApiPullRequest = {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly draft?: boolean | null;
  readonly html_url: string;
  readonly merged_at?: string | null;
  readonly head?: { readonly ref?: string };
};

export type DemoPullRequestScenario = "draft" | "open" | "closed" | "merged";

export type ProvisionedGitHubPullRequest = {
  readonly scenario: DemoPullRequestScenario | "unknown";
  readonly number: number;
  readonly state: string;
  readonly isDraft: boolean;
  readonly url: string;
};

export type ProvisionedGitHubRepository = {
  readonly name: string;
  readonly fullName: string;
  readonly url: string;
  readonly pullRequests: readonly ProvisionedGitHubPullRequest[];
};

export type GitHubProvisionPlan = {
  readonly owner: string;
  readonly prefix: string;
  readonly apply: false;
  readonly marker: string;
  readonly operations: readonly string[];
  readonly repositories: readonly string[];
};

export type GitHubProvisionResult =
  | GitHubProvisionPlan
  | {
      readonly owner: string;
      readonly prefix: string;
      readonly apply: true;
      readonly marker: string;
      readonly repositories: readonly ProvisionedGitHubRepository[];
    };

export type ProvisionGitHubOptions = {
  readonly owner: string;
  readonly prefix: string;
  readonly apply?: boolean;
  readonly commandRunner?: CommandRunner;
};

const githubScenarios: readonly {
  readonly scenario: DemoPullRequestScenario;
  readonly title: string;
  readonly draft?: boolean;
}[] = [
  { scenario: "draft", title: "Draft demo change", draft: true },
  { scenario: "open", title: "Open demo change" },
  { scenario: "closed", title: "Closed demo change" },
  { scenario: "merged", title: "Merged demo change" },
];

const repoNames = (prefix: string): readonly string[] => [
  `${prefix}-orbit-api`,
  `${prefix}-orbit-web`,
];

const markerFor = (prefix: string) => `${WORKBENCH_DEMO_MARKER}:${prefix}`;

const gh = async (
  runner: CommandRunner,
  args: readonly string[],
  options?: { readonly cwd?: string },
): Promise<CommandResult> => runner("gh", args, options);

const inspectRepository = async (
  runner: CommandRunner,
  fullName: string,
): Promise<GitHubRepo | undefined> =>
  runOptional(async () =>
    parseJson<GitHubRepo>(
      await gh(runner, [
        "repo",
        "view",
        fullName,
        "--json",
        "nameWithOwner,description,url,defaultBranchRef",
      ]),
      "gh repo view",
    ),
  );

const listPullRequests = async (
  runner: CommandRunner,
  fullName: string,
): Promise<readonly GitHubPullRequest[]> => {
  const result = await gh(runner, [
    "api",
    "--paginate",
    "--slurp",
    `repos/${fullName}/pulls?state=all&per_page=100`,
  ]);
  const pages = parseJson<readonly (readonly GitHubApiPullRequest[])[]>(result, "gh api");
  return pages.flat().map((pullRequest) => ({
    number: pullRequest.number,
    title: pullRequest.title,
    headRefName: pullRequest.head?.ref ?? "",
    state:
      pullRequest.merged_at === null || pullRequest.merged_at === undefined
        ? pullRequest.state.toUpperCase()
        : "MERGED",
    isDraft: pullRequest.draft === true,
    url: pullRequest.html_url,
    ...(pullRequest.merged_at === undefined ? {} : { mergedAt: pullRequest.merged_at }),
  }));
};

const requireGitHubMarker = (repo: GitHubRepo, marker: string): void => {
  if (!repo.description?.includes(marker)) {
    throw new Error(
      `Refusing to modify ${repo.nameWithOwner}: it exists but is not marked ${marker}. Choose a different prefix.`,
    );
  }
};

const writeSyntheticRepository = async (
  runner: CommandRunner,
  fullName: string,
  marker: string,
): Promise<{ readonly directory: string; readonly defaultBranch: string }> => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-workbench-demo-"));
  try {
    await NodeFSP.writeFile(
      NodePath.join(directory, "README.md"),
      `# Workbench demo repository\n\n${marker}\n`,
    );
    await runner("git", ["init", "-b", "main"], { cwd: directory });
    await runner("git", ["config", "user.name", "Workbench Demo"], { cwd: directory });
    await runner("git", ["config", "user.email", "workbench-demo@example.invalid"], {
      cwd: directory,
    });
    await runner("git", ["add", "README.md"], { cwd: directory });
    await runner("git", ["commit", "-m", "chore: initialize Workbench demo repository"], {
      cwd: directory,
    });
    await gh(
      runner,
      [
        "repo",
        "create",
        fullName,
        "--private",
        "--description",
        marker,
        "--source",
        directory,
        "--remote",
        "origin",
        "--push",
      ],
      { cwd: directory },
    );
  } catch (error) {
    await NodeFSP.rm(directory, { recursive: true, force: true });
    throw error;
  }
  return { directory, defaultBranch: "main" };
};

const cloneMarkedRepository = async (runner: CommandRunner, fullName: string): Promise<string> => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-workbench-demo-"));
  try {
    await gh(runner, ["repo", "clone", fullName, directory]);
    await runner("git", ["config", "user.name", "Workbench Demo"], { cwd: directory });
    await runner("git", ["config", "user.email", "workbench-demo@example.invalid"], {
      cwd: directory,
    });
    return directory;
  } catch (error) {
    await NodeFSP.rm(directory, { recursive: true, force: true });
    throw error;
  }
};

const commitBranch = async ({
  runner,
  directory,
  branch,
  defaultBranch,
  marker,
  scenario,
}: {
  readonly runner: CommandRunner;
  readonly directory: string;
  readonly branch: string;
  readonly defaultBranch: string;
  readonly marker: string;
  readonly scenario: DemoPullRequestScenario;
}): Promise<void> => {
  await runner("git", ["checkout", defaultBranch], { cwd: directory });
  await runner("git", ["pull", "--ff-only", "origin", defaultBranch], { cwd: directory });
  await runner("git", ["checkout", "-b", branch], { cwd: directory });
  const path = NodePath.join(directory, `demo-${scenario}.md`);
  await NodeFSP.writeFile(
    path,
    `# ${scenario} demo change\n\n${marker}\n\nThis file is synthetic demo content.\n`,
  );
  await runner("git", ["add", NodePath.basename(path)], { cwd: directory });
  await runner("git", ["commit", "-m", `demo: add ${scenario} scenario`], { cwd: directory });
  await runner("git", ["push", "--set-upstream", "origin", branch], { cwd: directory });
};

const remoteBranchExists = async (
  runner: CommandRunner,
  directory: string,
  branch: string,
): Promise<boolean> =>
  (
    await runner("git", ["ls-remote", "--heads", "origin", `refs/heads/${branch}`], {
      cwd: directory,
    })
  ).stdout.trim().length > 0;

const createPullRequest = async ({
  runner,
  fullName,
  defaultBranch,
  branch,
  title,
  marker,
  draft,
}: {
  readonly runner: CommandRunner;
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly branch: string;
  readonly title: string;
  readonly marker: string;
  readonly draft?: boolean;
}): Promise<GitHubPullRequest> => {
  const result = await gh(runner, [
    "pr",
    "create",
    "--repo",
    fullName,
    "--head",
    branch,
    "--base",
    defaultBranch,
    "--title",
    `[${marker}] ${title}`,
    "--body",
    `Synthetic Workbench demo pull request.\n\n${marker}`,
    ...(draft ? ["--draft"] : []),
  ]);
  const url = result.stdout.trim().split(/\s+/).at(-1);
  if (!url) throw new Error(`gh pr create did not return a URL for ${branch}.`);
  const number = Number.parseInt(url.split("/").at(-1) ?? "", 10);
  if (!Number.isInteger(number))
    throw new Error(`Could not read the pull request number from ${url}.`);
  return {
    number,
    title,
    headRefName: branch,
    state: "OPEN",
    isDraft: draft === true,
    url,
  };
};

const assertStablePullRequestState = (
  scenario: DemoPullRequestScenario,
  pullRequest: GitHubPullRequest,
  fullName: string,
): void => {
  if (scenario === "draft" && (pullRequest.state !== "OPEN" || !pullRequest.isDraft)) {
    throw new Error(
      `Refusing to reuse ${fullName} pull request #${pullRequest.number}: the draft scenario drifted to ${pullRequest.state}${pullRequest.isDraft ? "" : " and is no longer a draft"}.`,
    );
  }
  if (scenario === "open" && (pullRequest.state !== "OPEN" || pullRequest.isDraft)) {
    throw new Error(
      `Refusing to reuse ${fullName} pull request #${pullRequest.number}: the open scenario drifted to ${pullRequest.state}${pullRequest.isDraft ? " and is still a draft" : ""}.`,
    );
  }
};

export const provisionGitHub = async ({
  owner,
  prefix,
  apply = false,
  commandRunner = defaultCommandRunner,
}: ProvisionGitHubOptions): Promise<GitHubProvisionResult> => {
  const safeOwner = slug(owner, "GitHub owner");
  const safePrefix = slug(prefix, "GitHub demo prefix");
  const marker = markerFor(safePrefix);
  const names = repoNames(safePrefix);
  await gh(commandRunner, ["auth", "status"]);

  const operations = [
    `Create or reuse private repositories ${names.join(" and ")} under ${safeOwner}.`,
    ...names.flatMap((name) =>
      githubScenarios.map(
        ({ scenario }) => `Create ${scenario} pull request in ${safeOwner}/${name}.`,
      ),
    ),
  ];
  if (!apply) {
    return {
      owner: safeOwner,
      prefix: safePrefix,
      apply: false,
      marker,
      operations,
      repositories: names,
    };
  }

  const repositories: ProvisionedGitHubRepository[] = [];
  for (const name of names) {
    const fullName = `${safeOwner}/${name}`;
    let repo = await inspectRepository(commandRunner, fullName);
    let directory: string | undefined;
    let defaultBranch = repo?.defaultBranchRef?.name ?? "main";
    if (repo) {
      requireGitHubMarker(repo, marker);
    } else {
      const created = await writeSyntheticRepository(commandRunner, fullName, marker);
      directory = created.directory;
      defaultBranch = created.defaultBranch;
      repo = await inspectRepository(commandRunner, fullName);
      if (!repo) {
        await NodeFSP.rm(directory, { recursive: true, force: true });
        throw new Error(`Could not inspect newly created repository ${fullName}.`);
      }
    }

    try {
      const existing = await listPullRequests(commandRunner, fullName);
      const pullRequests: ProvisionedGitHubPullRequest[] = [];
      for (const { scenario, title, draft } of githubScenarios) {
        const branch = `${safePrefix}/demo-${scenario}`;
        const found = existing.find((pullRequest) => pullRequest.headRefName === branch);
        let pullRequest = found;
        if (!pullRequest) {
          if (!directory) {
            directory = await cloneMarkedRepository(commandRunner, fullName);
          }
          if (!(await remoteBranchExists(commandRunner, directory, branch))) {
            await commitBranch({
              runner: commandRunner,
              directory,
              branch,
              defaultBranch,
              marker,
              scenario,
            });
          }
          pullRequest = await createPullRequest({
            runner: commandRunner,
            fullName,
            defaultBranch,
            branch,
            title,
            marker,
            ...(draft === undefined ? {} : { draft }),
          });
          if (scenario === "closed") {
            await gh(commandRunner, [
              "pr",
              "close",
              String(pullRequest.number),
              "--repo",
              fullName,
            ]);
            pullRequest = { ...pullRequest, state: "CLOSED" };
          } else if (scenario === "merged") {
            await gh(commandRunner, [
              "pr",
              "merge",
              String(pullRequest.number),
              "--repo",
              fullName,
              "--squash",
              "--delete-branch",
            ]);
            pullRequest = { ...pullRequest, state: "MERGED", isDraft: false };
          }
        } else {
          assertStablePullRequestState(scenario, pullRequest, fullName);
          if (
            scenario === "closed" &&
            pullRequest.state !== "CLOSED" &&
            pullRequest.state !== "MERGED"
          ) {
            await gh(commandRunner, [
              "pr",
              "close",
              String(pullRequest.number),
              "--repo",
              fullName,
            ]);
            pullRequest = { ...pullRequest, state: "CLOSED" };
          } else if (scenario === "merged" && pullRequest.state !== "MERGED") {
            await gh(commandRunner, [
              "pr",
              "merge",
              String(pullRequest.number),
              "--repo",
              fullName,
              "--squash",
              "--delete-branch",
            ]);
            pullRequest = { ...pullRequest, state: "MERGED", isDraft: false };
          }
        }
        pullRequests.push({
          scenario,
          number: pullRequest.number,
          state: pullRequest.mergedAt ? "MERGED" : pullRequest.state,
          isDraft: pullRequest.isDraft,
          url: pullRequest.url,
        });
      }
      repositories.push({
        name,
        fullName,
        url: repo.url ?? `https://github.com/${fullName}`,
        pullRequests,
      });
    } finally {
      if (directory) await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  }
  return { owner: safeOwner, prefix: safePrefix, apply: true, marker, repositories };
};

export type GitHubInspectionRepository = {
  readonly fullName: string;
  readonly url: string;
  readonly description: string | null;
  readonly defaultBranch: string | null;
  readonly pullRequests: readonly ProvisionedGitHubPullRequest[];
};

export type GitHubInspection = {
  readonly repositories: readonly GitHubInspectionRepository[];
  readonly missing: readonly string[];
};

export type InspectGitHubOptions = {
  readonly repositories: readonly string[];
  readonly commandRunner?: CommandRunner;
};

const remoteName = (value: string): string => {
  const name = value.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error(`GitHub repository must be in owner/name form: ${value}`);
  }
  return name;
};

/** Read-only inspection for reuse mode; it does not require the demo marker. */
export const inspectGitHub = async ({
  repositories,
  commandRunner = defaultCommandRunner,
}: InspectGitHubOptions): Promise<GitHubInspection> => {
  await gh(commandRunner, ["auth", "status"]);
  const found: GitHubInspectionRepository[] = [];
  const missing: string[] = [];
  for (const input of repositories) {
    const fullName = remoteName(input);
    const repo = await inspectRepository(commandRunner, fullName);
    if (!repo) {
      missing.push(fullName);
      continue;
    }
    const pullRequests = await listPullRequests(commandRunner, fullName);
    found.push({
      fullName,
      url: repo.url ?? `https://github.com/${fullName}`,
      description: repo.description ?? null,
      defaultBranch: repo.defaultBranchRef?.name ?? null,
      pullRequests: pullRequests.map((pullRequest) => ({
        scenario: "unknown",
        number: pullRequest.number,
        state: pullRequest.mergedAt ? "MERGED" : pullRequest.state,
        isDraft: pullRequest.isDraft,
        url: pullRequest.url,
      })),
    });
  }
  return { repositories: found, missing };
};
