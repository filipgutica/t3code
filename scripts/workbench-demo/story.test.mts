// @effect-diagnostics nodeBuiltinImport:off - Offline story fixtures are checked with real migrations and native projection readers.
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
import { ensureWorkbenchSchema } from "../../packages/workbench/src/WorkbenchSchema.ts";
import { setupHome } from "./environment.mts";
import { seedStoryOutcomes } from "./story.mts";

it.effect(
  "seeds native story history, an unread reply and two recaps without fabricated recap runs or provider sessions",
  () =>
    Effect.gen(function* () {
      const home = setupHome(
        yield* Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "demo-story-"))),
      );
      yield* Effect.promise(() => NodeFSP.mkdir(NodePath.join(home, "userdata")));
      const filename = NodePath.join(home, "userdata", "statev2.sqlite");
      const sqlLayer = Layer.effectDiscard(
        Effect.all([runMigrations(), ensureWorkbenchSchema], { concurrency: 1 }),
      ).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename })));
      const initial = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
      try {
        yield* Effect.gen(function* () {
          const store = yield* ProjectionStore.ProjectionStoreV2;
          for (const id of ["orbit-017-api", "orbit-017-web", "orbit-017-settings"]) {
            const threadId = ThreadId.make(id);
            const providerInstanceId = ProviderInstanceId.make(
              id === "orbit-017-web" ? "claudeAgent" : "codex",
            );
            yield* store.apply({
              id: EventId.make(id + "-create"),
              type: "thread.created",
              threadId,
              occurredAt: initial,
              payload: {
                id: threadId,
                projectId: ProjectId.make(id === "orbit-017-api" ? "orbit-api" : "orbit-web"),
                title: id,
                createdBy: "user",
                creationSource: "server",
                providerInstanceId,
                modelSelection: { instanceId: providerInstanceId, model: "test-model" },
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                activeProviderThreadId: null,
                lineage: {
                  parentThreadId: null,
                  relationshipToParent: null,
                  rootThreadId: threadId,
                },
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
          }
          const db = new NodeSqlite.DatabaseSync(filename);
          try {
            db.prepare(
              "INSERT INTO workbench_projects (project_id, title, created_at, updated_at) VALUES ('orbit', 'Orbit', ?, ?)",
            ).run("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
            db.prepare(`INSERT INTO workbench_tickets (ticket_id, workbench_project_id, title, markdown, primary_t3_project_id, status, blocked, created_at, updated_at)
            VALUES ('orbit-017', 'orbit', 'Invitation recovery', '', 'orbit-api', 'in_progress', 0, ?, ?)`).run(
              "2026-01-01T00:00:00Z",
              "2026-01-01T00:00:00Z",
            );
            seedStoryOutcomes(home);
            const recaps = db
              .prepare(
                "SELECT thread_id, run_id, text FROM workbench_thread_recaps ORDER BY thread_id",
              )
              .all();
            assert.equal(recaps.length, 2);
            assert.match(String(recaps[0]?.text), /^Merged 7-day expiry.*Synthetic recap/);
            assert.match(
              String(recaps[1]?.text),
              /^Web tests fail on toast timing; 1 review open.*Synthetic recap/,
            );
            for (const recap of recaps)
              assert.equal(
                db
                  .prepare(
                    "SELECT COUNT(*) AS count FROM orchestration_v2_projection_runs WHERE run_id = ?",
                  )
                  .get(String(recap.run_id))?.count,
                recap.thread_id === "orbit-017-web" ? 1 : 0,
              );
            assert.equal(
              recaps.find((recap) => recap.thread_id === "orbit-017-web")?.run_id,
              "synthetic-story-web-reply",
            );
            const summary = db
              .prepare(
                "SELECT generated_summary_status AS status, generated_summary AS text FROM workbench_tickets WHERE ticket_id = 'orbit-017'",
              )
              .get();
            assert.equal(summary?.status, "ready");
            assert.match(String(summary?.text), /Synthetic summary/);
            assert.equal(
              db.prepare("SELECT COUNT(*) AS count FROM orchestration_v2_events").get()?.count,
              0,
            );
          } finally {
            db.close();
          }
          const api = yield* store.getThreadProjection(ThreadId.make("orbit-017-api"));
          assert.deepStrictEqual(
            api.messages.map((message) => message.role),
            ["user", "assistant"],
          );
          assert.ok(
            api.messages.every((message) => message.text.includes("Synthetic demo conversation")),
          );
          assert.deepStrictEqual(api.providerSessions, []);
          const web = yield* store.getThreadShell(ThreadId.make("orbit-017-web"));
          assert.equal(web?.status, "completed");
          assert.equal(web?.latestRunId, "synthetic-story-web-reply");
          assert.equal(web?.lastVisitedAt, null);
          const pending = yield* store.getThreadProjection(ThreadId.make("orbit-017-settings"));
          assert.deepStrictEqual(pending.runs, []);
          assert.deepStrictEqual(pending.providerSessions, []);
        }).pipe(
          Effect.provide(ProjectionStore.layer.pipe(Layer.provideMerge(sqlLayer))),
          Effect.scoped,
        );
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
      }
    }),
);
