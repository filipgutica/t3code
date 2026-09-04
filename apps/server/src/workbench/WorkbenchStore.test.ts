import {
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  makeSqlitePersistenceLive,
  SqlitePersistenceMemory,
} from "../persistence/Layers/Sqlite.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "./WorkbenchStore.ts";

const TestLayer = WorkbenchStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));

describe("WorkbenchStore", () => {
  it.effect("persists a Workspace, Ticket, and Assignment around a native T3 Thread", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* WorkbenchStore;
      const linkedProjectId = ProjectId.make("t3-project-1");
      const secondaryProjectId = ProjectId.make("t3-project-2");
      const projectId = WorkbenchProjectId.make("workbench-project-1");
      const ticketId = WorkbenchTicketId.make("ticket-1");
      const createdAt = "2026-09-03T12:00:00.000Z";

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        ) VALUES (
          ${linkedProjectId},
          'T3 Code',
          '/tmp/t3code',
          '[]',
          ${createdAt},
          ${createdAt},
          NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        ) VALUES (
          ${secondaryProjectId},
          'T3 Code docs',
          '/tmp/t3code-docs',
          '[]',
          ${createdAt},
          ${createdAt},
          NULL
        )
      `;

      yield* store.createProject({
        id: projectId,
        title: "Agent Workbench",
        linkedProjectIds: [linkedProjectId, secondaryProjectId],
        createdAt,
      });
      yield* store.createTicket({
        id: ticketId,
        projectId,
        title: "Create the first Ticket flow",
        kind: "story",
        markdown: "Keep the native T3 Thread experience.",
        primaryT3ProjectId: linkedProjectId,
        repositoryProjectIds: [linkedProjectId, secondaryProjectId],
        createdAt,
      });
      yield* store.updateTicket({
        id: ticketId,
        title: "Create the first Ticket flow",
        kind: "bug",
        markdown: "Keep the native T3 Thread experience.",
        primaryT3ProjectId: secondaryProjectId,
        repositoryProjectIds: [secondaryProjectId, linkedProjectId],
        status: "todo",
        blocked: false,
        updatedAt: "2026-09-03T12:01:00.000Z",
      });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          deleted_at
        ) VALUES (
          'thread-1',
          ${secondaryProjectId},
          'Create the first Ticket flow',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          0,
          0,
          0,
          ${createdAt},
          ${createdAt},
          NULL
        )
      `;
      yield* store.createAssignment({
        id: WorkbenchAssignmentId.make("assignment-1"),
        ticketId,
        threadId: ThreadId.make("thread-1"),
        createdAt: "2026-09-03T12:02:00.000Z",
      });
      yield* store.updateTicket({
        id: ticketId,
        title: "Create the first Ticket flow",
        markdown: "Keep the native T3 Thread experience.",
        status: "in_progress",
        blocked: false,
        updatedAt: "2026-09-03T12:02:15.000Z",
      });
      const lockedScopeError = yield* Effect.flip(
        store.updateTicket({
          id: ticketId,
          title: "Create the first Ticket flow",
          kind: "bug",
          markdown: "Keep the native T3 Thread experience.",
          primaryT3ProjectId: linkedProjectId,
          repositoryProjectIds: [linkedProjectId],
          status: "in_progress",
          blocked: false,
          updatedAt: "2026-09-03T12:02:30.000Z",
        }),
      );

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          deleted_at
        ) VALUES (
          'thread-2',
          ${secondaryProjectId},
          'Duplicate start attempt',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          0,
          0,
          0,
          ${createdAt},
          ${createdAt},
          NULL
        )
      `;
      const duplicateError = yield* Effect.flip(
        store.createAssignment({
          id: WorkbenchAssignmentId.make("assignment-2"),
          ticketId,
          threadId: ThreadId.make("thread-2"),
          createdAt: "2026-09-03T12:03:00.000Z",
        }),
      );
      yield* store.replaceAssignment({
        ticketId,
        previousThreadId: ThreadId.make("thread-1"),
        threadId: ThreadId.make("thread-2"),
        replacedAt: "2026-09-03T12:04:00.000Z",
      });
      const staleReplacementError = yield* Effect.flip(
        store.replaceAssignment({
          id: WorkbenchAssignmentId.make("assignment-stale"),
          ticketId,
          previousThreadId: ThreadId.make("thread-1"),
          threadId: ThreadId.make("thread-2"),
          replacedAt: "2026-09-03T12:05:00.000Z",
        }),
      );

      const snapshot = yield* store.getSnapshot;

      expect(snapshot.projects).toHaveLength(1);
      expect(snapshot.projects[0]?.linkedProjectIds).toEqual([linkedProjectId, secondaryProjectId]);
      expect(snapshot.tickets[0]).toMatchObject({
        id: ticketId,
        kind: "bug",
        primaryT3ProjectId: secondaryProjectId,
        repositoryProjectIds: [secondaryProjectId, linkedProjectId],
        status: "in_progress",
        blocked: false,
      });
      expect(snapshot.assignments[0]).toMatchObject({
        ticketId,
        threadId: "thread-1",
        supersededAt: "2026-09-03T12:04:00.000Z",
      });
      expect(snapshot.assignments[1]).toMatchObject({
        ticketId,
        threadId: "thread-2",
        supersededAt: null,
      });
      expect(snapshot.assignments[1]?.id).toBeTruthy();
      expect(snapshot.assignments).toHaveLength(2);
      expect(duplicateError.code).toBe("assignment_already_exists");
      expect(lockedScopeError.code).toBe("ticket_repository_scope_locked");
      expect(staleReplacementError.code).toBe("assignment_changed");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("serializes Ticket repository changes with Assignment creation", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* WorkbenchStore;
      const primaryProjectId = ProjectId.make("t3-project-primary");
      const nextPrimaryProjectId = ProjectId.make("t3-project-next");
      const projectId = WorkbenchProjectId.make("workbench-project-race");
      const ticketId = WorkbenchTicketId.make("ticket-race");
      const threadId = ThreadId.make("thread-race");
      const createdAt = "2026-09-03T12:00:00.000Z";

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES
          (
            ${primaryProjectId}, 'Primary', '/tmp/primary', '[]',
            ${createdAt}, ${createdAt}, NULL
          ),
          (
            ${nextPrimaryProjectId}, 'Next', '/tmp/next', '[]',
            ${createdAt}, ${createdAt}, NULL
          )
      `;
      yield* store.createProject({
        id: projectId,
        title: "Race-safe Workspace",
        linkedProjectIds: [primaryProjectId, nextPrimaryProjectId],
        createdAt,
      });
      yield* store.createTicket({
        id: ticketId,
        projectId,
        title: "Keep Assignment repository context stable",
        kind: "story",
        markdown: "",
        primaryT3ProjectId: primaryProjectId,
        repositoryProjectIds: [primaryProjectId],
        createdAt,
      });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, pending_approval_count, pending_user_input_count,
          has_actionable_proposed_plan, created_at, updated_at, deleted_at
        ) VALUES (
          ${threadId}, ${primaryProjectId}, 'Race-safe Thread',
          '{"provider":"codex","model":"gpt-5-codex"}', 'full-access',
          'default', 0, 0, 0, ${createdAt}, ${createdAt}, NULL
        )
      `;

      const [updateResult, assignmentResult] = yield* Effect.all(
        [
          store
            .updateTicket({
              id: ticketId,
              title: "Keep Assignment repository context stable",
              kind: "story",
              markdown: "",
              primaryT3ProjectId: nextPrimaryProjectId,
              repositoryProjectIds: [nextPrimaryProjectId],
              status: "todo",
              blocked: false,
              updatedAt: "2026-09-03T12:01:00.000Z",
            })
            .pipe(
              Effect.match({
                onFailure: (error) => ({ ok: false, code: error.code }) as const,
                onSuccess: () => ({ ok: true }) as const,
              }),
            ),
          store
            .createAssignment({
              id: WorkbenchAssignmentId.make("assignment-race"),
              ticketId,
              threadId,
              createdAt: "2026-09-03T12:01:00.000Z",
            })
            .pipe(
              Effect.match({
                onFailure: (error) => ({ ok: false, code: error.code }) as const,
                onSuccess: () => ({ ok: true }) as const,
              }),
            ),
        ],
        { concurrency: "unbounded" },
      );
      const snapshot = yield* store.getSnapshot;
      const ticket = snapshot.tickets.find((candidate) => candidate.id === ticketId);
      const assignment = snapshot.assignments.find(
        (candidate) => candidate.ticketId === ticketId && candidate.supersededAt === null,
      );

      expect([updateResult.ok, assignmentResult.ok].filter(Boolean)).toHaveLength(1);
      if (assignment) {
        expect(ticket?.primaryT3ProjectId).toBe(primaryProjectId);
        expect(updateResult).toEqual({ ok: false, code: "ticket_repository_scope_locked" });
      } else {
        expect(ticket?.primaryT3ProjectId).toBe(nextPrimaryProjectId);
        expect(assignmentResult).toEqual({ ok: false, code: "thread_project_mismatch" });
      }
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("rejects a Ticket primary repository outside its Workbench Workspace", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* WorkbenchStore;
      const linkedProjectId = ProjectId.make("t3-project-1");
      const projectId = WorkbenchProjectId.make("workbench-project-1");
      const createdAt = "2026-09-03T12:00:00.000Z";

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        ) VALUES (
          ${linkedProjectId},
          'T3 Code',
          '/tmp/t3code',
          '[]',
          ${createdAt},
          ${createdAt},
          NULL
        )
      `;
      yield* store.createProject({
        id: projectId,
        title: "Agent Workbench",
        linkedProjectIds: [linkedProjectId],
        createdAt,
      });

      const missingPrimaryError = yield* Effect.flip(
        store.createTicket({
          id: WorkbenchTicketId.make("ticket-without-primary"),
          projectId,
          title: "Invalid Ticket scope",
          kind: "story",
          markdown: "",
          primaryT3ProjectId: linkedProjectId,
          repositoryProjectIds: [ProjectId.make("another-project")],
          createdAt,
        }),
      );

      const error = yield* Effect.flip(
        store.createTicket({
          id: WorkbenchTicketId.make("ticket-1"),
          projectId,
          title: "Invalid Ticket",
          kind: "story",
          markdown: "",
          primaryT3ProjectId: ProjectId.make("unlinked-project"),
          repositoryProjectIds: [ProjectId.make("unlinked-project")],
          createdAt,
        }),
      );

      expect(missingPrimaryError.code).toBe("primary_repository_not_selected");
      expect(error.code).toBe("primary_project_not_linked");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("rejects an Assignment until its native T3 Thread exists", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* WorkbenchStore;
      const linkedProjectId = ProjectId.make("t3-project-1");
      const projectId = WorkbenchProjectId.make("workbench-project-1");
      const ticketId = WorkbenchTicketId.make("ticket-1");
      const createdAt = "2026-09-03T12:00:00.000Z";

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          ${linkedProjectId}, 'T3 Code', '/tmp/t3code', '[]', ${createdAt}, ${createdAt}, NULL
        )
      `;
      yield* store.createProject({
        id: projectId,
        title: "Agent Workbench",
        linkedProjectIds: [linkedProjectId],
        createdAt,
      });
      yield* store.createTicket({
        id: ticketId,
        projectId,
        title: "Ticket",
        kind: "bug",
        markdown: "",
        primaryT3ProjectId: linkedProjectId,
        repositoryProjectIds: [linkedProjectId],
        createdAt,
      });

      const error = yield* Effect.flip(
        store.createAssignment({
          id: WorkbenchAssignmentId.make("assignment-1"),
          ticketId,
          threadId: ThreadId.make("missing-thread"),
          createdAt,
        }),
      );

      expect(error.code).toBe("thread_not_found");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("reloads Workbench data after the SQLite layer restarts", () => {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-workbench-store-"));
    const dbPath = NodePath.join(tempDir, "orchestration.sqlite");
    const persistence = makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer));
    const layer = WorkbenchStoreLive.pipe(Layer.provideMerge(persistence));
    const createdAt = "2026-09-03T12:00:00.000Z";
    const linkedProjectId = ProjectId.make("t3-project-restart");
    const projectId = WorkbenchProjectId.make("workbench-project-restart");

    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const store = yield* WorkbenchStore;
        yield* sql`
          INSERT INTO projection_projects (
            project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
          ) VALUES (
            ${linkedProjectId}, 'T3 Code', '/tmp/t3code', '[]', ${createdAt}, ${createdAt}, NULL
          )
        `;
        yield* store.createProject({
          id: projectId,
          title: "Persistent Workbench",
          linkedProjectIds: [linkedProjectId],
          createdAt,
        });
      }).pipe(Effect.provide(layer));

      const snapshot = yield* Effect.gen(function* () {
        const store = yield* WorkbenchStore;
        return yield* store.getSnapshot;
      }).pipe(Effect.provide(layer));

      expect(snapshot.projects).toEqual([
        expect.objectContaining({ id: projectId, title: "Persistent Workbench" }),
      ]);
    }).pipe(
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
    );
  });

  it.effect("migrates existing Tickets and Assignments without losing their links", () => {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-workbench-v1-"));
    const dbPath = NodePath.join(tempDir, "orchestration.sqlite");
    const persistence = makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer));
    const workbench = WorkbenchStoreLive.pipe(Layer.provideMerge(persistence));
    const createdAt = "2026-09-03T12:00:00.000Z";

    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          CREATE TABLE workbench_schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `;
        yield* sql`
          CREATE TABLE workbench_projects (
            project_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `;
        yield* sql`
          CREATE TABLE workbench_project_links (
            workbench_project_id TEXT NOT NULL,
            t3_project_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (workbench_project_id, t3_project_id)
          )
        `;
        yield* sql`
          CREATE TABLE workbench_tickets (
            ticket_id TEXT PRIMARY KEY,
            workbench_project_id TEXT NOT NULL,
            title TEXT NOT NULL,
            markdown TEXT NOT NULL,
            primary_t3_project_id TEXT NOT NULL,
            status TEXT NOT NULL,
            blocked INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `;
        yield* sql`
          CREATE TABLE workbench_assignments (
            assignment_id TEXT PRIMARY KEY,
            ticket_id TEXT NOT NULL UNIQUE,
            thread_id TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
          )
        `;
        yield* sql`
          INSERT INTO workbench_projects
          VALUES ('workspace-v1', 'Legacy Workspace', ${createdAt}, ${createdAt})
        `;
        yield* sql`
          INSERT INTO workbench_project_links
          VALUES ('workspace-v1', 'repository-v1', 0)
        `;
        yield* sql`
          INSERT INTO workbench_tickets
          VALUES (
            'ticket-v1',
            'workspace-v1',
            'Legacy Ticket',
            'Existing description',
            'repository-v1',
            'in_progress',
            0,
            ${createdAt},
            ${createdAt}
          )
        `;
        yield* sql`
          INSERT INTO workbench_assignments
          VALUES ('assignment-v1', 'ticket-v1', 'thread-v1', ${createdAt})
        `;
        yield* sql`
          INSERT INTO workbench_schema_migrations (version)
          VALUES (1)
        `;
      }).pipe(Effect.provide(persistence));

      const snapshot = yield* Effect.gen(function* () {
        const store = yield* WorkbenchStore;
        return yield* store.getSnapshot;
      }).pipe(Effect.provide(workbench));

      expect(snapshot.tickets).toEqual([
        expect.objectContaining({
          id: "ticket-v1",
          kind: "story",
          primaryT3ProjectId: "repository-v1",
          repositoryProjectIds: ["repository-v1"],
        }),
      ]);
      expect(snapshot.assignments).toEqual([
        expect.objectContaining({
          id: "assignment-v1",
          ticketId: "ticket-v1",
          threadId: "thread-v1",
          supersededAt: null,
        }),
      ]);
    }).pipe(
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
    );
  });
});
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
