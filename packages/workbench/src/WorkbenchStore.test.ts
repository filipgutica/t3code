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
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { WorkbenchNativeAccess } from "./WorkbenchNativeAccess.ts";
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

describe("WorkbenchStore package boundary", () => {
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
      expect(migrations.map(({ version }) => version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    }).pipe(Effect.provide(testLayer())),
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
