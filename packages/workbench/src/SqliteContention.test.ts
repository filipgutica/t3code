import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchOperationError,
  type WorkbenchJiraOperationError,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import * as Tracer from "effect/Tracer";

import { WorkbenchNativeAccess } from "./WorkbenchNativeAccess.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "./WorkbenchStore.ts";
import { JiraApi } from "./jira/JiraApi.ts";
import { JiraAuthService } from "./jira/JiraAuthService.ts";
import { JiraSyncService } from "./jira/JiraSyncService.ts";
import { JiraTicketWriteService } from "./jira/JiraTicketWriteService.ts";
import * as WorkbenchJiraService from "./jira/WorkbenchJiraService.ts";
import { WorkbenchJiraRepository, layerSql } from "./jira/WorkbenchJiraRepository.ts";

const projectId = ProjectId.make("repo");
const secondProjectId = ProjectId.make("second-repo");
const workspaceId = WorkbenchProjectId.make("workspace");
const ticketId = WorkbenchTicketId.make("draft");
const threadId = ThreadId.make("thread");
const createdAt = "2026-10-17T12:00:00.000Z";

const withStore = <A, E>({
  use,
  gitCalls = [],
  onRepositoryCheck = () => Effect.void,
}: {
  readonly use: Effect.Effect<
    A,
    E,
    WorkbenchStore | SqlClient.SqlClient | WorkbenchJiraRepository | Scope.Scope
  >;
  readonly gitCalls?: Array<boolean>;
  readonly onRepositoryCheck?: () => Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "workbench-contention-" });
    const native = Layer.effect(
      WorkbenchNativeAccess,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return WorkbenchNativeAccess.of({
          findProject: (id) =>
            sql<{ readonly id: ProjectId; readonly workspaceRoot: string }>`
            SELECT id, workspace_root AS "workspaceRoot" FROM contention_native_projects WHERE id = ${id}
          `.pipe(
              Effect.map((rows) => Option.fromUndefinedOr(rows[0])),
              Effect.orDie,
            ),
          isRepository: () =>
            Effect.serviceOption(sql.transactionService).pipe(
              Effect.map((transaction) => {
                gitCalls.push(Option.isSome(transaction));
                return true;
              }),
              Effect.tap(onRepositoryCheck),
            ),
          findThread: () => Effect.succeed(Option.none()),
          hasThreadAtWorktreePath: () => Effect.succeed(false),
          executionSequence: Effect.succeed(0),
          startedExecutionRunIds: Effect.succeed([]),
          hasPendingThreadWork: () => Effect.succeed(false),
        });
      }),
    );
    const store = WorkbenchStoreLive.pipe(Layer.provide(native), Layer.provide(NodeCrypto.layer));
    return yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA journal_mode = WAL`;
      yield* sql`CREATE TABLE contention_native_projects (id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL)`;
      yield* sql`INSERT INTO contention_native_projects (id, workspace_root)
        VALUES (${projectId}, '/repos/primary'), (${secondProjectId}, '/repos/secondary')`;
      return yield* use;
    }).pipe(
      Effect.provide(
        Layer.merge(store, layerSql).pipe(
          Layer.provideMerge(
            NodeSqliteClient.layer({ filename: `${directory}/state.sqlite`, readerWorker: true }),
          ),
        ),
      ),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const seed = Effect.gen(function* () {
  const store = yield* WorkbenchStore;
  yield* store.createProject({
    id: workspaceId,
    title: "Workspace",
    linkedProjectIds: [projectId],
    createdAt,
  });
  return yield* store.beginTicketDraft({
    id: ticketId,
    projectId: workspaceId,
    threadId,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" },
  });
});

describe("Workbench SQLite contention", () => {
  it.effect("routes independent snapshots and preparation reads to the reader", () =>
    withStore({
      use: Effect.gen(function* () {
        yield* seed;
        const store = yield* WorkbenchStore;
        const spans: Array<Tracer.NativeSpan> = [];
        const tracer = Tracer.make({
          span: (options) => {
            const span = new Tracer.NativeSpan(options);
            spans.push(span);
            return span;
          },
        });
        const jira = yield* WorkbenchJiraService.make.pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.mock(JiraApi, {}),
              Layer.mock(JiraAuthService, {}),
              Layer.mock(JiraSyncService, {}),
              Layer.mock(JiraTicketWriteService, {}),
            ),
          ),
        );
        const reads: ReadonlyArray<
          readonly [
            string,
            Effect.Effect<void, WorkbenchOperationError | WorkbenchJiraOperationError>,
          ]
        > = [
          ["snapshot", store.getSnapshot.pipe(Effect.asVoid)],
          ["preparations", store.getTicketPreparations.pipe(Effect.asVoid)],
          ["draft", store.getTicketDraftForThread(threadId).pipe(Effect.asVoid)],
          ["jira", jira.getSnapshot.pipe(Effect.asVoid)],
          ["project", store.getProject(workspaceId).pipe(Effect.asVoid)],
          ["workspace", store.getTicketWorkspace(ticketId).pipe(Effect.asVoid)],
          ["repositories", store.getTicketWorkspaceRepositoryStates(ticketId).pipe(Effect.asVoid)],
          ["summary", store.getTicketSummaryCandidate(ticketId).pipe(Effect.asVoid)],
        ];
        for (const [name, read] of reads) {
          spans.length = 0;
          yield* read.pipe(Effect.withTracer(tracer));
          const connections = spans.flatMap((span) =>
            span.attributes.has("db.connection") ? [span.attributes.get("db.connection")] : [],
          );
          expect(connections, name).toEqual(["reader"]);
        }
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`UPDATE workbench_projects SET title = 'Uncommitted' WHERE project_id = ${workspaceId}`;
            expect((yield* store.getSnapshot).projects[0]?.title).toBe("Uncommitted");
            yield* sql`DELETE FROM workbench_ticket_drafts WHERE draft_id = ${ticketId}`;
            expect(yield* store.getTicketPreparations).toEqual([]);
            expect(yield* store.getTicketDraftForThread(threadId)).toBeNull();
            yield* sql`INSERT INTO workbench_jira_connections
              (connection_id, cloud_id, site_name, site_url, avatar_url, scopes_json, credential_id, created_at, updated_at)
              VALUES ('uncommitted', 'cloud', 'Jira', 'https://example.atlassian.net', NULL, '[]', 'credential', ${createdAt}, ${createdAt})`;
            expect((yield* jira.getSnapshot).connections).toHaveLength(1);
          }),
        );
      }),
    }),
  );

  it.effect("validates Git outside draft and workspace write transactions", () => {
    const gitCalls: Array<boolean> = [];
    return withStore({
      use: Effect.gen(function* () {
        let draft = yield* seed;
        const store = yield* WorkbenchStore;
        draft = yield* store.transitionTicketDraft({
          id: draft.id,
          expectedRevision: draft.revision,
          from: ["creating"],
          phase: "draft",
        });
        draft = yield* store.updateTicketDraft({
          id: draft.id,
          expectedRevision: draft.revision,
          fields: {
            ...draft.fields,
            repositoryProjectIds: [projectId],
            primaryT3ProjectId: projectId,
          },
        });
        yield* store.transitionTicketDraft({
          id: draft.id,
          expectedRevision: draft.revision,
          from: ["draft"],
          phase: "promoting",
        });
        yield* store.updateProject({
          id: workspaceId,
          title: "Workspace",
          linkedProjectIds: [projectId, secondProjectId],
          updatedAt: createdAt,
        });
        expect(gitCalls.length).toBeGreaterThanOrEqual(4);
        expect(gitCalls).not.toContain(true);
      }),
      gitCalls,
    });
  });
  it.effect.each(["revision", "repository link"] as const)(
    "rechecks %s changes made during Git validation",
    (change) => {
      let onRepositoryCheck = Effect.void;
      return withStore({
        onRepositoryCheck: () => onRepositoryCheck,
        use: Effect.gen(function* () {
          let draft = yield* seed;
          const store = yield* WorkbenchStore;
          const sql = yield* SqlClient.SqlClient;
          draft = yield* store.transitionTicketDraft({
            id: draft.id,
            expectedRevision: draft.revision,
            from: ["creating"],
            phase: "draft",
          });
          const fields = {
            ...draft.fields,
            repositoryProjectIds: [projectId],
            primaryT3ProjectId: projectId,
          };
          onRepositoryCheck = Effect.gen(function* () {
            onRepositoryCheck = Effect.void;
            if (change === "revision") {
              yield* store.updateTicketDraft({
                id: draft.id,
                expectedRevision: draft.revision,
                fields: { ...fields, title: "Concurrent edit" },
              });
            } else {
              yield* sql`DELETE FROM workbench_project_links WHERE workbench_project_id = ${workspaceId}`;
            }
          }).pipe(Effect.orDie);
          const error = yield* store
            .updateTicketDraft({ id: draft.id, expectedRevision: draft.revision, fields })
            .pipe(Effect.flip);
          expect(error.code).toBe(
            change === "revision" ? "ticket_draft_changed" : "repository_not_linked",
          );
          const saved = yield* store.getTicketDraft(draft.id);
          expect(saved.fields.title).toBe(change === "revision" ? "Concurrent edit" : "");
        }),
      });
    },
  );
  it.effect.each(["begin", "autosave", "promotion", "workspace update"] as const)(
    "rejects a concurrent native root change during %s and permits retry",
    (operation) => {
      let onRepositoryCheck = Effect.void;
      return withStore({
        onRepositoryCheck: () => onRepositoryCheck,
        use: Effect.gen(function* () {
          let draft = yield* seed;
          const store = yield* WorkbenchStore;
          const sql = yield* SqlClient.SqlClient;
          draft = yield* store.transitionTicketDraft({
            id: draft.id,
            expectedRevision: draft.revision,
            from: ["creating"],
            phase: "draft",
          });
          draft = yield* store.updateTicketDraft({
            id: draft.id,
            expectedRevision: draft.revision,
            fields: {
              ...draft.fields,
              repositoryProjectIds: [projectId],
              primaryT3ProjectId: projectId,
            },
          });
          const action =
            operation === "begin"
              ? store
                  .beginTicketDraft({
                    id: WorkbenchTicketId.make("new-draft"),
                    projectId: workspaceId,
                    threadId: ThreadId.make("new-thread"),
                    modelSelection: draft.modelSelection,
                  })
                  .pipe(Effect.asVoid)
              : operation === "autosave"
                ? store
                    .updateTicketDraft({
                      id: draft.id,
                      expectedRevision: draft.revision,
                      fields: { ...draft.fields, title: "Updated title" },
                    })
                    .pipe(Effect.asVoid)
                : operation === "promotion"
                  ? store
                      .transitionTicketDraft({
                        id: draft.id,
                        expectedRevision: draft.revision,
                        from: ["draft"],
                        phase: "promoting",
                      })
                      .pipe(Effect.asVoid)
                  : store
                      .updateProject({
                        id: workspaceId,
                        title: "Updated workspace",
                        linkedProjectIds: [projectId, secondProjectId],
                        updatedAt: createdAt,
                      })
                      .pipe(Effect.asVoid);
          const before = yield* store.getSnapshot;
          const validating = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          onRepositoryCheck = Effect.gen(function* () {
            yield* Deferred.succeed(validating, undefined);
            yield* Deferred.await(release);
          });
          const pending = yield* action.pipe(
            Effect.match({ onFailure: (error) => error, onSuccess: () => null }),
            Effect.forkChild,
          );
          yield* Deferred.await(validating);
          const changedId = operation === "workspace update" ? secondProjectId : projectId;
          yield* sql`UPDATE contention_native_projects SET workspace_root = '/repos/replacement' WHERE id = ${changedId}`;
          onRepositoryCheck = Effect.void;
          yield* Deferred.succeed(release, undefined);
          const error = yield* Fiber.join(pending);
          expect(error?.code).toBe("project_changed");
          expect(error?.message).toContain("Retry");
          expect(yield* store.getSnapshot).toEqual(before);
          yield* action;
        }),
      });
    },
  );
});
