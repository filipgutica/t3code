// @effect-diagnostics nodeBuiltinImport:off - Exercises offline fixtures against real V2 migrations and projection reads.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { EventId, ProjectId, ThreadId } from "../../packages/contracts/src/baseSchemas.ts";
import { ProviderInstanceId } from "../../packages/contracts/src/providerInstance.ts";
import * as NodeSqliteClient from "../../packages/shared/src/nodeSqliteClient.ts";
import { runMigrations } from "../../apps/server/src/persistence/Migrations.ts";
import * as ProjectionStore from "../../apps/server/src/orchestration-v2/ProjectionStore.ts";
import { insertVisualMessage, seedVisualRun } from "./native-projections.mts";

it.effect(
  "reads projection-only synthetic outcomes and transcript through native V2 shell and timeline readers",
  () =>
    Effect.gen(function* () {
      const home = yield* Effect.tryPromise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-demo-v2-")),
      );
      const filename = NodePath.join(home, "statev2.sqlite");
      const threadId = ThreadId.make("synthetic-attention-feedback");
      const providerInstanceId = ProviderInstanceId.make("codex");
      const initial = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
      const completed = "2026-01-01T00:01:00.000Z";
      const sqlLayer = Layer.effectDiscard(runMigrations()).pipe(
        Layer.provideMerge(NodeSqliteClient.layer({ filename })),
      );
      const layer = ProjectionStore.layer.pipe(Layer.provideMerge(sqlLayer));
      try {
        yield* Effect.gen(function* () {
          const store = yield* ProjectionStore.ProjectionStoreV2;
          yield* store.apply({
            id: EventId.make("synthetic-create"),
            type: "thread.created",
            threadId,
            occurredAt: initial,
            payload: {
              id: threadId,
              projectId: ProjectId.make("orbit-web"),
              title: "Synthetic attention",
              createdBy: "user",
              creationSource: "server",
              providerInstanceId,
              modelSelection: { instanceId: providerInstanceId, model: "test-model" },
              runtimeMode: "full-access",
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              activeProviderThreadId: null,
              lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
              forkedFrom: null,
              createdAt: initial,
              updatedAt: initial,
              archivedAt: null,
              settledOverride: null,
              settledAt: null,
              lastVisitedAt: null,
              deletedAt: null,
            },
          });
          const db = new NodeSqlite.DatabaseSync(filename);
          try {
            seedVisualRun({
              db,
              threadId,
              runId: threadId + "-turn",
              status: "interrupted",
              timestamp: completed,
            });
            const message = {
              db,
              messageId: threadId + "-label",
              threadId,
              role: "assistant" as const,
              text: "[Synthetic waiting question] Which expiry policy should this use? No provider ran.",
              timestamp: completed,
            };
            insertVisualMessage(message);
            insertVisualMessage(message);
            assert.equal(
              db.prepare("SELECT COUNT(*) AS count FROM orchestration_v2_events").get()?.count,
              0,
            );
          } finally {
            db.close();
          }
          const shell = yield* store.getThreadShell(threadId);
          assert.equal(shell?.status, "interrupted");
          assert.equal(shell?.latestRunId, threadId + "-turn");
          assert.equal(
            shell?.latestRunCompletedAt === null || shell?.latestRunCompletedAt === undefined
              ? null
              : DateTime.formatIso(shell.latestRunCompletedAt),
            completed,
          );
          assert.equal(shell?.visibleItemCount, 2);
          const projection = yield* store.getThreadProjection(threadId);
          assert.equal(projection.messages.length, 2);
          assert.equal(projection.turnItems.length, 2);
          assert.ok(
            projection.turnItems.some(
              (item) =>
                item.type === "assistant_message" &&
                item.text.includes("Synthetic waiting question"),
            ),
          );
          assert.deepStrictEqual(projection.providerSessions, []);
          assert.equal(
            DateTime.formatIso(projection.thread.createdAt),
            DateTime.formatIso(initial),
          );
        }).pipe(Effect.provide(layer), Effect.scoped);
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
      }
    }),
);
