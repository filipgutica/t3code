import { describe, expect, it } from "vite-plus/test";
import { it as effectIt } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as TestClock from "effect/testing/TestClock";
import * as ServerConfig from "./config.ts";
import * as GitManager from "./git/GitManager.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import * as Orchestrator from "./orchestration-v2/Orchestrator.ts";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import * as Settings from "./serverSettings.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import * as WorkbenchWorktreeOwnership from "./workbench/worktreeOwnership.ts";
import { seedNativeThread } from "./workbench/testing/nativeThreads.ts";
import * as StorageCleanup from "./storageCleanup.ts";
import { storageCleanupActivityAt, storageCleanupThreadIdle } from "./storageCleanup.ts";

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

describe("V2 storage cleanup eligibility", () => {
  const candidate = () => shell({ branch: "feature", worktreePath: "/worktrees/feature" });

  it("allows an idle worktree and rejects the project checkout", () => {
    expect(storageCleanupThreadIdle(candidate(), NOW_MS)).toBe(true);
    expect(storageCleanupThreadIdle(shell(), NOW_MS)).toBe(false);
  });

  it.each(["running", "starting", "preparing", "waiting", "queued"] as const)(
    "retains a worktree while its thread is %s",
    (status) => {
      expect(storageCleanupThreadIdle(candidateWithStatus(status), NOW_MS)).toBe(false);
    },
  );

  it("retains an active run even if the shell status is idle", () => {
    expect(
      storageCleanupThreadIdle({ ...candidate(), activeRunId: RunId.make("run") }, NOW_MS),
    ).toBe(false);
  });

  it("retains a queued prompt before the new run has been projected", () => {
    expect(
      storageCleanupThreadIdle({ ...candidate(), latestUserMessageAt: at(-1_000) }, NOW_MS),
    ).toBe(false);
  });

  it("uses V2 run activity instead of metadata refreshes for retention", () => {
    const thread = candidate();
    const runTime = at(-3 * DAY_MS);
    expect(
      storageCleanupActivityAt({ ...thread, latestRunCompletedAt: runTime, updatedAt: at(0) }),
    ).toBe(DateTime.toEpochMillis(runTime));
  });

  function candidateWithStatus(status: OrchestrationV2ThreadShell["status"]) {
    return { ...candidate(), status };
  }
});

const encodeCleanupThread = Schema.encodeEffect(Schema.fromJsonString(OrchestrationV2AppThread));
const cleanupConfigLayer = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "workbench-cleanup-" });
    const canonicalDirectory = yield* fs.realPath(directory);
    return ServerConfig.layerTest("/fixture/repository", canonicalDirectory);
  }),
);
const cleanupTestLayer = Layer.mergeAll(SqlitePersistenceMemory, cleanupConfigLayer).pipe(
  Layer.provideMerge(NodeServices.layer),
);

for (const lifecycle of ["idle", "deleted"] as const) {
  effectIt.effect(
    `retains ${lifecycle} Ticket worktrees and removes a native prefix lookalike`,
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW_MS);
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* ServerConfig.ServerConfig;
        const sql = yield* SqlClient.SqlClient;
        const namespace = path.join(config.worktreesDir, "workbench");
        const ticketPath = path.join(namespace, "ticket", "primary");
        const nativePath = path.join(config.worktreesDir, "workbench-legacy", "feature");
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
        const cleanup = yield* StorageCleanup.make.pipe(
          Effect.provide(
            Layer.mergeAll(
              WorkbenchWorktreeOwnership.layer,
              Settings.layerTest({
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
              Layer.mock(ProjectStore.ProjectStoreV2)({
                listShells: () =>
                  Effect.succeed([
                    {
                      id: ProjectId.make("project-1"),
                      title: "Fixture",
                      workspaceRoot: config.baseDir,
                      defaultModelSelection: null,
                      scripts: [],
                      createdAt: DateTime.formatIso(at(-30 * DAY_MS)),
                      updatedAt: DateTime.formatIso(at(0)),
                    },
                  ]),
              }),
              Layer.mock(ProjectionStore.ProjectionStoreV2)({
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
                execute: () =>
                  Effect.succeed({
                    exitCode: ChildProcessSpawner.ExitCode(0),
                    stdout: "",
                    stderr: "",
                    stdoutTruncated: false,
                    stderrTruncated: false,
                  }),
                removeWorktree: (input) =>
                  Effect.sync(() => {
                    expect(input.force).toBe(false);
                    removals.push(input.path);
                  }).pipe(Effect.andThen(fs.remove(input.path, { recursive: true })), Effect.orDie),
              }),
              Layer.mock(TerminalManager.TerminalManager)({
                subscribeMetadata: (listener) =>
                  listener({ type: "snapshot", terminals: [] }).pipe(Effect.as(() => {})),
              }),
            ),
          ),
        );
        yield* cleanup.start();
        yield* Deferred.await(snapshotRead);
        yield* cleanup.drain;
        expect(yield* fs.exists(namespace)).toBe(true);
        expect(yield* fs.exists(ticketPath)).toBe(true);
        expect(yield* fs.exists(nativePath)).toBe(false);
        expect(removals).toEqual([nativePath]);
      }).pipe(Effect.provide(cleanupTestLayer), Effect.scoped),
  );
}
