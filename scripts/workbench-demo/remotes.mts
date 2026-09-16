// @effect-diagnostics nodeBuiltinImport:off - The demo provisioner shells out to the user's CLI tools.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

export const WORKBENCH_DEMO_MARKER = "t3-workbench-demo";
/** Label used only by live regression-created Jira issues so an interrupted run can be recovered. */
export const WORKBENCH_DEMO_CLEANUP_LABEL = "workbench-regression" as const;

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

type JiraProject = { readonly id: string; readonly key: string; readonly name?: string };
type JiraUser = { readonly accountId: string; readonly displayName?: string };
type JiraIssue = {
  readonly id: string;
  readonly key: string;
  readonly fields?: {
    readonly summary?: string;
    readonly description?: unknown;
    readonly status?: { readonly name?: string };
    readonly labels?: readonly string[];
    readonly assignee?: { readonly accountId?: string } | null;
    readonly parent?: { readonly key?: string } | null;
  };
};
type JiraTransition = { readonly id: string; readonly to?: { readonly name?: string } };
type JiraSprint = { readonly id: number; readonly name: string; readonly state?: string };

type UnknownRecord = { readonly [key: string]: unknown };

const asRecord = (value: unknown, context: string): UnknownRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Jira returned an invalid ${context}.`);
  }
  return value as UnknownRecord;
};

const asText = (value: unknown, context: string): string => {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Jira returned an invalid ${context}.`);
  return value;
};

const decodeJiraProject = (value: unknown): JiraProject => {
  const record = asRecord(value, "project");
  return {
    id: asText(record.id, "project id"),
    key: asText(record.key, "project key"),
    ...(typeof record.name === "string" ? { name: record.name } : {}),
  };
};

const decodeJiraUser = (value: unknown): JiraUser => {
  const record = asRecord(value, "account");
  return {
    accountId: asText(record.accountId, "account id"),
    ...(typeof record.displayName === "string" ? { displayName: record.displayName } : {}),
  };
};

const decodeJiraIssue = (value: unknown): JiraIssue => {
  const record = asRecord(value, "issue");
  const fields = record.fields;
  const issueFields =
    typeof fields === "object" && fields !== null && !Array.isArray(fields)
      ? (fields as JiraIssue["fields"])
      : undefined;
  if (issueFields === undefined) {
    return { id: asText(record.id, "issue id"), key: asText(record.key, "issue key") };
  }
  return {
    id: asText(record.id, "issue id"),
    key: asText(record.key, "issue key"),
    fields: issueFields,
  };
};

const decodeJiraIssueSearch = (
  value: unknown,
): {
  readonly issues: readonly JiraIssue[];
  readonly total?: number;
  readonly nextPageToken?: string;
  readonly isLast?: boolean;
} => {
  const record = asRecord(value, "issue search response");
  if (!Array.isArray(record.issues))
    throw new Error("Jira returned an invalid issue search response.");
  return {
    issues: record.issues.map((issue) => decodeJiraIssue(issue)),
    ...(typeof record.total === "number" ? { total: record.total } : {}),
    ...(typeof record.nextPageToken === "string" ? { nextPageToken: record.nextPageToken } : {}),
    ...(typeof record.isLast === "boolean" ? { isLast: record.isLast } : {}),
  };
};

const decodeJiraTransitions = (value: unknown): readonly JiraTransition[] => {
  const record = asRecord(value, "transition response");
  if (!Array.isArray(record.transitions))
    throw new Error("Jira returned an invalid transition response.");
  return record.transitions.flatMap((candidate) => {
    const transition = asRecord(candidate, "transition");
    const to = transition.to;
    const toRecord =
      typeof to === "object" && to !== null && !Array.isArray(to)
        ? (to as UnknownRecord)
        : undefined;
    if (typeof transition.id !== "string") return [];
    return [
      {
        id: transition.id,
        ...(typeof toRecord?.name === "string" ? { to: { name: toRecord.name } } : {}),
      },
    ];
  });
};

const decodeJiraSprints = (value: unknown): readonly JiraSprint[] => {
  const record = asRecord(value, "sprint response");
  if (!Array.isArray(record.values)) throw new Error("Jira returned an invalid sprint response.");
  return record.values.map((sprint) => decodeJiraSprint(sprint));
};

const decodeJiraSprint = (value: unknown): JiraSprint => {
  const record = asRecord(value, "sprint");
  if (typeof record.id !== "number" || !Number.isSafeInteger(record.id)) {
    throw new Error("Jira returned an invalid sprint id.");
  }
  return {
    id: record.id,
    name: asText(record.name, "sprint name"),
    ...(typeof record.state === "string" ? { state: record.state } : {}),
  };
};

const decodeJiraBoard = (
  value: unknown,
): { readonly id: number; readonly name: string; readonly type?: string } => {
  const record = asRecord(value, "board");
  if (typeof record.id !== "number" || !Number.isSafeInteger(record.id)) {
    throw new Error("Jira returned an invalid board id.");
  }
  return {
    id: record.id,
    name: asText(record.name, "board name"),
    ...(typeof record.type === "string" ? { type: record.type } : {}),
  };
};

const supportsJiraSprints = (type: string | undefined): boolean =>
  type === undefined || type.toLowerCase() === "scrum" || type.toLowerCase() === "simple";

const isJiraIssueInProject = (key: string, projectKey: string): boolean =>
  new RegExp(`^${projectKey}-\\d+$`).test(key);

export type JiraDemoState = "todo" | "in-progress" | "in-review" | "done" | "closed";

export type ProvisionedJiraIssue = {
  readonly logicalId: string;
  readonly key: string;
  readonly requestedState: JiraDemoState;
  readonly state: JiraDemoState | "unknown";
  readonly status?: string;
};

export type ProvisionedJira = {
  readonly site: string;
  readonly projectKey: string;
  readonly marker: string;
  readonly accountId: string;
  readonly epics: readonly string[];
  readonly issues: readonly ProvisionedJiraIssue[];
  readonly sprintId?: number;
  readonly warnings?: readonly string[];
};

export type JiraProvisionPlan = {
  readonly site: string;
  readonly projectKey: string;
  readonly marker: string;
  readonly apply: false;
  readonly operations: readonly string[];
};

export type ProvisionJiraOptions = {
  readonly site: string;
  readonly projectKey: string;
  readonly email: string;
  readonly token: string;
  readonly boardId?: number;
  /** Reuse only this explicitly selected sprint; an unrelated sprint is never selected implicitly. */
  readonly sprintId?: number;
  readonly prefix: string;
  readonly apply?: boolean;
  readonly fetcher?: typeof fetch;
};

type JiraRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

const jiraSite = (site: string): string => site.trim().replace(/\/+$/, "");
const jiraMarker = (prefix: string) =>
  `${WORKBENCH_DEMO_MARKER}-${slug(prefix, "Jira demo prefix")}`;
const jiraDescription = (text: string) =>
  text === ""
    ? null
    : {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      };

const jiraDescriptionText = (value: unknown): string | undefined => {
  // Agile sprint responses use wiki text; REST v3 responses use ADF.
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const content = Reflect.get(value, "content");
  if (!Array.isArray(content)) return undefined;
  const inlineText = (node: unknown): string => {
    if (Array.isArray(node)) return node.map(inlineText).join("");
    if (typeof node !== "object" || node === null) return "";
    const text = Reflect.get(node, "text");
    if (typeof text === "string") return text;
    const nested = Reflect.get(node, "content");
    return Array.isArray(nested) ? inlineText(nested) : "";
  };
  return content.map(inlineText).join("\n");
};

const desiredStatuses: Record<JiraDemoState, readonly string[]> = {
  todo: ["To Do", "Open", "Backlog"],
  "in-progress": ["In Progress", "Doing"],
  "in-review": ["In Review", "Review", "Code Review"],
  done: ["Done", "Resolved"],
  closed: ["Closed"],
};

const stateForStatus = (status: string | undefined): JiraDemoState | "unknown" => {
  if (status === undefined) return "unknown";
  const match = (
    Object.entries(desiredStatuses) as readonly [JiraDemoState, readonly string[]][]
  ).find(([, names]) => names.some((name) => name.toLowerCase() === status.toLowerCase()));
  return match?.[0] ?? "unknown";
};

const jiraRequest = ({
  site,
  email,
  token,
  fetcher,
}: {
  readonly site: string;
  readonly email: string;
  readonly token: string;
  readonly fetcher: typeof fetch;
}): JiraRequest => {
  const authorization = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
  return async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetcher(`${site}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
    });
    const text = await response.text();
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      const detail = typeof body === "string" ? body : JSON.stringify(body);
      throw new Error(
        `Jira ${init.method ?? "GET"} ${path} failed (${response.status}): ${detail}`,
      );
    }
    return body as T;
  };
};

const listJiraSprintIssues = async ({
  request,
  sprintId,
  fields,
}: {
  readonly request: JiraRequest;
  readonly sprintId: number;
  readonly fields: string;
}): Promise<readonly JiraIssue[]> => {
  const page = decodeJiraIssueSearch(
    await request<unknown>(
      `/rest/agile/1.0/sprint/${encodeURIComponent(String(sprintId))}/issue?maxResults=100&fields=${encodeURIComponent(fields)}`,
    ),
  );
  if (
    page.nextPageToken !== undefined ||
    page.isLast === false ||
    (page.total !== undefined && page.total > page.issues.length)
  ) {
    throw new Error(`Jira sprint ${sprintId} contains more than 100 issues.`);
  }
  const keys = page.issues.map(({ key }) => key);
  if (new Set(keys).size !== keys.length) {
    throw new Error(`Jira sprint ${sprintId} returned duplicate issue keys.`);
  }
  return page.issues;
};

const findMarkedIssues = async (request: JiraRequest, projectKey: string, marker: string) => {
  const jql = `project = "${projectKey}" AND labels = "${marker}" ORDER BY created ASC`;
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  do {
    const result = decodeJiraIssueSearch(
      await request<unknown>(
        `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,status,labels${
          nextPageToken === undefined ? "" : `&nextPageToken=${encodeURIComponent(nextPageToken)}`
        }`,
      ),
    );
    issues.push(...result.issues);
    if (result.isLast === true || result.nextPageToken === undefined) break;
    nextPageToken = result.nextPageToken;
  } while (nextPageToken !== undefined);
  return issues;
};

const transitionTo = async (
  request: JiraRequest,
  issue: JiraIssue,
  state: JiraDemoState,
): Promise<string | undefined> => {
  const current = issue.fields?.status?.name;
  if (current && desiredStatuses[state].includes(current)) return current;
  const transitions = decodeJiraTransitions(
    await request<unknown>(`/rest/api/3/issue/${encodeURIComponent(issue.key)}/transitions`),
  );
  const transition = transitions.find((candidate) =>
    desiredStatuses[state].some((name) => name.toLowerCase() === candidate.to?.name?.toLowerCase()),
  );
  if (!transition) return current;
  await request(`/rest/api/3/issue/${encodeURIComponent(issue.key)}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: transition.id } }),
  });
  return transition.to?.name ?? current;
};

export const provisionJira = async ({
  site: rawSite,
  projectKey,
  email,
  token,
  boardId,
  sprintId: selectedSprintId,
  prefix,
  apply = false,
  fetcher = fetch,
}: ProvisionJiraOptions): Promise<JiraProvisionPlan | ProvisionedJira> => {
  const site = jiraSite(rawSite);
  if (!site) throw new Error("Jira site is required.");
  if (apply && (!email.trim() || !token.trim())) {
    throw new Error("Jira email and API token are required when applying Jira provisioning.");
  }
  const safeProjectKey = projectKey.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,9}$/.test(safeProjectKey))
    throw new Error("Jira project key is invalid.");
  const safePrefix = slug(prefix, "Jira demo prefix");
  const marker = jiraMarker(safePrefix);
  const operations = [
    `Verify access to Jira project ${safeProjectKey}.`,
    "Create or reuse two marked Epics.",
    "Create or reuse marked issues in To Do, In Progress, In Review, Done, and Closed states.",
    ...(boardId === undefined
      ? []
      : [`Add the issues to board ${boardId}'s explicitly selected or marked demo sprint.`]),
  ];
  if (!apply) return { site, projectKey: safeProjectKey, marker, apply: false, operations };

  const request = jiraRequest({ site, email, token, fetcher });
  const [project, user] = await Promise.all([
    request<unknown>(`/rest/api/3/project/${encodeURIComponent(safeProjectKey)}`).then(
      decodeJiraProject,
    ),
    request<unknown>("/rest/api/3/myself").then(decodeJiraUser),
  ]);
  const existing = await findMarkedIssues(request, project.key, marker);
  const bySummary = new Map(existing.map((issue) => [issue.fields?.summary ?? "", issue]));
  const epicNames = ["Orbit foundations", "Orbit polish"];
  const epics: string[] = [];
  for (const name of epicNames) {
    const summary = `[${marker}] Epic: ${name}`;
    let issue = bySummary.get(summary);
    if (!issue) {
      issue = decodeJiraIssue(
        await request<unknown>("/rest/api/3/issue", {
          method: "POST",
          body: JSON.stringify({
            fields: {
              project: { key: project.key },
              summary,
              description: jiraDescription(`Synthetic Workbench demo Epic: ${name}`),
              issuetype: { name: "Epic" },
              labels: [marker],
              assignee: { accountId: user.accountId },
            },
          }),
        }),
      );
      bySummary.set(summary, issue);
    }
    epics.push(issue.key);
  }

  const firstEpic = epics.at(0);
  const secondEpic = epics.at(1);
  if (!firstEpic || !secondEpic) throw new Error("The Jira demo Epics could not be created.");
  const states: readonly {
    readonly logicalId: string;
    readonly state: JiraDemoState;
    readonly epic: string;
  }[] = [
    { logicalId: "todo", state: "todo", epic: firstEpic },
    { logicalId: "in-progress", state: "in-progress", epic: firstEpic },
    { logicalId: "in-review", state: "in-review", epic: secondEpic },
    { logicalId: "done", state: "done", epic: secondEpic },
    { logicalId: "closed", state: "closed", epic: secondEpic },
  ];
  const issues: ProvisionedJiraIssue[] = [];
  const warnings: string[] = [];
  for (const item of states) {
    const summary = `[${marker}] Ticket: ${item.logicalId}`;
    let issue = bySummary.get(summary);
    if (!issue) {
      const fields: Record<string, unknown> = {
        project: { key: project.key },
        summary,
        description: jiraDescription(`Synthetic Workbench demo ticket: ${item.logicalId}`),
        issuetype: { name: "Task" },
        labels: [marker],
        assignee: { accountId: user.accountId },
        parent: { key: item.epic },
      };
      issue = decodeJiraIssue(
        await request<unknown>("/rest/api/3/issue", {
          method: "POST",
          body: JSON.stringify({ fields }),
        }),
      );
      bySummary.set(summary, issue);
    }
    const status = await transitionTo(request, issue, item.state);
    const actualState = stateForStatus(status);
    if (actualState !== item.state) {
      warnings.push(
        `Jira issue ${issue.key} ended in ${status ?? "an unknown status"}, not the requested ${item.state} state; configure the project workflow before relying on that fixture.`,
      );
    }
    issues.push({
      logicalId: item.logicalId,
      key: issue.key,
      requestedState: item.state,
      state: actualState,
      ...(status === undefined ? {} : { status }),
    });
  }

  let sprintId: number | undefined;
  if (boardId !== undefined) {
    const sprints = decodeJiraSprints(
      await request<unknown>(
        `/rest/agile/1.0/board/${boardId}/sprint?state=active,future&maxResults=50`,
      ),
    );
    const expectedSprintName = `${marker} sprint`;
    let sprint =
      selectedSprintId === undefined
        ? sprints.find((candidate) => candidate.name === expectedSprintName)
        : sprints.find((candidate) => candidate.id === selectedSprintId);
    if (!sprint && selectedSprintId !== undefined) {
      sprint = decodeJiraSprint(
        await request<unknown>(`/rest/agile/1.0/sprint/${selectedSprintId}`),
      );
    }
    if (!sprint) {
      sprint = decodeJiraSprint(
        await request<unknown>("/rest/agile/1.0/sprint", {
          method: "POST",
          body: JSON.stringify({ name: expectedSprintName, originBoardId: boardId }),
        }),
      );
    }
    sprintId = sprint.id;
    await request(`/rest/agile/1.0/sprint/${sprint.id}/issue`, {
      method: "POST",
      body: JSON.stringify({ issues: issues.map((issue) => issue.key) }),
    });
  }
  return {
    site,
    projectKey: project.key,
    marker,
    accountId: user.accountId,
    epics,
    issues,
    ...(sprintId === undefined ? {} : { sprintId }),
    ...(warnings.length === 0 ? {} : { warnings }),
  };
};

export type JiraInspection = {
  readonly site: string;
  readonly projectKey: string;
  readonly authenticated: boolean;
  readonly project?: Pick<JiraProject, "id" | "key" | "name">;
  readonly accountId?: string;
  readonly board?: { readonly id: number; readonly name: string; readonly type?: string };
  readonly sprints: readonly JiraSprint[];
  readonly warnings: readonly string[];
};

export type InspectJiraOptions = {
  readonly site: string;
  readonly projectKey: string;
  readonly email?: string;
  readonly token?: string;
  readonly boardId?: number;
  readonly fetcher?: typeof fetch;
};

/** Read-only Jira inspection. Missing credentials are reported, never requested or fabricated. */
export const inspectJira = async ({
  site: rawSite,
  projectKey,
  email,
  token,
  boardId,
  fetcher = fetch,
}: InspectJiraOptions): Promise<JiraInspection> => {
  const site = jiraSite(rawSite);
  if (!site) throw new Error("Jira site is required.");
  const safeProjectKey = projectKey.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,9}$/.test(safeProjectKey)) {
    throw new Error("Jira project key is invalid.");
  }
  if (boardId !== undefined && (!Number.isSafeInteger(boardId) || boardId <= 0)) {
    throw new Error("Jira board ID must be a positive integer.");
  }
  if (!email?.trim() || !token?.trim()) {
    return {
      site,
      projectKey: safeProjectKey,
      authenticated: false,
      sprints: [],
      warnings: ["Jira credentials were not supplied; remote Jira resources were not inspected."],
    };
  }

  const request = jiraRequest({ site, email, token, fetcher });
  const warnings: string[] = [];
  let project: JiraProject | undefined;
  let accountId: string | undefined;
  try {
    project = decodeJiraProject(
      await request<unknown>(`/rest/api/3/project/${encodeURIComponent(safeProjectKey)}`),
    );
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "The Jira project could not be read.");
  }
  try {
    accountId = decodeJiraUser(await request<unknown>("/rest/api/3/myself")).accountId;
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "The Jira account could not be read.");
  }

  let board: JiraInspection["board"];
  let sprints: readonly JiraSprint[] = [];
  if (boardId !== undefined) {
    try {
      board = decodeJiraBoard(await request<unknown>(`/rest/agile/1.0/board/${boardId}`));
      sprints = decodeJiraSprints(
        await request<unknown>(
          `/rest/agile/1.0/board/${boardId}/sprint?state=active,future,closed&maxResults=50`,
        ),
      );
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "The Jira board could not be read.");
    }
  }
  return {
    site,
    projectKey: safeProjectKey,
    authenticated: project !== undefined && accountId !== undefined,
    ...(project === undefined ? {} : { project }),
    ...(accountId === undefined ? {} : { accountId }),
    ...(board === undefined ? {} : { board }),
    sprints,
    warnings,
  };
};

/**
 * The subset of Jira state that a regression run owns. Issue keys are kept in
 * the local remote manifest after the initial OAuth sync; resetting never
 * searches for or mutates issues outside this explicit list.
 */
export type JiraBaselineIssue = {
  readonly key: string;
  readonly summary: string;
  readonly description: string;
  readonly labels: readonly string[];
  readonly assigneeAccountId: string | null;
  readonly epicKey: string | null;
  readonly state: JiraDemoState;
};

export type JiraBaseline = {
  readonly site: string;
  readonly projectKey: string;
  readonly boardId: number;
  readonly boardName: string;
  readonly sprintId: number;
  readonly sprintName: string;
  readonly issues: readonly JiraBaselineIssue[];
};

export type JiraBaselineResetResult = {
  readonly site: string;
  readonly projectKey: string;
  readonly boardId: number;
  readonly sprintId: number;
  readonly issueKeys: readonly string[];
  readonly removedExtras: readonly string[];
  readonly updated: readonly string[];
  readonly transitioned: readonly string[];
  readonly verifiedIssueKeys: readonly string[];
};

export type ResetJiraOptions = {
  readonly baseline: JiraBaseline;
  readonly email: string;
  readonly token: string;
  readonly apply?: boolean;
  readonly fetcher?: typeof fetch;
};

export type SnapshotJiraBaselineOptions = {
  readonly site: string;
  readonly projectKey: string;
  readonly boardId: number;
  readonly sprintId: number;
  readonly email: string;
  readonly token: string;
  readonly fetcher?: typeof fetch;
};

/** Capture the complete owned sprint state once, before a regression run. */
export const snapshotJiraBaseline = async ({
  site: rawSite,
  projectKey: rawProjectKey,
  boardId,
  sprintId,
  email,
  token,
  fetcher = fetch,
}: SnapshotJiraBaselineOptions): Promise<JiraBaseline> => {
  const site = jiraSite(rawSite);
  const projectKey = rawProjectKey.trim().toUpperCase();
  if (!site) throw new Error("Jira baseline site is required.");
  if (!email.trim() || !token.trim()) {
    throw new Error("Jira email and API token are required to capture a Jira baseline.");
  }
  if (!/^[A-Z][A-Z0-9_]{1,9}$/.test(projectKey)) {
    throw new Error("Jira baseline project key is invalid.");
  }
  const request = jiraRequest({ site, email, token, fetcher });
  const project = decodeJiraProject(
    await request<unknown>(`/rest/api/3/project/${encodeURIComponent(projectKey)}`),
  );
  if (project.key.toUpperCase() !== projectKey) {
    throw new Error(`Jira returned project ${project.key}; expected ${projectKey}.`);
  }
  const board = decodeJiraBoard(
    await request<unknown>(`/rest/agile/1.0/board/${encodeURIComponent(String(boardId))}`),
  );
  if (!supportsJiraSprints(board.type)) {
    throw new Error(`Jira board ${boardId} is ${board.type}, not a sprint board.`);
  }
  if (board.id !== boardId) {
    throw new Error(`Jira returned board ${board.id}; expected ${boardId}.`);
  }
  const sprint = decodeJiraSprint(
    await request<unknown>(`/rest/agile/1.0/sprint/${encodeURIComponent(String(sprintId))}`),
  );
  if (sprint.id !== sprintId) {
    throw new Error(`Jira returned sprint ${sprint.id}; expected ${sprintId}.`);
  }
  const issues = (
    await listJiraSprintIssues({
      request,
      sprintId,
      fields: "project,summary,description,labels,assignee,parent,status",
    })
  ).map((issue) => {
    if (!isJiraIssueInProject(issue.key, project.key)) {
      throw new Error(`Jira sprint issue ${issue.key} is outside project ${project.key}.`);
    }
    const fields = issue.fields;
    // Jira returns null for an empty description; persist that as an empty
    // string so the baseline still records the field explicitly.
    const description =
      fields !== undefined && "description" in fields
        ? fields.description === null
          ? ""
          : jiraDescriptionText(fields.description)
        : undefined;
    const state = stateForStatus(fields?.status?.name);
    const assignee = fields?.assignee;
    const parent = fields?.parent;
    if (
      fields === undefined ||
      typeof fields.summary !== "string" ||
      description === undefined ||
      !Array.isArray(fields.labels) ||
      state === "unknown" ||
      !("assignee" in fields) ||
      (assignee !== null && typeof assignee?.accountId !== "string") ||
      (parent !== undefined && parent !== null && typeof parent.key !== "string")
    ) {
      throw new Error(`Jira issue ${issue.key} does not expose all baseline fields.`);
    }
    return {
      key: issue.key,
      summary: fields.summary,
      description,
      labels: [...fields.labels],
      assigneeAccountId: fields.assignee?.accountId ?? null,
      epicKey: fields.parent?.key ?? null,
      state,
    } satisfies JiraBaselineIssue;
  });
  return validateJiraBaseline({
    site,
    projectKey: project.key,
    boardId: board.id,
    boardName: board.name,
    sprintId: sprint.id,
    sprintName: sprint.name,
    issues,
  });
};

export const validateJiraBaseline = (baseline: JiraBaseline): JiraBaseline => {
  const site = jiraSite(baseline.site);
  if (!site) throw new Error("Jira baseline site is required.");
  const projectKey = baseline.projectKey.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,9}$/.test(projectKey)) {
    throw new Error("Jira baseline project key is invalid.");
  }
  if (!Number.isSafeInteger(baseline.boardId) || baseline.boardId <= 0) {
    throw new Error("Jira baseline board ID must be a positive integer.");
  }
  if (!baseline.boardName.trim()) {
    throw new Error("Jira baseline board name is required.");
  }
  if (!Number.isSafeInteger(baseline.sprintId) || baseline.sprintId <= 0) {
    throw new Error("Jira baseline sprint ID must be a positive integer.");
  }
  if (!baseline.sprintName.trim()) {
    throw new Error("Jira baseline sprint name is required.");
  }
  const issues = baseline.issues.map(
    ({ key, summary, description, labels, assigneeAccountId, epicKey, state }) => {
      const normalized = key.trim().toUpperCase();
      if (!new RegExp(`^${projectKey}-\\d+$`).test(normalized)) {
        throw new Error(`Jira baseline issue must belong to ${projectKey}: ${key}`);
      }
      if (!summary.trim() || typeof description !== "string") {
        throw new Error(`Jira baseline issue ${normalized} is missing summary or description.`);
      }
      if (
        !Array.isArray(labels) ||
        labels.some((label) => typeof label !== "string" || label.trim().length === 0)
      ) {
        throw new Error(`Jira baseline issue ${normalized} has invalid labels.`);
      }
      if (assigneeAccountId !== null && !assigneeAccountId.trim()) {
        throw new Error(`Jira baseline issue ${normalized} has an invalid assignee.`);
      }
      if (epicKey !== null && !new RegExp(`^${projectKey}-\\d+$`).test(epicKey)) {
        throw new Error(`Jira baseline issue ${normalized} has an invalid Epic.`);
      }
      if (!(state in desiredStatuses)) {
        throw new Error(`Jira baseline issue ${normalized} has an invalid state.`);
      }
      return {
        key: normalized,
        summary: summary.trim(),
        description,
        labels: [...labels],
        assigneeAccountId,
        epicKey,
        state,
      };
    },
  );
  if (new Set(issues.map(({ key }) => key)).size !== issues.length) {
    throw new Error("Jira baseline contains duplicate issue keys.");
  }
  return {
    site,
    projectKey,
    boardId: baseline.boardId,
    boardName: baseline.boardName.trim(),
    sprintId: baseline.sprintId,
    sprintName: baseline.sprintName.trim(),
    issues,
  };
};

/**
 * Restore explicitly owned Jira issues to the selected sprint and, when the
 * baseline records a state, transition them through the real Jira workflow.
 * The default is a write-free plan so both the wizard and CI can show the same
 * actions before applying them.
 */
export const resetJira = async ({
  baseline: input,
  email,
  token,
  apply = false,
  fetcher = fetch,
}: ResetJiraOptions): Promise<JiraBaselineResetResult | JiraProvisionPlan> => {
  const baseline = validateJiraBaseline(input);
  const operations = [
    `Verify Jira project ${baseline.projectKey} and board ${baseline.boardId}.`,
    `Add ${baseline.issues.length} owned issue(s) to sprint ${baseline.sprintId}.`,
    ...baseline.issues.map((issue) => `Restore ${issue.key} to ${issue.state}.`),
    `Delete marked ${WORKBENCH_DEMO_CLEANUP_LABEL} extras and move other ${baseline.projectKey} sprint extras to the backlog.`,
    `Verify all ${baseline.projectKey} issues in the sprint match the recorded baseline.`,
  ];
  if (!apply) {
    return {
      site: baseline.site,
      projectKey: baseline.projectKey,
      marker: `${WORKBENCH_DEMO_MARKER}-baseline`,
      apply: false,
      operations,
    };
  }
  if (!email.trim() || !token.trim()) {
    throw new Error("Jira email and API token are required when applying a Jira baseline reset.");
  }

  const request = jiraRequest({ site: baseline.site, email, token, fetcher });
  const project = decodeJiraProject(
    await request<unknown>(`/rest/api/3/project/${encodeURIComponent(baseline.projectKey)}`),
  );
  if (project.key !== baseline.projectKey) {
    throw new Error(
      `Jira returned project ${project.key}; expected ${baseline.projectKey}. Refusing baseline reset.`,
    );
  }
  const board = decodeJiraBoard(
    await request<unknown>(`/rest/agile/1.0/board/${baseline.boardId}`),
  );
  if (!supportsJiraSprints(board.type)) {
    throw new Error(`Jira board ${baseline.boardId} is ${board.type}, not a sprint board.`);
  }
  if (board.id !== baseline.boardId) {
    throw new Error(`Jira returned board ${board.id}; expected ${baseline.boardId}.`);
  }
  if (board.name !== baseline.boardName) {
    throw new Error(
      `Jira board ${baseline.boardId} is named ${board.name}; expected ${baseline.boardName}.`,
    );
  }
  const sprint = decodeJiraSprint(
    await request<unknown>(`/rest/agile/1.0/sprint/${baseline.sprintId}`),
  );
  if (sprint.id !== baseline.sprintId) {
    throw new Error(`Jira returned sprint ${sprint.id}; expected ${baseline.sprintId}.`);
  }
  if (sprint.name !== baseline.sprintName) {
    throw new Error(
      `Jira sprint ${baseline.sprintId} is named ${sprint.name}; expected ${baseline.sprintName}.`,
    );
  }

  // Read the complete current membership before any writes so a huge or
  // malformed sprint fails during preflight rather than after a partial reset.
  const sprintIssues = await listJiraSprintIssues({
    request,
    sprintId: baseline.sprintId,
    fields: "project,labels",
  });
  const baselineKeys = new Set(baseline.issues.map(({ key }) => key));
  const markedIssues = await findMarkedIssues(
    request,
    baseline.projectKey,
    WORKBENCH_DEMO_CLEANUP_LABEL,
  );
  const removableExtras = markedIssues.filter(
    (issue) =>
      isJiraIssueInProject(issue.key, baseline.projectKey) &&
      !baselineKeys.has(issue.key) &&
      issue.fields?.labels?.includes(WORKBENCH_DEMO_CLEANUP_LABEL),
  );
  const removableExtraKeys = new Set(removableExtras.map(({ key }) => key));
  const sprintBacklogExtras = sprintIssues.filter(
    (issue) =>
      isJiraIssueInProject(issue.key, baseline.projectKey) &&
      !baselineKeys.has(issue.key) &&
      !removableExtraKeys.has(issue.key),
  );

  const issueKeys: string[] = [];
  const updates: Array<{
    readonly key: string;
    readonly fields: Record<string, unknown>;
    readonly transitionId?: string;
  }> = [];
  for (const baselineIssue of baseline.issues) {
    const issue = decodeJiraIssue(
      await request<unknown>(
        `/rest/api/3/issue/${encodeURIComponent(baselineIssue.key)}?fields=project,summary,description,labels,assignee,parent,status`,
      ),
    );
    if (issue.key !== baselineIssue.key) {
      throw new Error(
        `Jira issue ${baselineIssue.key} resolved to ${issue.key}; refusing to reset a different issue.`,
      );
    }
    issueKeys.push(issue.key);

    let transitionId: string | undefined;
    if (stateForStatus(issue.fields?.status?.name) !== baselineIssue.state) {
      const transitions = decodeJiraTransitions(
        await request<unknown>(`/rest/api/3/issue/${encodeURIComponent(issue.key)}/transitions`),
      );
      transitionId = transitions.find((candidate) =>
        desiredStatuses[baselineIssue.state].some(
          (name) => name.toLowerCase() === candidate.to?.name?.toLowerCase(),
        ),
      )?.id;
      if (transitionId === undefined) {
        throw new Error(
          `Jira issue ${issue.key} cannot transition to ${baselineIssue.state}; refusing partial baseline reset.`,
        );
      }
    }
    updates.push({
      key: issue.key,
      fields: {
        summary: baselineIssue.summary,
        description: jiraDescription(baselineIssue.description),
        labels: [...baselineIssue.labels],
        assignee:
          baselineIssue.assigneeAccountId === null
            ? null
            : { accountId: baselineIssue.assigneeAccountId },
        parent: baselineIssue.epicKey === null ? null : { key: baselineIssue.epicKey },
      },
      ...(transitionId === undefined ? {} : { transitionId }),
    });
  }

  const removedExtras: string[] = [];
  for (const extra of removableExtras) {
    await request(`/rest/api/3/issue/${encodeURIComponent(extra.key)}`, {
      method: "DELETE",
    });
    removedExtras.push(extra.key);
  }
  if (sprintBacklogExtras.length > 0) {
    await request("/rest/agile/1.0/backlog/issue", {
      method: "POST",
      body: JSON.stringify({ issues: sprintBacklogExtras.map(({ key }) => key) }),
    });
  }

  const updated: string[] = [];
  for (const update of updates) {
    await request(`/rest/api/3/issue/${encodeURIComponent(update.key)}`, {
      method: "PUT",
      body: JSON.stringify({ fields: update.fields }),
    });
    updated.push(update.key);
  }
  if (issueKeys.length) {
    await request(`/rest/agile/1.0/sprint/${baseline.sprintId}/issue`, {
      method: "POST",
      body: JSON.stringify({ issues: issueKeys }),
    });
  }

  const transitioned: string[] = [];
  for (const update of updates) {
    if (update.transitionId === undefined) continue;
    await request(`/rest/api/3/issue/${encodeURIComponent(update.key)}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: update.transitionId } }),
    });
    transitioned.push(update.key);
  }
  const verifiedIssueKeys = (
    await listJiraSprintIssues({
      request,
      sprintId: baseline.sprintId,
      fields: "project,labels",
    })
  ).map(({ key }) => key);
  const verifiedProjectIssueKeys = verifiedIssueKeys.filter((key) =>
    isJiraIssueInProject(key, baseline.projectKey),
  );
  const verifiedSet = new Set(verifiedIssueKeys);
  const missing = baseline.issues.map(({ key }) => key).filter((key) => !verifiedSet.has(key));
  const unexpected = verifiedProjectIssueKeys.filter((key) => !baselineKeys.has(key));
  if (missing.length || unexpected.length) {
    throw new Error(
      `Jira sprint ${baseline.sprintId} membership mismatch after reset (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}).`,
    );
  }
  return {
    site: baseline.site,
    projectKey: baseline.projectKey,
    boardId: board.id,
    sprintId: sprint.id,
    issueKeys,
    removedExtras,
    updated,
    transitioned,
    verifiedIssueKeys,
  };
};
