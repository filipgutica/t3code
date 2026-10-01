// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalFetch:off - This host-side fixture creates an isolated local T3 environment.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { CommandId, ProjectId, ThreadId } from "../../packages/contracts/src/baseSchemas.ts";
import { DEFAULT_MODEL } from "../../packages/contracts/src/model.ts";
import { ProviderInstanceId } from "../../packages/contracts/src/providerInstance.ts";
import {
  DEFAULT_RUNTIME_MODE,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ORCHESTRATION_WS_METHODS,
  ModelSelection as ModelSelectionSchema,
  type OrchestrationShellSnapshot,
  type ClientOrchestrationCommand,
  type ModelSelection,
} from "../../packages/contracts/src/orchestration.ts";
import { WORKBENCH_WS_METHODS } from "../../packages/contracts/src/workbenchRpc.ts";
import type {
  WorkbenchCreateAssignmentInput,
  WorkbenchSnapshot,
} from "../../packages/contracts/src/workbench.ts";
import {
  WorkbenchAssignmentId,
  WorkbenchEpicId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "../../packages/contracts/src/workbench.ts";
import { WsRpcGroup } from "../../packages/contracts/src/rpc.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Socket from "effect/unstable/socket/Socket";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

const DEMO_VERSION = 1;
const DEMO_AUTHOR = "Workbench Demo";
const DEMO_EMAIL = "workbench-demo@example.invalid";
const FALLBACK_MODEL_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: DEFAULT_MODEL,
};

export const readDemoModelSelection = async (home: string): Promise<ModelSelection> => {
  const settingsPath = NodePath.join(home, "userdata", "settings.json");
  const text = await NodeFSP.readFile(settingsPath, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  });
  if (text === null) return FALLBACK_MODEL_SELECTION;
  const settings: unknown = JSON.parse(text);
  if (
    typeof settings !== "object" ||
    settings === null ||
    !("defaultModelSelection" in settings) ||
    settings.defaultModelSelection === null ||
    settings.defaultModelSelection === undefined
  )
    return FALLBACK_MODEL_SELECTION;
  return Schema.decodeUnknownPromise(ModelSelectionSchema)(settings.defaultModelSelection);
};

export const LOCAL_DEMO_REPOSITORIES = [
  { id: "orbit-web", title: "Orbit Web", description: "Customer portal and onboarding." },
  { id: "orbit-api", title: "Orbit API", description: "Invitations, teams, and account services." },
  {
    id: "beacon-cli",
    title: "Beacon CLI",
    description: "A command-line tool for local service checks.",
  },
  {
    id: "beacon-docs",
    title: "Beacon Docs",
    description: "Guides and examples for a first successful run.",
  },
] as const;
export const LOCAL_DEMO_MARKER = "t3-workbench-demo:local";

const WORKBENCH_PROJECTS = [
  { id: "orbit", title: "Orbit", repositoryIds: ["orbit-web", "orbit-api"] },
  { id: "beacon", title: "Beacon", repositoryIds: ["beacon-cli", "beacon-docs"] },
] as const;

const EPICS = [
  { id: "orbit-onboarding", projectId: "orbit", title: "A welcoming first run" },
  { id: "orbit-teams", projectId: "orbit", title: "Better together" },
  { id: "beacon-first", projectId: "beacon", title: "From install to first check" },
  { id: "beacon-reliable", projectId: "beacon", title: "Checks you can trust" },
] as const;

type TicketStatus = "todo" | "in_progress" | "done";

type TicketFixture = {
  id: string;
  projectId: string;
  epicId: string | null;
  title: string;
  primaryProjectId: string;
  status: TicketStatus;
  kind?: "story" | "bug";
  repositoryProjectIds?: readonly string[];
  archived?: boolean;
};

const TICKETS: readonly TicketFixture[] = [
  {
    id: "orbit-001",
    projectId: "orbit",
    epicId: "orbit-onboarding",
    title: "Create the welcome checklist",
    primaryProjectId: "orbit-web",
    status: "in_progress",
    repositoryProjectIds: ["orbit-web", "orbit-api"],
  },
  {
    id: "orbit-002",
    projectId: "orbit",
    epicId: "orbit-onboarding",
    title: "Save onboarding progress",
    primaryProjectId: "orbit-api",
    status: "todo",
  },
  {
    id: "orbit-003",
    projectId: "orbit",
    epicId: "orbit-onboarding",
    title: "Add helpful empty states",
    primaryProjectId: "orbit-web",
    status: "done",
  },
  {
    id: "orbit-004",
    projectId: "orbit",
    epicId: null,
    title: "Fix focus after creating a project",
    primaryProjectId: "orbit-web",
    status: "todo",
    kind: "bug",
  },
  {
    id: "orbit-005",
    projectId: "orbit",
    epicId: "orbit-teams",
    title: "Invite teammates by email",
    primaryProjectId: "orbit-web",
    status: "in_progress",
  },
  {
    id: "orbit-006",
    projectId: "orbit",
    epicId: "orbit-teams",
    title: "Expire unused invitation links",
    primaryProjectId: "orbit-api",
    status: "todo",
  },
  {
    id: "orbit-007",
    projectId: "orbit",
    epicId: "orbit-teams",
    title: "Add a team settings page",
    primaryProjectId: "orbit-web",
    status: "todo",
  },
  {
    id: "orbit-008",
    projectId: "orbit",
    epicId: "orbit-teams",
    title: "Validate invitation addresses",
    primaryProjectId: "orbit-api",
    status: "done",
  },
  {
    id: "beacon-009",
    projectId: "beacon",
    epicId: "beacon-first",
    title: "Build an interactive setup command",
    primaryProjectId: "beacon-cli",
    status: "in_progress",
  },
  {
    id: "beacon-010",
    projectId: "beacon",
    epicId: "beacon-first",
    title: "Write the five-minute quickstart",
    primaryProjectId: "beacon-docs",
    status: "todo",
  },
  {
    id: "beacon-011",
    projectId: "beacon",
    epicId: "beacon-first",
    title: "Make CLI errors actionable",
    primaryProjectId: "beacon-cli",
    status: "done",
  },
  {
    id: "beacon-012",
    projectId: "beacon",
    epicId: "beacon-first",
    title: "Document configuration examples",
    primaryProjectId: "beacon-docs",
    status: "todo",
  },
  {
    id: "beacon-013",
    projectId: "beacon",
    epicId: "beacon-reliable",
    title: "Retry temporary connection failures",
    primaryProjectId: "beacon-cli",
    status: "todo",
  },
  {
    id: "beacon-014",
    projectId: "beacon",
    epicId: "beacon-reliable",
    title: "Add structured JSON output",
    primaryProjectId: "beacon-cli",
    status: "in_progress",
  },
  {
    id: "beacon-015",
    projectId: "beacon",
    epicId: "beacon-reliable",
    title: "Explain exit codes for CI",
    primaryProjectId: "beacon-docs",
    status: "done",
  },
  {
    id: "beacon-016",
    projectId: "beacon",
    epicId: "beacon-reliable",
    title: "Retire the old configuration example",
    primaryProjectId: "beacon-docs",
    status: "done",
    archived: true,
  },
];

const ASSIGNED_THREADS = [
  {
    ticketId: "orbit-001",
    projectId: "orbit-web",
    id: "orbit-001-thread",
    title: "Create the welcome checklist",
  },
  {
    ticketId: "orbit-005",
    projectId: "orbit-web",
    id: "orbit-005-thread",
    title: "Invite teammates by email",
  },
  {
    ticketId: "beacon-009",
    projectId: "beacon-cli",
    id: "beacon-009-thread",
    title: "Build an interactive setup command",
  },
  {
    ticketId: "beacon-014",
    projectId: "beacon-cli",
    id: "beacon-014-thread",
    title: "Add structured JSON output",
  },
] as const;

export interface LocalDemoOptions {
  readonly home: string;
  readonly modelSelection?: ModelSelection;
  /** Local server WebSocket URL. Omit to prepare only local Git repositories. */
  readonly wsUrl?: string;
  /** Optional bearer token used to mint a fresh one-time WebSocket ticket per RPC socket. */
  readonly token?: string | undefined;
  /** Explicit remote URLs supplied by GitHub provisioning or reuse mode. */
  readonly repositoryRemotes?: Readonly<Record<string, string>>;
  /** Immutable commits for freshly cloned remote fixtures. Existing checkouts must already match. */
  readonly repositoryCommits?: Readonly<Record<string, string>>;
  /** Optional disposable bare remotes for synthetic repositories that prepare Ticket worktrees. */
  readonly localOriginDirectory?: string;
  readonly now?: () => string;
  readonly prepareWorkspaces?: boolean;
}

export interface LocalDemoManifest {
  readonly version: number;
  readonly home: string;
  readonly projects: ReadonlyArray<{ readonly id: string; readonly path: string }>;
  readonly workbenchProjects: ReadonlyArray<string>;
  readonly epics: ReadonlyArray<string>;
  readonly tickets: ReadonlyArray<string>;
  readonly assignedThreads: ReadonlyArray<string>;
}

export interface LocalDemoVerification {
  readonly manifest: LocalDemoManifest;
  readonly repositoryCount: number;
  readonly repositoryHeadCount: number;
  readonly expectedWorkbenchCounts: {
    readonly projects: number;
    readonly epics: number;
    readonly tickets: number;
    readonly assignments: number;
  };
  readonly workbench?: Pick<WorkbenchSnapshot, "projects" | "epics" | "tickets" | "assignments">;
}

const manifestPath = (home: string): string => NodePath.join(home, "workbench-demo.json");

const isoNow = (): string => new Date().toISOString();

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await NodeFSP.access(path);
    return true;
  } catch {
    return false;
  }
};

const runGit = async (cwd: string, args: ReadonlyArray<string>): Promise<string> => {
  const result = await execFile("git", [...args], { cwd });
  return result.stdout.trim();
};

const ensureRepository = async (
  root: string,
  repository: (typeof LOCAL_DEMO_REPOSITORIES)[number],
  remoteUrl: string | undefined,
): Promise<void> => {
  if (remoteUrl !== undefined && !(await pathExists(root))) {
    await NodeFSP.mkdir(NodePath.dirname(root), { recursive: true });
    if (remoteUrl.startsWith("https://github.com/")) {
      await execFile("gh", [
        "repo",
        "clone",
        remoteUrl.slice("https://github.com/".length).replace(/\.git$/, ""),
        root,
      ]);
    } else {
      await execFile("git", ["clone", remoteUrl, root]);
    }
    return;
  }
  if (remoteUrl !== undefined) {
    if (!(await pathExists(NodePath.join(root, ".git")))) {
      throw new Error(`Refusing to use ${root}: it is not a Git checkout.`);
    }
    const configuredRemote = await runGit(root, ["remote", "get-url", "origin"]).catch(
      () => undefined,
    );
    const normalizeRemote = (value: string | undefined) =>
      value
        ?.replace(/^git@github\.com:/, "https://github.com/")
        .replace(/\.git$/, "")
        .toLowerCase();
    if (normalizeRemote(configuredRemote) !== normalizeRemote(remoteUrl)) {
      throw new Error(
        `Refusing to reuse ${root}: origin is ${configuredRemote ?? "missing"}, expected ${remoteUrl}.`,
      );
    }
    return;
  }
  const ownershipPath = NodePath.join(root, ".workbench-demo-repository");
  if (await pathExists(root)) {
    const entries = await NodeFSP.readdir(root);
    if (
      entries.length &&
      (!(await pathExists(ownershipPath)) ||
        (await NodeFSP.readFile(ownershipPath, "utf8")) !== repository.id)
    ) {
      throw new Error(`Refusing to seed an unowned repository directory: ${root}`);
    }
  }
  await NodeFSP.mkdir(root, { recursive: true });
  await NodeFSP.writeFile(ownershipPath, repository.id);
  await NodeFSP.mkdir(NodePath.join(root, "src"), { recursive: true });
  const readme = NodePath.join(root, "README.md");
  if (!(await pathExists(readme))) {
    await NodeFSP.writeFile(
      readme,
      `# ${repository.title}\n\n${repository.description}\n\n${LOCAL_DEMO_MARKER}\n`,
    );
  }
  const packageJson = NodePath.join(root, "package.json");
  if (!(await pathExists(packageJson))) {
    await NodeFSP.writeFile(
      packageJson,
      `${JSON.stringify({ name: repository.id, private: true, type: "module", scripts: { test: "node --test" } }, null, 2)}\n`,
    );
  }
  const source = NodePath.join(root, "src/index.js");
  if (!(await pathExists(source))) {
    await NodeFSP.writeFile(
      source,
      `export const projectName = ${JSON.stringify(repository.title)};\n`,
    );
  }

  if (!(await pathExists(NodePath.join(root, ".git")))) {
    await runGit(root, ["init", "-b", "main"]);
  }
  const hasHead = await runGit(root, ["rev-parse", "--verify", "HEAD"]).then(
    () => true,
    () => false,
  );
  if (!hasHead) {
    await runGit(root, ["add", "."]);
    await execFile(
      "git",
      [
        "-c",
        `user.name=${DEMO_AUTHOR}`,
        "-c",
        `user.email=${DEMO_EMAIL}`,
        "commit",
        "-m",
        "chore: initialize fictional demo project",
      ],
      { cwd: root },
    );
  }
  const markerFile = NodePath.join(root, "src", "demo-marker.js");
  if (!(await pathExists(markerFile))) {
    await NodeFSP.writeFile(
      markerFile,
      `export const demoMarker = ${JSON.stringify(LOCAL_DEMO_MARKER)};\n`,
    );
    await runGit(root, ["add", NodePath.relative(root, markerFile)]);
    await execFile(
      "git",
      [
        "-c",
        `user.name=${DEMO_AUTHOR}`,
        "-c",
        `user.email=${DEMO_EMAIL}`,
        "commit",
        "-m",
        "chore: add demo marker",
      ],
      { cwd: root },
    );
  }
};

const ensureLocalOrigin = async ({
  root,
  repositoryId,
  originDirectory,
}: {
  readonly root: string;
  readonly repositoryId: string;
  readonly originDirectory: string;
}): Promise<void> => {
  const originRoot = NodePath.join(originDirectory, `${repositoryId}.git`);
  await NodeFSP.mkdir(originDirectory, { recursive: true });
  if (!(await pathExists(originRoot))) {
    await execFile("git", ["init", "--bare", originRoot]);
  }
  await execFile("git", ["push", "--force", originRoot, "main:refs/heads/main"], { cwd: root });
  const origin = await runGit(root, ["remote", "get-url", "origin"]).catch(() => undefined);
  if (origin === undefined) {
    await runGit(root, ["remote", "add", "origin", originRoot]);
  }
};

const normalizeWsUrl = (value: string): string => {
  const url = new URL(value);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  return url.toString();
};

const wsProtocolLayer = (wsUrl: string) =>
  RpcClient.layerProtocolSocket().pipe(
    Layer.provide(
      Socket.layerWebSocket(normalizeWsUrl(wsUrl)).pipe(
        Layer.provide(Socket.layerWebSocketConstructorGlobal),
      ),
    ),
    Layer.provide(RpcSerialization.layerJson),
  );

const makeRpcClient = RpcClient.make(WsRpcGroup);
type LocalRpcClient =
  typeof makeRpcClient extends Effect.Effect<infer Client, infer _Error, infer _Requirements>
    ? Client
    : never;

export const runRpc = async <A, E>(
  wsUrl: string,
  token: string | undefined,
  operation: (client: LocalRpcClient) => Effect.Effect<A, E>,
): Promise<A> => {
  const resolvedWsUrl =
    token === undefined
      ? wsUrl
      : await (async () => {
          const base = new URL(wsUrl);
          base.protocol = base.protocol === "wss:" ? "https:" : "http:";
          base.pathname = "/api/auth/websocket-ticket";
          base.search = "";
          base.hash = "";
          const response = await fetch(base, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
          });
          if (!response.ok) {
            throw new Error(`Unable to issue a WebSocket ticket (${response.status}).`);
          }
          const body: unknown = await response.json();
          if (
            typeof body !== "object" ||
            body === null ||
            !("ticket" in body) ||
            typeof body.ticket !== "string" ||
            body.ticket.length === 0
          ) {
            throw new Error("The WebSocket ticket response did not include a ticket.");
          }
          const socket = new URL(wsUrl);
          socket.searchParams.set("wsTicket", body.ticket);
          socket.hash = "";
          return socket.toString();
        })();
  return Effect.runPromise(
    makeRpcClient.pipe(
      Effect.flatMap(operation),
      Effect.scoped,
      Effect.provide(wsProtocolLayer(resolvedWsUrl)),
      Effect.timeout("60 seconds"),
    ),
  );
};

export const dispatch = (client: LocalRpcClient, command: ClientOrchestrationCommand) =>
  Effect.gen(function* () {
    const receipt = yield* client[ORCHESTRATION_WS_METHODS.dispatchCommand](command);
    yield* client[ORCHESTRATION_WS_METHODS.subscribeShell]({
      afterSequence: Math.max(0, receipt.sequence - 1),
    }).pipe(
      Stream.filter((item) => "sequence" in item && item.sequence >= receipt.sequence),
      Stream.take(1),
      Stream.runDrain,
    );
    return receipt;
  });

export const readShellSnapshot = async (
  wsUrl: string,
  token: string | undefined,
): Promise<OrchestrationShellSnapshot> => {
  const items = await runRpc(wsUrl, token, (client) =>
    client[ORCHESTRATION_WS_METHODS.subscribeShell]({
      requestCompletionMarker: true,
    }).pipe(Stream.take(1), Stream.runCollect),
  );
  const snapshot = items.find((item) => item.kind === "snapshot");
  if (snapshot?.kind !== "snapshot") {
    throw new Error("The Workbench demo seed did not receive a native project snapshot.");
  }
  return snapshot.snapshot;
};

const waitForAssignment = async (
  wsUrl: string,
  token: string | undefined,
  input: WorkbenchCreateAssignmentInput,
): Promise<void> => {
  await runRpc(wsUrl, token, (client) =>
    client[WORKBENCH_WS_METHODS.workbenchCreateAssignment](input),
  );
};

const seedWorkbench = async (
  options: Required<Pick<LocalDemoOptions, "home">> & {
    readonly wsUrl: string;
    readonly token?: string | undefined;
    readonly now: () => string;
    readonly prepareWorkspaces: boolean;
    readonly modelSelection: ModelSelection;
  },
): Promise<void> => {
  const existing = await runRpc(options.wsUrl, options.token, (client) =>
    client[WORKBENCH_WS_METHODS.workbenchGetSnapshot]({}),
  );
  const shell = await readShellSnapshot(options.wsUrl, options.token);
  const t3ProjectIds = new Set(shell.projects.map((project) => project.id));
  const timestamp = options.now();

  for (const repository of LOCAL_DEMO_REPOSITORIES) {
    if (t3ProjectIds.has(ProjectId.make(repository.id))) continue;
    await runRpc(options.wsUrl, options.token, (client) =>
      dispatch(client, {
        type: "project.create",
        commandId: CommandId.make(`workbench-demo-project-${repository.id}`),
        projectId: ProjectId.make(repository.id),
        title: repository.title,
        workspaceRoot: NodePath.join(options.home, "projects", repository.id),
        createWorkspaceRootIfMissing: false,
        createdAt: timestamp,
      }),
    );
  }
  // Project creation is event-backed. Reading a fresh shell snapshot here is
  // the completion receipt that makes linked Workbench project creation safe.
  await readShellSnapshot(options.wsUrl, options.token);

  const projectIds = new Set(existing.projects.map((project) => project.id));
  for (const project of WORKBENCH_PROJECTS) {
    if (projectIds.has(WorkbenchProjectId.make(project.id))) continue;
    await runRpc(options.wsUrl, options.token, (client) =>
      client[WORKBENCH_WS_METHODS.workbenchCreateProject]({
        id: WorkbenchProjectId.make(project.id),
        title: project.title,
        linkedProjectIds: project.repositoryIds.map((id) => ProjectId.make(id)),
        createdAt: timestamp,
      }),
    );
  }

  const afterProjects = await runRpc(options.wsUrl, options.token, (client) =>
    client[WORKBENCH_WS_METHODS.workbenchGetSnapshot]({}),
  );
  const epicIds = new Set(afterProjects.epics.map((epic) => epic.id));
  for (const epic of EPICS) {
    if (epicIds.has(WorkbenchEpicId.make(epic.id))) continue;
    await runRpc(options.wsUrl, options.token, (client) =>
      client[WORKBENCH_WS_METHODS.workbenchCreateEpic]({
        id: WorkbenchEpicId.make(epic.id),
        projectId: WorkbenchProjectId.make(epic.projectId),
        title: epic.title,
        markdown: `## Goal\n\n${epic.title} for the ${epic.projectId} demo workspace.`,
        createdAt: timestamp,
      }),
    );
  }

  const afterEpics = await runRpc(options.wsUrl, options.token, (client) =>
    client[WORKBENCH_WS_METHODS.workbenchGetSnapshot]({}),
  );
  const ticketById = new Map(afterEpics.tickets.map((ticket) => [ticket.id, ticket]));
  for (const fixture of TICKETS) {
    const ticketId = WorkbenchTicketId.make(fixture.id);
    if (ticketById.has(ticketId)) continue;
    const criteria = [
      "Keep the happy path clear.",
      "Preserve the existing public behavior.",
      "Cover the failure path.",
    ];
    await runRpc(options.wsUrl, options.token, (client) =>
      client[WORKBENCH_WS_METHODS.workbenchCreateTicket]({
        id: WorkbenchTicketId.make(ticketId),
        projectId: WorkbenchProjectId.make(fixture.projectId),
        epicId: fixture.epicId === null ? null : WorkbenchEpicId.make(fixture.epicId),
        title: fixture.title,
        kind: fixture.kind ?? "story",
        markdown: `## Goal\n\n${fixture.title} so the next step is clear and reliable.\n\n## Acceptance criteria\n\n${criteria.map((item) => `- [ ] ${item}`).join("\n")}`,
        primaryT3ProjectId: ProjectId.make(fixture.primaryProjectId),
        repositoryProjectIds: (fixture.repositoryProjectIds ?? [fixture.primaryProjectId]).map(
          (id) => ProjectId.make(id),
        ),
        createdAt: timestamp,
      }),
    );
  }

  const afterTickets = await runRpc(options.wsUrl, options.token, (client) =>
    client[WORKBENCH_WS_METHODS.workbenchGetSnapshot]({}),
  );
  const ticketState = new Map(afterTickets.tickets.map((ticket) => [ticket.id, ticket]));
  for (const fixture of TICKETS) {
    const ticketId = WorkbenchTicketId.make(fixture.id);
    const ticket = ticketState.get(ticketId);
    if (ticket === undefined || ticket.status === fixture.status || ticketById.has(ticketId))
      continue;
    await runRpc(options.wsUrl, options.token, (client) =>
      client[WORKBENCH_WS_METHODS.workbenchUpdateTicket]({
        id: WorkbenchTicketId.make(ticket.id),
        expectedRevision: ticket.revision,
        status: fixture.status,
        updatedAt: timestamp,
      }),
    );
  }

  const afterStatuses = await runRpc(options.wsUrl, options.token, (client) =>
    client[WORKBENCH_WS_METHODS.workbenchGetSnapshot]({}),
  );
  for (const fixture of TICKETS) {
    if (!fixture.archived) continue;
    const archivedTicket = afterStatuses.tickets.find((ticket) => ticket.id === fixture.id);
    if (
      archivedTicket === undefined ||
      archivedTicket.archivedAt !== null ||
      ticketById.has(archivedTicket.id)
    )
      continue;
    await runRpc(options.wsUrl, options.token, (client) =>
      client[WORKBENCH_WS_METHODS.workbenchArchiveTicket]({
        ticketId: WorkbenchTicketId.make(archivedTicket.id),
        expectedRevision: archivedTicket.revision,
        archivedAt: timestamp,
        updatedAt: timestamp,
      }),
    );
  }

  const shellAfterProjects = await readShellSnapshot(options.wsUrl, options.token);
  for (const thread of ASSIGNED_THREADS) {
    const threadId = ThreadId.make(thread.id);
    if (shellAfterProjects.threads.some((candidate) => candidate.id === thread.id)) continue;
    const source = NodePath.join(options.home, "projects", thread.projectId);
    const worktreePath = NodePath.join(options.home, "worktrees", "demo", thread.id);
    const branch = `demo/${thread.id}`;
    if (!(await pathExists(worktreePath))) {
      await NodeFSP.mkdir(NodePath.dirname(worktreePath), { recursive: true });
      const branchExists = await runGit(source, [
        "show-ref",
        "--verify",
        `refs/heads/${branch}`,
      ]).then(
        () => true,
        () => false,
      );
      await runGit(
        source,
        branchExists
          ? ["worktree", "add", worktreePath, branch]
          : ["worktree", "add", "-b", branch, worktreePath, "HEAD"],
      );
    }
    await runRpc(options.wsUrl, options.token, (client) =>
      dispatch(client, {
        type: "thread.create",
        commandId: CommandId.make(`workbench-demo-thread-${thread.id}`),
        threadId,
        projectId: ProjectId.make(thread.projectId),
        title: thread.title,
        modelSelection: options.modelSelection,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch,
        worktreePath,
        createdAt: timestamp,
      }),
    );
  }

  const assignmentSnapshot = await runRpc(options.wsUrl, options.token, (client) =>
    client[WORKBENCH_WS_METHODS.workbenchGetSnapshot]({}),
  );
  const assignedTicketIds = new Set(
    assignmentSnapshot.assignments.map((assignment) => assignment.ticketId),
  );
  for (const thread of ASSIGNED_THREADS) {
    const ticketId = WorkbenchTicketId.make(thread.ticketId);
    if (assignedTicketIds.has(ticketId)) continue;
    await waitForAssignment(options.wsUrl, options.token, {
      id: WorkbenchAssignmentId.make(`workbench-demo-${ticketId}-assignment`),
      ticketId,
      threadId: ThreadId.make(thread.id),
      createdAt: timestamp,
    });
  }

  if (options.prepareWorkspaces) {
    const ready = await runRpc(options.wsUrl, options.token, (client) =>
      client[WORKBENCH_WS_METHODS.workbenchGetSnapshot]({}),
    );
    for (const thread of ASSIGNED_THREADS) {
      const ticketId = WorkbenchTicketId.make(thread.ticketId);
      const workspace = ready.ticketWorkspaces.find((candidate) => candidate.ticketId === ticketId);
      if (workspace?.status === "ready") continue;
      await runRpc(options.wsUrl, options.token, (client) =>
        client[WORKBENCH_WS_METHODS.workbenchPrepareTicketWorkspace]({
          ticketId,
          requestedAt: timestamp,
        }),
      );
    }
  }
};

export const setupLocal = async (options: LocalDemoOptions): Promise<LocalDemoManifest> => {
  const home = NodePath.resolve(options.home);
  const now = options.now ?? isoNow;
  const prepareWorkspaces = options.prepareWorkspaces ?? false;
  await NodeFSP.mkdir(NodePath.join(home, "projects"), { recursive: true });
  for (const repository of LOCAL_DEMO_REPOSITORIES) {
    const repositoryPath = NodePath.join(home, "projects", repository.id);
    const existed = await pathExists(repositoryPath);
    const commit = options.repositoryCommits?.[repository.id];
    if (commit && (!/^[a-f0-9]{40}$/.test(commit) || !options.repositoryRemotes?.[repository.id])) {
      throw new Error("Pinned demo commits require a remote and a full Git SHA.");
    }
    await ensureRepository(repositoryPath, repository, options.repositoryRemotes?.[repository.id]);
    if (commit) {
      if (!existed) {
        await runGit(repositoryPath, ["checkout", "-B", "main", commit]);
      } else if ((await runGit(repositoryPath, ["rev-parse", "HEAD"])) !== commit) {
        throw new Error(
          `Demo checkout ${repository.id} differs from its pinned commit. Reset the demo baseline first.`,
        );
      }
    }
    if (
      options.localOriginDirectory !== undefined &&
      options.repositoryRemotes?.[repository.id] === undefined
    ) {
      await ensureLocalOrigin({
        root: repositoryPath,
        repositoryId: repository.id,
        originDirectory: options.localOriginDirectory,
      });
    }
  }
  if (options.wsUrl !== undefined) {
    await seedWorkbench({
      home,
      wsUrl: options.wsUrl,
      token: options.token,
      now,
      prepareWorkspaces,
      modelSelection: options.modelSelection ?? (await readDemoModelSelection(home)),
    });
  }
  const manifest: LocalDemoManifest = {
    version: DEMO_VERSION,
    home,
    projects: LOCAL_DEMO_REPOSITORIES.map((repository) => ({
      id: repository.id,
      path: NodePath.join(home, "projects", repository.id),
    })),
    workbenchProjects: WORKBENCH_PROJECTS.map((project) => project.id),
    epics: EPICS.map((epic) => epic.id),
    tickets: TICKETS.map((ticket) => ticket.id),
    assignedThreads: ASSIGNED_THREADS.map((thread) => thread.id),
  };
  await NodeFSP.writeFile(manifestPath(home), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
  });
  return manifest;
};

const decodeLocalManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      version: Schema.Number,
      home: Schema.String,
      projects: Schema.Array(Schema.Struct({ id: Schema.String, path: Schema.String })),
      workbenchProjects: Schema.Array(Schema.String),
      epics: Schema.Array(Schema.String),
      tickets: Schema.Array(Schema.String),
      assignedThreads: Schema.Array(Schema.String),
    }),
  ),
);

export const verifyLocal = async (
  options: Pick<LocalDemoOptions, "home" | "wsUrl" | "token">,
): Promise<LocalDemoVerification> => {
  const home = NodePath.resolve(options.home);
  const manifest = decodeLocalManifest(await NodeFSP.readFile(manifestPath(home), "utf8"));
  if (
    manifest.version !== DEMO_VERSION ||
    manifest.home !== home ||
    manifest.projects.length !== LOCAL_DEMO_REPOSITORIES.length ||
    manifest.projects.some(
      (project) =>
        !LOCAL_DEMO_REPOSITORIES.some((repo) => repo.id === project.id) ||
        project.path !== NodePath.join(home, "projects", project.id),
    )
  ) {
    throw new Error("Demo manifest does not match this home and fixture version.");
  }
  const repositoryHeadCount = await Promise.all(
    manifest.projects.map(async (project) =>
      runGit(project.path, ["rev-parse", "--verify", "HEAD"]).then(
        () => 1,
        () => 0,
      ),
    ),
  ).then((counts) => counts.reduce((total, count) => total + count, 0));
  if (repositoryHeadCount !== LOCAL_DEMO_REPOSITORIES.length)
    throw new Error("One or more demo Git repositories has no valid HEAD.");
  let workbench: LocalDemoVerification["workbench"];
  if (options.wsUrl !== undefined) {
    const snapshot = await runRpc(options.wsUrl, options.token, (client) =>
      client[WORKBENCH_WS_METHODS.workbenchGetSnapshot]({}),
    );
    for (const [label, expected, actual] of [
      ["workspaces", WORKBENCH_PROJECTS.map((p) => p.id), snapshot.projects.map((p) => p.id)],
      ["epics", EPICS.map((p) => p.id), snapshot.epics.map((p) => p.id)],
      ["tickets", TICKETS.map((ticket) => ticket.id), snapshot.tickets.map((p) => p.id)],
      [
        "assignments",
        ASSIGNED_THREADS.map((p) => p.id),
        snapshot.assignments.map((p) => p.threadId),
      ],
    ] as const) {
      const missing = expected.filter((id) => !actual.some((actualId) => actualId === id));
      if (missing.length) throw new Error(`Missing demo ${label}: ${missing.join(", ")}`);
    }
    for (const fixture of TICKETS) {
      const ticket = snapshot.tickets.find((item) => item.id === fixture.id);
      if (
        ticket === undefined ||
        ticket.status !== fixture.status ||
        Boolean(ticket.archivedAt) !== Boolean(fixture.archived)
      )
        throw new Error(
          `Demo ticket state has changed: ${fixture.id}; reset locally to restore the scenario.`,
        );
    }
    if (
      !snapshot.tickets.some((item) => item.id === "orbit-004" && item.epicId === null) ||
      !snapshot.tickets.some(
        (item) => item.id === "orbit-001" && item.repositoryProjectIds.length === 2,
      )
    )
      throw new Error("Ungrouped or multi-repository demo fixture is missing.");
    const shell = await readShellSnapshot(options.wsUrl, options.token);
    for (const thread of ASSIGNED_THREADS) {
      const found = shell.threads.find((candidate) => candidate.id === thread.id);
      if (!found?.worktreePath || !(await pathExists(found.worktreePath)))
        throw new Error(`Missing native Thread worktree: ${thread.id}`);
      await runGit(found.worktreePath, ["rev-parse", "--verify", "HEAD"]);
    }
    workbench = {
      projects: snapshot.projects,
      epics: snapshot.epics,
      tickets: snapshot.tickets,
      assignments: snapshot.assignments,
    };
  }
  const result = {
    manifest,
    repositoryCount: manifest.projects.length,
    repositoryHeadCount,
    expectedWorkbenchCounts: {
      projects: WORKBENCH_PROJECTS.length,
      epics: EPICS.length,
      tickets: TICKETS.length,
      assignments: ASSIGNED_THREADS.length,
    },
  };
  return workbench === undefined ? result : { ...result, workbench };
};
