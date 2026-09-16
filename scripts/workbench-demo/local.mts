// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalFetch:off - This host-side fixture creates an isolated local T3 environment.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { CommandId, ProjectId, ThreadId } from "../../packages/contracts/src/baseSchemas.ts";
import { ProviderInstanceId } from "../../packages/contracts/src/providerInstance.ts";
import {
  DEFAULT_RUNTIME_MODE,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ORCHESTRATION_WS_METHODS,
  type OrchestrationShellSnapshot,
  type ClientOrchestrationCommand,
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

const TICKETS = [
  ["orbit", "orbit-onboarding", "Create the welcome checklist", "orbit-web", "in_progress"],
  ["orbit", "orbit-onboarding", "Save onboarding progress", "orbit-api", "todo"],
  ["orbit", "orbit-onboarding", "Add helpful empty states", "orbit-web", "done"],
  ["orbit", "orbit-onboarding", "Fix focus after creating a project", "orbit-web", "todo"],
  ["orbit", "orbit-teams", "Invite teammates by email", "orbit-web", "in_progress"],
  ["orbit", "orbit-teams", "Expire unused invitation links", "orbit-api", "todo"],
  ["orbit", "orbit-teams", "Add a team settings page", "orbit-web", "todo"],
  ["orbit", "orbit-teams", "Validate invitation addresses", "orbit-api", "done"],
  ["beacon", "beacon-first", "Build an interactive setup command", "beacon-cli", "in_progress"],
  ["beacon", "beacon-first", "Write the five-minute quickstart", "beacon-docs", "todo"],
  ["beacon", "beacon-first", "Make CLI errors actionable", "beacon-cli", "done"],
  ["beacon", "beacon-first", "Document configuration examples", "beacon-docs", "todo"],
  ["beacon", "beacon-reliable", "Retry temporary connection failures", "beacon-cli", "todo"],
  ["beacon", "beacon-reliable", "Add structured JSON output", "beacon-cli", "in_progress"],
  ["beacon", "beacon-reliable", "Explain exit codes for CI", "beacon-docs", "done"],
  ["beacon", "beacon-reliable", "Retire the old configuration example", "beacon-docs", "done"],
] as const satisfies ReadonlyArray<readonly [string, string, string, string, TicketStatus]>;

const ASSIGNED_THREADS = [
  {
    ticketIndex: 0,
    projectId: "orbit-web",
    id: "orbit-001-thread",
    title: "Create the welcome checklist",
  },
  {
    ticketIndex: 4,
    projectId: "orbit-web",
    id: "orbit-005-thread",
    title: "Invite teammates by email",
  },
  {
    ticketIndex: 8,
    projectId: "beacon-cli",
    id: "beacon-009-thread",
    title: "Build an interactive setup command",
  },
  {
    ticketIndex: 13,
    projectId: "beacon-cli",
    id: "beacon-014-thread",
    title: "Add structured JSON output",
  },
] as const;

export interface LocalDemoOptions {
  readonly home: string;
  /** Local server WebSocket URL. Omit to prepare only local Git repositories. */
  readonly wsUrl?: string;
  /** Optional bearer token used to mint a fresh one-time WebSocket ticket per RPC socket. */
  readonly token?: string | undefined;
  /** Explicit remote URLs supplied by GitHub provisioning or reuse mode. */
  readonly repositoryRemotes?: Readonly<Record<string, string>>;
  /** Immutable commits for freshly cloned remote fixtures. Existing checkouts must already match. */
  readonly repositoryCommits?: Readonly<Record<string, string>>;
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
  for (const [index, [projectId, epicId, title, primaryProjectId]] of TICKETS.entries()) {
    const ticketId = WorkbenchTicketId.make(`${projectId}-${String(index + 1).padStart(3, "0")}`);
    if (ticketById.has(ticketId)) continue;
    const criteria = [
      "Keep the happy path clear.",
      "Preserve the existing public behavior.",
      "Cover the failure path.",
    ];
    await runRpc(options.wsUrl, options.token, (client) =>
      client[WORKBENCH_WS_METHODS.workbenchCreateTicket]({
        id: WorkbenchTicketId.make(ticketId),
        projectId: WorkbenchProjectId.make(projectId),
        epicId: index === 3 ? null : WorkbenchEpicId.make(epicId),
        title,
        kind: title.startsWith("Fix ") ? "bug" : "story",
        markdown: `## Goal\n\n${title} so the next step is clear and reliable.\n\n## Acceptance criteria\n\n${criteria.map((item) => `- [ ] ${item}`).join("\n")}`,
        primaryT3ProjectId: ProjectId.make(primaryProjectId),
        repositoryProjectIds:
          index === 0
            ? [ProjectId.make("orbit-web"), ProjectId.make("orbit-api")]
            : [ProjectId.make(primaryProjectId)],
        createdAt: timestamp,
      }),
    );
  }

  const afterTickets = await runRpc(options.wsUrl, options.token, (client) =>
    client[WORKBENCH_WS_METHODS.workbenchGetSnapshot]({}),
  );
  const ticketState = new Map(afterTickets.tickets.map((ticket) => [ticket.id, ticket]));
  for (const [index, [, , , , status]] of TICKETS.entries()) {
    const ticketId = WorkbenchTicketId.make(
      `${TICKETS[index]![0]}-${String(index + 1).padStart(3, "0")}`,
    );
    const ticket = ticketState.get(ticketId);
    if (ticket === undefined || ticket.status === status || ticketById.has(ticketId)) continue;
    await runRpc(options.wsUrl, options.token, (client) =>
      client[WORKBENCH_WS_METHODS.workbenchUpdateTicket]({
        id: WorkbenchTicketId.make(ticket.id),
        expectedRevision: ticket.revision,
        status,
        updatedAt: timestamp,
      }),
    );
  }

  const afterStatuses = await runRpc(options.wsUrl, options.token, (client) =>
    client[WORKBENCH_WS_METHODS.workbenchGetSnapshot]({}),
  );
  const archivedTicket = afterStatuses.tickets.find(
    (ticket) => ticket.id === WorkbenchTicketId.make("beacon-016"),
  );
  if (
    archivedTicket !== undefined &&
    archivedTicket.archivedAt === null &&
    !ticketById.has(archivedTicket.id)
  ) {
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
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
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
    const ticketId = WorkbenchTicketId.make(
      `${TICKETS[thread.ticketIndex]![0]}-${String(thread.ticketIndex + 1).padStart(3, "0")}`,
    );
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
      const ticketId = WorkbenchTicketId.make(
        `${TICKETS[thread.ticketIndex]![0]}-${String(thread.ticketIndex + 1).padStart(3, "0")}`,
      );
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
  }
  if (options.wsUrl !== undefined) {
    await seedWorkbench({
      home,
      wsUrl: options.wsUrl,
      token: options.token,
      now,
      prepareWorkspaces,
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
    tickets: TICKETS.map(
      ([projectId], index) => `${projectId}-${String(index + 1).padStart(3, "0")}`,
    ),
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
    manifest.projects.length !== 4 ||
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
  if (repositoryHeadCount !== 4)
    throw new Error("One or more demo Git repositories has no valid HEAD.");
  let workbench: LocalDemoVerification["workbench"];
  if (options.wsUrl !== undefined) {
    const snapshot = await runRpc(options.wsUrl, options.token, (client) =>
      client[WORKBENCH_WS_METHODS.workbenchGetSnapshot]({}),
    );
    for (const [label, expected, actual] of [
      ["workspaces", WORKBENCH_PROJECTS.map((p) => p.id), snapshot.projects.map((p) => p.id)],
      ["epics", EPICS.map((p) => p.id), snapshot.epics.map((p) => p.id)],
      [
        "tickets",
        TICKETS.map(([p], index) => `${p}-${String(index + 1).padStart(3, "0")}`),
        snapshot.tickets.map((p) => p.id),
      ],
      [
        "assignments",
        ASSIGNED_THREADS.map((p) => p.id),
        snapshot.assignments.map((p) => p.threadId),
      ],
    ] as const) {
      const missing = expected.filter((id) => !actual.some((actualId) => actualId === id));
      if (missing.length) throw new Error(`Missing demo ${label}: ${missing.join(", ")}`);
    }
    for (const [index, [projectId, , , , status]] of TICKETS.entries()) {
      const id = `${projectId}-${String(index + 1).padStart(3, "0")}`;
      const ticket = snapshot.tickets.find((item) => item.id === id);
      if (ticket?.status !== status || (id === "beacon-016" && !ticket.archivedAt))
        throw new Error(
          `Demo ticket state has changed: ${id}; reset locally to restore the scenario.`,
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
    expectedWorkbenchCounts: { projects: 2, epics: 4, tickets: 16, assignments: 4 },
  };
  return workbench === undefined ? result : { ...result, workbench };
};
