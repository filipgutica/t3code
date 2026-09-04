import {
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchEpicId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WorkbenchTicketWorkspaceAttemptId,
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
  it.effect("persists a fenced multi-repository Ticket Workspace lifecycle", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* WorkbenchStore;
      const primaryProjectId = ProjectId.make("t3-project-workspace-primary");
      const secondaryProjectId = ProjectId.make("t3-project-workspace-secondary");
      const projectId = WorkbenchProjectId.make("workbench-project-workspace");
      const ticketId = WorkbenchTicketId.make("ticket-workspace");
      const attemptId = WorkbenchTicketWorkspaceAttemptId.make("attempt-1");
      const createdAt = "2026-09-03T12:00:00.000Z";

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES
          (${primaryProjectId}, 'Primary', '/repos/primary', '[]', ${createdAt}, ${createdAt}, NULL),
          (${secondaryProjectId}, 'Secondary', '/repos/secondary', '[]', ${createdAt}, ${createdAt}, NULL)
      `;
      yield* store.createProject({
        id: projectId,
        title: "Multi-repository Workspace",
        linkedProjectIds: [primaryProjectId, secondaryProjectId],
        createdAt,
      });
      yield* store.createTicket({
        id: ticketId,
        projectId,
        title: "Prepare all repositories",
        kind: "story",
        markdown: "",
        primaryT3ProjectId: primaryProjectId,
        repositoryProjectIds: [primaryProjectId, secondaryProjectId],
        createdAt,
      });

      yield* store.claimTicketWorkspace({
        ticketId,
        attemptId,
        branchName: "workbench/ticket-workspace-12345678",
        repositories: [
          {
            projectId: primaryProjectId,
            isPrimary: true,
            sourcePath: "/repos/primary",
            worktreePath: "/worktrees/ticket-workspace/primary",
          },
          {
            projectId: secondaryProjectId,
            isPrimary: false,
            sourcePath: "/repos/secondary",
            worktreePath: "/worktrees/ticket-workspace/secondary",
          },
        ],
        claimedAt: createdAt,
      });
      const concurrentClaim = yield* Effect.flip(
        store.claimTicketWorkspace({
          ticketId,
          attemptId: WorkbenchTicketWorkspaceAttemptId.make("attempt-2"),
          branchName: "workbench/ticket-workspace-12345678",
          repositories: [
            {
              projectId: primaryProjectId,
              isPrimary: true,
              sourcePath: "/repos/primary",
              worktreePath: "/worktrees/ticket-workspace/primary",
            },
            {
              projectId: secondaryProjectId,
              isPrimary: false,
              sourcePath: "/repos/secondary",
              worktreePath: "/worktrees/ticket-workspace/secondary",
            },
          ],
          claimedAt: "2026-09-03T12:00:01.000Z",
        }),
      );
      const lockedScope = yield* Effect.flip(
        store.updateTicket({
          id: ticketId,
          title: "Prepare all repositories",
          markdown: "",
          primaryT3ProjectId: primaryProjectId,
          repositoryProjectIds: [primaryProjectId],
          status: "todo",
          blocked: false,
          updatedAt: "2026-09-03T12:00:01.000Z",
        }),
      );
      yield* store.markTicketWorkspaceRepositoryReady({
        ticketId,
        attemptId,
        projectId: primaryProjectId,
        worktreePath: "/worktrees/ticket-workspace/primary",
        branchName: "workbench/ticket-workspace-12345678",
        updatedAt: "2026-09-03T12:00:02.000Z",
      });
      yield* store.markTicketWorkspaceRepositoryReady({
        ticketId,
        attemptId,
        projectId: secondaryProjectId,
        worktreePath: "/worktrees/ticket-workspace/secondary",
        branchName: "workbench/ticket-workspace-12345678",
        updatedAt: "2026-09-03T12:00:03.000Z",
      });
      const ready = yield* store.completeTicketWorkspace({
        ticketId,
        attemptId,
        completedAt: "2026-09-03T12:00:04.000Z",
      });
      const snapshot = yield* store.getSnapshot;

      expect(concurrentClaim.code).toBe("ticket_workspace_preparation_in_progress");
      expect(lockedScope.code).toBe("ticket_repository_scope_locked");
      expect(ready).toMatchObject({
        ticketId,
        attemptId,
        status: "ready",
        repositories: [
          expect.objectContaining({
            projectId: primaryProjectId,
            isPrimary: true,
            status: "ready",
          }),
          expect.objectContaining({
            projectId: secondaryProjectId,
            isPrimary: false,
            status: "ready",
          }),
        ],
      });
      expect(snapshot.ticketWorkspaces).toEqual([ready]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("persists Epics and enforces Ticket-to-Workspace integrity", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* WorkbenchStore;
      const linkedProjectId = ProjectId.make("t3-project-epic");
      const workspaceId = WorkbenchProjectId.make("workbench-project-epic");
      const otherWorkspaceId = WorkbenchProjectId.make("workbench-project-other");
      const epicId = WorkbenchEpicId.make("epic-1");
      const createdAt = "2026-09-03T12:00:00.000Z";

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          ${linkedProjectId}, 'T3 Code', '/tmp/t3code', '[]', ${createdAt}, ${createdAt}, NULL
        )
      `;
      yield* store.createProject({
        id: workspaceId,
        title: "Agent Workbench",
        linkedProjectIds: [linkedProjectId],
        createdAt,
      });
      yield* store.createProject({
        id: otherWorkspaceId,
        title: "Another Workspace",
        linkedProjectIds: [linkedProjectId],
        createdAt,
      });
      yield* store.createEpic({
        id: epicId,
        projectId: workspaceId,
        title: "Native planning",
        markdown: "Keep planning connected to execution.",
        createdAt,
      });
      yield* store.createTicket({
        id: WorkbenchTicketId.make("ticket-with-epic"),
        projectId: workspaceId,
        epicId,
        title: "Create Epic swimlanes",
        kind: "story",
        markdown: "",
        primaryT3ProjectId: linkedProjectId,
        repositoryProjectIds: [linkedProjectId],
        createdAt,
      });
      const mismatchedEpic = yield* Effect.flip(
        store.createTicket({
          id: WorkbenchTicketId.make("ticket-wrong-workspace"),
          projectId: otherWorkspaceId,
          epicId,
          title: "Invalid Epic link",
          kind: "story",
          markdown: "",
          primaryT3ProjectId: linkedProjectId,
          repositoryProjectIds: [linkedProjectId],
          createdAt,
        }),
      );
      yield* store.updateEpic({
        id: epicId,
        title: "Native planning and execution",
        markdown: "Keep planning and execution connected.",
        updatedAt: "2026-09-03T12:01:00.000Z",
      });
      yield* store.archiveEpic({
        id: epicId,
        archivedAt: "2026-09-03T12:02:00.000Z",
      });
      const archivedEpicTicket = yield* store.updateTicket({
        id: WorkbenchTicketId.make("ticket-with-epic"),
        title: "Create Epic swimlanes",
        markdown: "Existing Tickets remain editable after their Epic is archived.",
        status: "todo",
        blocked: false,
        updatedAt: "2026-09-03T12:02:30.000Z",
      });
      const unlinkedTicket = yield* store.updateTicket({
        id: WorkbenchTicketId.make("ticket-with-epic"),
        epicId: null,
        title: "Create Epic swimlanes",
        markdown: "Existing Tickets can be removed from an archived Epic.",
        status: "todo",
        blocked: false,
        updatedAt: "2026-09-03T12:02:45.000Z",
      });
      const archivedEpic = yield* Effect.flip(
        store.createTicket({
          id: WorkbenchTicketId.make("ticket-archived-epic"),
          projectId: workspaceId,
          epicId,
          title: "Cannot join archived Epic",
          kind: "bug",
          markdown: "",
          primaryT3ProjectId: linkedProjectId,
          repositoryProjectIds: [linkedProjectId],
          createdAt: "2026-09-03T12:03:00.000Z",
        }),
      );
      const snapshot = yield* store.getSnapshot;

      expect(snapshot.epics).toEqual([
        expect.objectContaining({
          id: epicId,
          projectId: workspaceId,
          title: "Native planning and execution",
          archivedAt: "2026-09-03T12:02:00.000Z",
        }),
      ]);
      expect(snapshot.tickets).toEqual([
        expect.objectContaining({ id: "ticket-with-epic", epicId: null }),
      ]);
      expect(archivedEpicTicket.epicId).toBe(epicId);
      expect(unlinkedTicket.epicId).toBeNull();
      expect(mismatchedEpic.code).toBe("epic_project_mismatch");
      expect(archivedEpic.code).toBe("epic_archived");
    }).pipe(Effect.provide(TestLayer)),
  );

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

  it.effect("preserves Jira-owned fields when updating local Ticket execution context", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* WorkbenchStore;
      const firstProjectId = ProjectId.make("jira-local-project-1");
      const secondProjectId = ProjectId.make("jira-local-project-2");
      const projectId = WorkbenchProjectId.make("jira-local-workspace");
      const ticketId = WorkbenchTicketId.make("jira-local-ticket");
      const createdAt = "2026-09-03T12:00:00.000Z";
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES
          (${firstProjectId}, 'First', '/repos/first', '[]', ${createdAt}, ${createdAt}, NULL),
          (${secondProjectId}, 'Second', '/repos/second', '[]', ${createdAt}, ${createdAt}, NULL)
      `;
      yield* store.createProject({
        id: projectId,
        title: "Jira Workspace",
        linkedProjectIds: [firstProjectId, secondProjectId],
        createdAt,
      });
      yield* store.createTicket({
        id: ticketId,
        projectId,
        title: "Jira summary",
        kind: "story",
        markdown: "Original instructions",
        primaryT3ProjectId: firstProjectId,
        repositoryProjectIds: [firstProjectId],
        createdAt,
      });
      yield* sql`
        INSERT INTO workbench_jira_connections (
          connection_id, cloud_id, credential_id, site_name, site_url, avatar_url,
          scopes_json, created_at, updated_at
        ) VALUES (
          'connection-1', 'cloud-1', 'credential-1', 'Jira', 'https://example.atlassian.net',
          NULL, '[]', ${createdAt}, ${createdAt}
        )
      `;
      yield* sql`
        INSERT INTO workbench_jira_bindings (
          binding_id, workbench_project_id, connection_id, jira_project_id, jira_project_key,
          jira_project_name, board_id, board_name, sprint_id, sprint_name,
          default_primary_t3_project_id, default_repository_project_ids_json,
          status_mappings_json, active, last_synced_at, created_at, updated_at
        ) VALUES (
          'binding-1', ${projectId}, 'connection-1', '10000', 'WB', 'Workbench',
          42, 'Board', 7, 'Sprint', ${firstProjectId}, '["jira-local-project-1"]',
          '[]', 1, NULL, ${createdAt}, ${createdAt}
        )
      `;
      yield* sql`
        INSERT INTO workbench_jira_issue_links (
          binding_id, jira_issue_id, ticket_id, issue_json, active, linked_at, last_seen_at
        ) VALUES ('binding-1', '10001', ${ticketId}, '{}', 0, ${createdAt}, ${createdAt})
      `;

      yield* store.updateTicket({
        id: ticketId,
        title: "Stale browser title",
        kind: "bug",
        markdown: "Updated local instructions",
        primaryT3ProjectId: secondProjectId,
        repositoryProjectIds: [secondProjectId, firstProjectId],
        status: "done",
        blocked: true,
        updatedAt: "2026-09-03T13:00:00.000Z",
      });

      const ticket = (yield* store.getSnapshot).tickets.find(
        (candidate) => candidate.id === ticketId,
      );
      expect(ticket).toMatchObject({
        title: "Jira summary",
        kind: "story",
        markdown: "Updated local instructions",
        primaryT3ProjectId: secondProjectId,
        repositoryProjectIds: [secondProjectId, firstProjectId],
        status: "todo",
        blocked: false,
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("serializes Workspace release claims with Assignment creation", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("release-project");
      const workspaceId = WorkbenchProjectId.make("release-workspace");
      const ticketId = WorkbenchTicketId.make("release-ticket");
      const threadId = ThreadId.make("release-thread");
      const attemptId = WorkbenchTicketWorkspaceAttemptId.make("release-attempt");
      const createdAt = "2026-09-03T12:00:00.000Z";
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES (${projectId}, 'Repository', '/repos/release', '[]', ${createdAt}, ${createdAt}, NULL)
      `;
      yield* store.createProject({
        id: workspaceId,
        title: "Workspace",
        linkedProjectIds: [projectId],
        createdAt,
      });
      yield* store.createTicket({
        id: ticketId,
        projectId: workspaceId,
        title: "Race release",
        kind: "story",
        markdown: "",
        primaryT3ProjectId: projectId,
        repositoryProjectIds: [projectId],
        createdAt,
      });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, pending_approval_count, pending_user_input_count,
          has_actionable_proposed_plan, created_at, updated_at, deleted_at
        ) VALUES (
          ${threadId}, ${projectId}, 'Race release',
          '{"provider":"codex","model":"gpt-5-codex"}', 'full-access', 'default',
          0, 0, 0, ${createdAt}, ${createdAt}, NULL
        )
      `;
      yield* store.claimTicketWorkspace({
        ticketId,
        attemptId,
        branchName: "workbench/release",
        repositories: [
          {
            projectId,
            isPrimary: true,
            sourcePath: "/repos/release",
            worktreePath: "/worktrees/release",
          },
        ],
        claimedAt: createdAt,
      });
      yield* store.markTicketWorkspaceRepositoryReady({
        ticketId,
        attemptId,
        projectId,
        worktreePath: "/worktrees/release",
        branchName: "workbench/release",
        updatedAt: createdAt,
      });
      yield* store.completeTicketWorkspace({ ticketId, attemptId, completedAt: createdAt });

      const release = store
        .claimTicketWorkspaceRelease({
          ticketId,
          attemptId,
          claimedAt: "2026-09-03T12:01:00.000Z",
        })
        .pipe(
          Effect.match({
            onFailure: (error) => ({ ok: false, code: error.code }) as const,
            onSuccess: () => ({ ok: true }) as const,
          }),
        );
      const assign = store
        .createAssignment({
          id: WorkbenchAssignmentId.make("release-assignment"),
          ticketId,
          threadId,
          createdAt: "2026-09-03T12:01:00.000Z",
        })
        .pipe(
          Effect.match({
            onFailure: (error) => ({ ok: false, code: error.code }) as const,
            onSuccess: () => ({ ok: true }) as const,
          }),
        );
      const [releaseResult, assignmentResult] = yield* Effect.all([release, assign], {
        concurrency: "unbounded",
      });

      expect([releaseResult.ok, assignmentResult.ok].filter(Boolean)).toHaveLength(1);
      expect(releaseResult.ok ? assignmentResult : releaseResult).toEqual({
        ok: false,
        code: "ticket_workspace_in_use",
      });
    }).pipe(Effect.provide(TestLayer)),
  );

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
          epicId: null,
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
      expect(snapshot.epics).toEqual([]);
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
