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

      yield* store.createProject({
        id: projectId,
        title: "Agent Workbench",
        linkedProjectIds: [linkedProjectId],
        createdAt,
      });
      yield* store.createTicket({
        id: ticketId,
        projectId,
        title: "Create the first Ticket flow",
        markdown: "Keep the native T3 Thread experience.",
        primaryT3ProjectId: linkedProjectId,
        createdAt,
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
          ${linkedProjectId},
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
          ${linkedProjectId},
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

      const snapshot = yield* store.getSnapshot;

      expect(snapshot.projects).toHaveLength(1);
      expect(snapshot.projects[0]?.linkedProjectIds).toEqual([linkedProjectId]);
      expect(snapshot.tickets[0]).toMatchObject({
        id: ticketId,
        status: "in_progress",
        blocked: false,
      });
      expect(snapshot.assignments[0]).toMatchObject({
        ticketId,
        threadId: "thread-2",
      });
      expect(snapshot.assignments).toHaveLength(1);
      expect(duplicateError.code).toBe("assignment_already_exists");
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

      const error = yield* Effect.flip(
        store.createTicket({
          id: WorkbenchTicketId.make("ticket-1"),
          projectId,
          title: "Invalid Ticket",
          markdown: "",
          primaryT3ProjectId: ProjectId.make("unlinked-project"),
          createdAt,
        }),
      );

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
        markdown: "",
        primaryT3ProjectId: linkedProjectId,
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
});
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
