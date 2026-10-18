import { expect } from "vite-plus/test";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import { it as effectIt } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as TestClock from "effect/testing/TestClock";
import * as ServerConfig from "../config.ts";
import * as GitManager from "../git/GitManager.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as Settings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as WorkbenchWorktreeOwnership from "./worktreeOwnership.ts";
import { seedNativeThread } from "./testing/nativeThreads.ts";
import * as StorageCleanup from "../storageCleanup.ts";
import { ServerActivation } from "../serverActivation.ts";

const NOW_MS = Date.parse("2026-06-10T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;

function at(offsetMs: number): DateTime.Utc {
  return DateTime.makeUnsafe(NOW_MS + offsetMs);
}

function shell(overrides: Partial<OrchestrationV2ThreadShell> = {}): OrchestrationV2ThreadShell {
  return {
    id: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: {
      rootThreadId: ThreadId.make("thread-1"),
      parentThreadId: null,
      relationshipToParent: null,
    },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    lastVisitedAt: null,
    deletedAt: null,
    branch: null,
    linkedPullRequest: null,
    status: "idle",
    activityRunStatus: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    latestUserMessageAt: null,
    createdAt: at(-30 * DAY_MS),
    updatedAt: at(-10 * DAY_MS),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

const encodeCleanupThread = Schema.encodeEffect(Schema.fromJsonString(OrchestrationV2AppThread));
const cleanupConfigLayer = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "workbench-cleanup-" });
    const canonicalDirectory = yield* fs.realPath(directory);
    return ServerConfig.layerTest("/fixture/repository", canonicalDirectory);
  }),
);
const cleanupTestLayer = Layer.mergeAll(SqlitePersistence.layerMemory, cleanupConfigLayer).pipe(
  Layer.provideMerge(NodeServices.layer),
);

const cleanupCases = (["idle", "deleted"] as const).flatMap((lifecycle) =>
  (["default", "custom", "symlinked", "overlapping"] as const).flatMap((directory) =>
    (["automatic", "manual"] as const).map((trigger) => ({ lifecycle, directory, trigger })),
  ),
);
for (const { lifecycle, directory, trigger } of cleanupCases) {
  effectIt.effect.skipIf(directory === "symlinked" && !symlinksSupported)(
    `retains ${lifecycle} Ticket worktrees and removes a native prefix lookalike (${directory} directory, ${trigger})`,
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW_MS);
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* ServerConfig.ServerConfig;
        const sql = yield* SqlClient.SqlClient;
        const managedRoot =
          directory === "default" || directory === "overlapping"
            ? config.worktreesDir
            : path.join(config.baseDir, "custom-worktrees");
        yield* fs.makeDirectory(managedRoot, { recursive: true });
        const linkedRoot = path.join(config.baseDir, "linked-worktrees");
        if (directory === "symlinked") yield* fs.symlink(managedRoot, linkedRoot);
        const worktreesDirectory =
          directory === "symlinked"
            ? linkedRoot
            : directory === "overlapping"
              ? path.join(managedRoot, "workbench")
              : directory === "custom"
                ? managedRoot
                : "";
        const threadRoot = directory === "symlinked" ? linkedRoot : managedRoot;
        const namespace = path.join(threadRoot, "workbench");
        const ticketPath = path.join(namespace, "ticket", "primary");
        const nativePath = path.join(threadRoot, "workbench-legacy", "feature");
        const threads = [namespace, ticketPath, nativePath].map((worktreePath, index) =>
          shell({
            id: ThreadId.make(`storage-${lifecycle}-${index}`),
            worktreePath,
            branch: "feature",
            deletedAt: lifecycle === "deleted" ? at(0) : null,
          }),
        );
        for (const thread of threads) {
          yield* fs.makeDirectory(thread.worktreePath!, { recursive: true });
          yield* fs.writeFileString(
            path.join(thread.worktreePath!, ".git"),
            "gitdir: /fixture/admin",
          );
        }
        yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-1', 'Fixture', ${config.baseDir}, '[]', ${DateTime.formatIso(at(-30 * DAY_MS))},
          ${DateTime.formatIso(at(-30 * DAY_MS))}, NULL
        )
      `;
        if (lifecycle === "deleted") {
          for (const thread of threads) {
            yield* seedNativeThread({
              threadId: thread.id,
              projectId: thread.projectId,
              createdAt: DateTime.formatIso(thread.createdAt),
              worktreePath: thread.worktreePath,
              deletedAt: DateTime.formatIso(thread.deletedAt!),
            });
            const payload = yield* encodeCleanupThread({ ...thread, lastVisitedAt: null });
            yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json = ${payload}
            WHERE thread_id = ${thread.id}`;
          }
        }
        const snapshotRead = yield* Deferred.make<void>();
        const removals: string[] = [];
        const context = yield* Layer.build(
          StorageCleanup.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                WorkbenchWorktreeOwnership.layer,
                Settings.layerTest({
                  worktreesDirectory,
                  worktreeCleanup: {
                    mode: "custom",
                    rules: {
                      worktreeAfterDays: lifecycle === "idle" ? 8 : null,
                      worktreeOnDelete: lifecycle === "deleted",
                      worktreeOnMerge: false,
                      worktreeUnchanged: false,
                    },
                  },
                  storageCleanup: { browserArtifactsAfterDays: null, logsAfterDays: null },
                }),
                ProjectStore.layer,
                Layer.mock(ProjectionStore.ProjectionStoreV2)({
                  getThreadWorktreePaths: () =>
                    Effect.succeed(
                      lifecycle === "deleted"
                        ? []
                        : threads.map((thread) => ({
                            threadId: thread.id,
                            worktreePath: thread.worktreePath!,
                          })),
                    ),
                  getThreadShell: (threadId) =>
                    Effect.succeed(threads.find((thread) => thread.id === threadId) ?? null),
                  getShellSnapshot: (options) =>
                    Deferred.succeed(snapshotRead, undefined).pipe(
                      Effect.as({
                        schemaVersion: 1,
                        snapshotSequence: 0,
                        archivedThreads: [],
                        threads:
                          lifecycle === "idle" && options?.location !== "archive" ? threads : [],
                      }),
                    ),
                }),
                Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
                  isLive: () => Effect.succeed(false),
                }),
                Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents: Stream.empty }),
                Layer.mock(GitManager.GitManager)({ invalidateStatus: () => Effect.void }),
                Layer.mock(GitVcsDriver.GitVcsDriver)({
                  statusDetailsLocal: () =>
                    Effect.succeed({
                      isRepo: true,
                      hasOriginRemote: false,
                      isDefaultBranch: false,
                      branch: "feature",
                      upstreamRef: null,
                      hasWorkingTreeChanges: false,
                      workingTree: { files: [], insertions: 0, deletions: 0 },
                      hasUpstream: false,
                      aheadCount: 0,
                      behindCount: 0,
                      aheadOfDefaultCount: 0,
                    }),
                  resolveCommit: () => Effect.succeed({ commitSha: "a".repeat(40) }),
                  execute: (input) =>
                    Effect.gen(function* () {
                      if (input.args[2] === "worktree" && input.args[3] === "remove") {
                        const worktreePath = input.args[input.args.indexOf("--") + 1]!;
                        expect(input.args).toEqual([
                          "-c",
                          "status.showUntrackedFiles=normal",
                          "worktree",
                          "remove",
                          "--",
                          worktreePath,
                        ]);
                        removals.push(worktreePath);
                        yield* fs.remove(worktreePath, { recursive: true }).pipe(Effect.orDie);
                      }
                      return {
                        exitCode: ChildProcessSpawner.ExitCode(0),
                        stdout:
                          input.args[0] === "symbolic-ref"
                            ? "refs/heads/feature\n"
                            : input.args[0] === "rev-parse"
                              ? `${path.join(config.baseDir, "fixture-index")}\n`
                              : "",
                        stderr: "",
                        stdoutTruncated: false,
                        stderrTruncated: false,
                      };
                    }),
                }),
                Layer.mock(TerminalManager.TerminalManager)({
                  subscribeMetadata: (listener) =>
                    listener({ type: "snapshot", terminals: [] }).pipe(Effect.as(() => {})),
                }),
              ),
            ),
          ),
        ).pipe(
          Effect.provideService(ServerActivation, trigger === "manual" ? Effect.never : undefined),
        );
        const cleanup = Context.get(context, StorageCleanup.StorageCleanup);
        const report =
          trigger === "manual"
            ? yield* cleanup.runNow
            : yield* Deferred.await(snapshotRead).pipe(
                Effect.andThen(cleanup.drain),
                Effect.andThen(cleanup.latestReport),
              );
        expect(report?.trigger).toBe(trigger);
        expect(report?.entries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ticketPath,
              outcome: "kept",
              reason: "Workspace owner manages this worktree",
            }),
            expect.objectContaining({ path: nativePath, outcome: "removed" }),
          ]),
        );
        expect(yield* fs.exists(namespace)).toBe(true);
        expect(yield* fs.exists(ticketPath)).toBe(true);
        expect(yield* fs.exists(nativePath)).toBe(false);
        expect(removals).toEqual([nativePath]);
      }).pipe(Effect.provide(cleanupTestLayer), Effect.scoped),
  );
}

for (const directory of ["default", "custom", "symlinked", "overlapping"] as const) {
  effectIt.effect.skipIf(directory === "symlinked" && !symlinksSupported)(
    `does not report unassigned Ticket workspaces as orphaned (${directory} directory)`,
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW_MS);
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* ServerConfig.ServerConfig;
        const managedRoot =
          directory === "custom" || directory === "symlinked"
            ? path.join(config.baseDir, "custom-worktrees")
            : config.worktreesDir;
        const namespace = path.join(managedRoot, "workbench");
        const ticketDirectory = path.join(namespace, "unassigned-ticket");
        const ticketPath = path.join(ticketDirectory, "primary");
        const nativePath = path.join(managedRoot, "workbench-legacy", "unassigned");
        for (const worktreePath of [ticketPath, nativePath]) {
          yield* fs.makeDirectory(worktreePath, { recursive: true });
          yield* fs.writeFileString(path.join(worktreePath, ".git"), "gitdir: /fixture/admin");
          yield* fs.utimes(worktreePath, 1, 1);
        }
        yield* fs.utimes(ticketDirectory, 1, 1);
        const linkedRoot = path.join(config.baseDir, "linked-worktrees");
        if (directory === "symlinked") yield* fs.symlink(managedRoot, linkedRoot);
        const context = yield* Layer.build(
          StorageCleanup.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                WorkbenchWorktreeOwnership.layer,
                Settings.layerTest({
                  worktreesDirectory:
                    directory === "overlapping"
                      ? namespace
                      : directory === "symlinked"
                        ? linkedRoot
                        : directory === "custom"
                          ? managedRoot
                          : "",
                  worktreeCleanup: {
                    mode: "custom",
                    rules: {
                      worktreeAfterDays: null,
                      worktreeOnDelete: true,
                      worktreeOnMerge: false,
                      worktreeUnchanged: false,
                    },
                  },
                  storageCleanup: { browserArtifactsAfterDays: null, logsAfterDays: null },
                }),
                ProjectStore.layer,
                Layer.mock(ProjectionStore.ProjectionStoreV2)({
                  getThreadWorktreePaths: () => Effect.succeed([]),
                  getShellSnapshot: () =>
                    Effect.succeed({
                      schemaVersion: 1,
                      snapshotSequence: 0,
                      archivedThreads: [],
                      threads: [],
                    }),
                }),
                Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
                  isLive: () => Effect.succeed(false),
                }),
                Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents: Stream.empty }),
                Layer.mock(GitManager.GitManager)({}),
                Layer.mock(GitVcsDriver.GitVcsDriver)({}),
                Layer.mock(TerminalManager.TerminalManager)({
                  subscribeMetadata: (listener) =>
                    listener({ type: "snapshot", terminals: [] }).pipe(Effect.as(() => {})),
                }),
              ),
            ),
          ),
        ).pipe(Effect.provideService(ServerActivation, Effect.never));
        const cleanup = Context.get(context, StorageCleanup.StorageCleanup);
        const report = yield* cleanup.runNow;
        expect(report.entries).toEqual([
          expect.objectContaining({
            path: nativePath,
            threadId: null,
            outcome: "kept",
            reason: "No thread uses this worktree",
          }),
        ]);
        expect(yield* fs.exists(ticketPath)).toBe(true);
        expect(yield* fs.exists(nativePath)).toBe(true);
      }).pipe(Effect.provide(cleanupTestLayer), Effect.scoped),
  );
}
