import {
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Stream from "effect/Stream";

import { WorkbenchNativeAccess } from "./WorkbenchNativeAccess.ts";
import { ensureWorkbenchSchema } from "./WorkbenchSchema.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "./WorkbenchStore.ts";

const nativeLayer = (options?: {
  readonly projects?: ReadonlySet<string>;
  readonly threads?: ReadonlyMap<string, string>;
}) => {
  const projects = options?.projects ?? new Set<string>();
  const threads = options?.threads ?? new Map<string, string>();
  return Layer.succeed(
    WorkbenchNativeAccess,
    WorkbenchNativeAccess.of({
      findProject: (projectId) =>
        Effect.succeed(projects.has(projectId) ? Option.some({ id: projectId }) : Option.none()),
      findThread: (threadId) => {
        const projectId = threads.get(threadId);
        return Effect.succeed(
          projectId === undefined
            ? Option.none()
            : Option.some({ id: threadId, projectId: ProjectId.make(projectId) }),
        );
      },
    }),
  );
};

const testLayer = (options?: Parameters<typeof nativeLayer>[0]) =>
  WorkbenchStoreLive.pipe(
    Layer.provideMerge(nativeLayer(options)),
    Layer.provideMerge(NodeSqliteClient.layerMemory()),
  );

const seedTicket = (input: {
  readonly store: WorkbenchStore["Service"];
  readonly projectId: ProjectId;
  readonly workspaceId: WorkbenchProjectId;
  readonly ticketId: WorkbenchTicketId;
  readonly title?: string;
  readonly markdown?: string;
  readonly createdAt?: string;
}) =>
  Effect.gen(function* () {
    const createdAt = input.createdAt ?? "2026-09-07T10:00:00.000Z";
    yield* input.store.createProject({
      id: input.workspaceId,
      title: "Summary workspace",
      linkedProjectIds: [input.projectId],
      createdAt,
    });
    return yield* input.store.createTicket({
      id: input.ticketId,
      projectId: input.workspaceId,
      title: input.title ?? "Validate requests",
      kind: "bug",
      markdown: input.markdown ?? "Reject invalid dimensions before querying the provider.",
      primaryT3ProjectId: input.projectId,
      createdAt,
    });
  });

describe("WorkbenchStore package boundary", () => {
  it.effect("atomically starts todo execution and preserves further-along statuses", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("execution-project");
      const workspaceId = WorkbenchProjectId.make("execution-workspace");
      const todoTicketId = WorkbenchTicketId.make("execution-todo-ticket");
      const doneTicketId = WorkbenchTicketId.make("execution-done-ticket");
      const todo = yield* seedTicket({
        store,
        projectId,
        workspaceId,
        ticketId: todoTicketId,
      });
      const done = yield* store.createTicket({
        id: doneTicketId,
        projectId: workspaceId,
        title: "Already done",
        kind: "story",
        markdown: "Keep the terminal status.",
        primaryT3ProjectId: projectId,
        createdAt: "2026-09-07T10:00:00.000Z",
      });
      yield* store.updateTicket({
        id: done.id,
        expectedRevision: done.revision,
        status: "done",
        updatedAt: "2026-09-07T10:01:00.000Z",
      });

      const started = yield* store.startTicketExecution({
        ticketId: todoTicketId,
        startedAt: "2026-09-07T10:02:00.000Z",
      });
      expect(started.changed).toBe(true);
      expect(started.ticket.status).toBe("in_progress");
      expect(started.ticket.revision).toBe(todo.revision + 1);

      const repeated = yield* store.startTicketExecution({
        ticketId: todoTicketId,
        startedAt: "2026-09-07T10:03:00.000Z",
      });
      expect(repeated.changed).toBe(false);
      expect(repeated.ticket.status).toBe("in_progress");
      expect(repeated.ticket.revision).toBe(started.ticket.revision);

      const preserved = yield* store.startTicketExecution({
        ticketId: doneTicketId,
        startedAt: "2026-09-07T10:04:00.000Z",
      });
      expect(preserved.changed).toBe(false);
      expect(preserved.ticket.status).toBe("done");
      expect(
        (yield* store.getSnapshot).tickets.map((ticket) => [ticket.id, ticket.status]),
      ).toEqual([
        [doneTicketId, "done"],
        [todoTicketId, "in_progress"],
      ]);
    }).pipe(Effect.provide(testLayer({ projects: new Set(["execution-project"]) }))),
  );

  it.effect("initializes the Workbench schema and migration ledger", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'workbench_%'
        ORDER BY name
      `;
      const migrations = yield* sql<{ readonly version: number }>`
        SELECT version
        FROM workbench_schema_migrations
        ORDER BY version
      `;

      expect(tables.map(({ name }) => name)).toEqual([
        "workbench_assignments",
        "workbench_epics",
        "workbench_jira_bindings",
        "workbench_jira_connections",
        "workbench_jira_issue_links",
        "workbench_project_links",
        "workbench_projects",
        "workbench_schema_migrations",
        "workbench_ticket_repositories",
        "workbench_ticket_workspace_repositories",
        "workbench_ticket_workspaces",
        "workbench_tickets",
      ]);
      expect(migrations.map(({ version }) => version)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
      ]);
    }).pipe(Effect.provide(testLayer())),
  );

  it.effect(
    "guards summary completions and failures by request while preserving metadata updates",
    () =>
      Effect.gen(function* () {
        const store = yield* WorkbenchStore;
        const projectId = ProjectId.make("summary-lifecycle-project");
        const workspaceId = WorkbenchProjectId.make("summary-lifecycle-workspace");
        const ticketId = WorkbenchTicketId.make("summary-lifecycle-ticket");
        const created = yield* seedTicket({ store, projectId, workspaceId, ticketId });
        expect(created.generatedSummary).toMatchObject({ stale: false });
        expect((yield* store.getSnapshot).tickets[0]?.generatedSummary).toEqual(
          created.generatedSummary,
        );

        yield* store.requestTicketSummary({ ticketId, requestId: "summary-request-1" });
        const staleCompletion = yield* store.completeTicketSummary({
          ticketId,
          requestId: "summary-request-stale",
          summary: "Should be ignored.",
        });
        expect(Option.isNone(staleCompletion)).toBe(true);

        const completed = yield* store.completeTicketSummary({
          ticketId,
          requestId: "summary-request-1",
          summary: "Reject invalid dimensions before querying the provider.",
        });
        const completedTicket = Option.getOrThrow(completed);
        expect(completedTicket.generatedSummary).toEqual({
          text: "Reject invalid dimensions before querying the provider.",
          status: "ready",
          stale: false,
          error: null,
        });

        const statusUpdate = yield* store.updateTicket({
          id: ticketId,
          expectedRevision: 0,
          status: "in_progress",
          updatedAt: "2026-09-07T10:01:00.000Z",
        });
        expect(statusUpdate.generatedSummary).toEqual(completedTicket.generatedSummary);

        yield* store.requestTicketSummary({ ticketId, requestId: "summary-request-2" });
        const staleFailure = yield* store.failTicketSummary({
          ticketId,
          requestId: "summary-request-1",
          error: "Should be ignored.",
        });
        expect(Option.isNone(staleFailure)).toBe(true);

        const failed = yield* store.failTicketSummary({
          ticketId,
          requestId: "summary-request-2",
          error: "The selected model is unavailable.",
        });
        expect(Option.getOrThrow(failed).generatedSummary).toEqual({
          text: "Reject invalid dimensions before querying the provider.",
          status: "error",
          stale: false,
          error: "The selected model is unavailable.",
        });
        expect((yield* store.getSnapshot).tickets[0]?.generatedSummary).toEqual(
          Option.getOrThrow(failed).generatedSummary,
        );
      }).pipe(Effect.provide(testLayer({ projects: new Set(["summary-lifecycle-project"]) }))),
  );

  it.effect("publishes a ticket change after restoring an archived pending ticket", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("summary-restore-project");
      const workspaceId = WorkbenchProjectId.make("summary-restore-workspace");
      const ticketId = WorkbenchTicketId.make("summary-restore-ticket");
      const archivedAt = "2026-09-07T10:01:00.000Z";
      const restoredAt = "2026-09-07T10:02:00.000Z";
      yield* seedTicket({ store, projectId, workspaceId, ticketId });

      const changeFiber = yield* Stream.runHead(store.ticketChanges).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* store.archiveTicket({
        ticketId,
        expectedRevision: 0,
        archivedAt,
        updatedAt: archivedAt,
      });
      yield* store.archiveTicket({
        ticketId,
        expectedRevision: 1,
        archivedAt: null,
        updatedAt: restoredAt,
      });

      expect(Option.getOrThrow(yield* Fiber.join(changeFiber))).toEqual({ ticketId });
    }).pipe(Effect.provide(testLayer({ projects: new Set(["summary-restore-project"]) }))),
  );

  it.effect("backfills summary columns for tickets from an older schema", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("summary-migration-project");
      const workspaceId = WorkbenchProjectId.make("summary-migration-workspace");
      const ticketId = WorkbenchTicketId.make("summary-migration-ticket");
      yield* seedTicket({ store, projectId, workspaceId, ticketId });

      yield* sql`DELETE FROM workbench_schema_migrations WHERE version = 12`;
      yield* sql`ALTER TABLE workbench_tickets DROP COLUMN generated_summary_request_id`;
      yield* sql`ALTER TABLE workbench_tickets DROP COLUMN generated_summary_source_hash`;
      yield* sql`ALTER TABLE workbench_tickets DROP COLUMN generated_summary_error`;
      yield* sql`ALTER TABLE workbench_tickets DROP COLUMN generated_summary_stale`;
      yield* sql`ALTER TABLE workbench_tickets DROP COLUMN generated_summary_status`;
      yield* sql`ALTER TABLE workbench_tickets DROP COLUMN generated_summary`;

      yield* ensureWorkbenchSchema;

      expect((yield* store.getSnapshot).tickets[0]?.generatedSummary).toEqual({
        text: null,
        status: "pending",
        stale: false,
        error: null,
      });
      const migratedColumns = yield* sql<{
        readonly generatedSummary: string | null;
        readonly generatedSummaryStatus: string;
        readonly generatedSummaryStale: number;
        readonly generatedSummaryError: string | null;
        readonly generatedSummarySourceHash: string | null;
        readonly generatedSummaryRequestId: string | null;
      }>`
        SELECT
          generated_summary AS "generatedSummary",
          generated_summary_status AS "generatedSummaryStatus",
          generated_summary_stale AS "generatedSummaryStale",
          generated_summary_error AS "generatedSummaryError",
          generated_summary_source_hash AS "generatedSummarySourceHash",
          generated_summary_request_id AS "generatedSummaryRequestId"
        FROM workbench_tickets
        WHERE ticket_id = ${ticketId}
      `;
      expect(migratedColumns).toEqual([
        {
          generatedSummary: null,
          generatedSummaryStatus: "pending",
          generatedSummaryStale: 0,
          generatedSummaryError: null,
          generatedSummarySourceHash: null,
          generatedSummaryRequestId: null,
        },
      ]);
    }).pipe(Effect.provide(testLayer({ projects: new Set(["summary-migration-project"]) }))),
  );

  it.effect("backfills Ticket Workspace repository attempt ownership", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("workspace-attempt-migration-project");
      const workspaceId = WorkbenchProjectId.make("workspace-attempt-migration-workspace");
      const ticketId = WorkbenchTicketId.make("workspace-attempt-migration-ticket");
      const createdAt = "2026-09-07T10:00:00.000Z";
      const attemptId = "workspace-attempt-migration-attempt";

      yield* seedTicket({ store, projectId, workspaceId, ticketId, createdAt });
      yield* sql`
        INSERT INTO workbench_ticket_workspaces (
          ticket_id, attempt_id, status, branch_name, error_message, created_at, updated_at
        ) VALUES (
          ${ticketId}, ${attemptId}, 'ready', 'workbench/migration', NULL,
          ${createdAt}, ${createdAt}
        )
      `;
      yield* sql`
        INSERT INTO workbench_ticket_workspace_repositories (
          ticket_id, t3_project_id, attempt_id, is_primary, source_path, worktree_path,
          branch_name, status, error_message, created_at, updated_at
        ) VALUES (
          ${ticketId}, ${projectId}, NULL, 1, '/repos/migration', '/worktrees/migration',
          'workbench/migration', 'ready', NULL, ${createdAt}, ${createdAt}
        )
      `;

      yield* sql`DELETE FROM workbench_schema_migrations WHERE version = 13`;
      yield* sql`ALTER TABLE workbench_ticket_workspace_repositories DROP COLUMN attempt_id`;
      yield* ensureWorkbenchSchema;

      const backfilled = yield* sql<{ readonly attemptId: string | null }>`
        SELECT attempt_id AS "attemptId"
        FROM workbench_ticket_workspace_repositories
        WHERE ticket_id = ${ticketId}
      `;
      expect(backfilled).toEqual([{ attemptId }]);
      expect(yield* store.getTicketWorkspaceRepositoryStates(ticketId)).toEqual([
        { projectId, attemptId, status: "ready" },
      ]);
    }).pipe(
      Effect.provide(testLayer({ projects: new Set(["workspace-attempt-migration-project"]) })),
    ),
  );

  it.effect("rolls back a failed ticket update after acquiring the writer lock", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("native-project");
      const workspaceId = WorkbenchProjectId.make("rollback-workspace");
      const ticketId = WorkbenchTicketId.make("rollback-ticket");
      const createdAt = "2026-09-05T12:00:00.000Z";

      yield* store.createProject({
        id: workspaceId,
        title: "Rollback Workspace",
        linkedProjectIds: [projectId],
        createdAt,
      });
      yield* store.createTicket({
        id: ticketId,
        projectId: workspaceId,
        title: "Original title",
        kind: "story",
        markdown: "Original markdown",
        primaryT3ProjectId: projectId,
        createdAt,
      });

      // Fail after the ticket UPDATE has run so the store transaction must
      // roll the write back along with its revision change.
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        CREATE TRIGGER fail_ticket_update
        AFTER UPDATE OF title ON workbench_tickets
        WHEN NEW.title = 'Updated title'
        BEGIN
          SELECT RAISE(ABORT, 'test rollback');
        END
      `;

      const error = yield* Effect.flip(
        store.updateTicket({
          id: ticketId,
          expectedRevision: 0,
          title: "Updated title",
          updatedAt: "2026-09-05T12:01:00.000Z",
        }),
      );
      const snapshot = yield* store.getSnapshot;

      expect(error.code).toBe("persistence_failed");
      expect(snapshot.tickets).toEqual([
        expect.objectContaining({
          id: ticketId,
          title: "Original title",
          revision: 0,
        }),
      ]);
    }).pipe(Effect.provide(testLayer({ projects: new Set(["native-project"]) }))),
  );

  it.effect("checks native thread existence and project ownership for assignments", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("assignment-project");
      const workspaceId = WorkbenchProjectId.make("assignment-workspace");
      const ticketId = WorkbenchTicketId.make("assignment-ticket");
      const createdAt = "2026-09-05T12:00:00.000Z";

      yield* store.createProject({
        id: workspaceId,
        title: "Assignment Workspace",
        linkedProjectIds: [projectId],
        createdAt,
      });
      yield* store.createTicket({
        id: ticketId,
        projectId: workspaceId,
        title: "Assignment ticket",
        kind: "story",
        markdown: "",
        primaryT3ProjectId: projectId,
        createdAt,
      });

      const missingThread = yield* Effect.flip(
        store.createAssignment({
          id: WorkbenchAssignmentId.make("missing-thread-assignment"),
          ticketId,
          threadId: ThreadId.make("missing-thread"),
          createdAt,
        }),
      );
      const wrongProject = yield* Effect.flip(
        store.createAssignment({
          id: WorkbenchAssignmentId.make("wrong-project-assignment"),
          ticketId,
          threadId: ThreadId.make("wrong-project-thread"),
          createdAt,
        }),
      );

      expect(missingThread.code).toBe("thread_not_found");
      expect(wrongProject.code).toBe("thread_project_mismatch");
    }).pipe(
      Effect.provide(
        testLayer({
          projects: new Set(["assignment-project"]),
          threads: new Map([["wrong-project-thread", "other-project"]]),
        }),
      ),
    ),
  );
});
