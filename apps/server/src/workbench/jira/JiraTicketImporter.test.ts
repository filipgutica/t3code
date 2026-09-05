import {
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchEpicId,
  WorkbenchJiraBindingId,
  WorkbenchJiraConnectionId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchJiraBinding,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "../WorkbenchStore.ts";
import { JiraTicketImporter, layer as jiraTicketImporterLayer } from "./JiraTicketImporter.ts";

const TestLayer = jiraTicketImporterLayer.pipe(
  Layer.provideMerge(WorkbenchStoreLive),
  Layer.provideMerge(SqlitePersistenceMemory),
);

describe("JiraTicketImporter", () => {
  it.effect("updates Jira fields without changing execution-owned Ticket state", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const workbench = yield* WorkbenchStore;
      const importer = yield* JiraTicketImporter;
      const firstProjectId = ProjectId.make("native-project-1");
      const primaryProjectId = ProjectId.make("native-project-2");
      const projectId = WorkbenchProjectId.make("workspace-1");
      const ticketId = WorkbenchTicketId.make("ticket-1");
      const threadId = ThreadId.make("thread-1");
      const assignmentId = WorkbenchAssignmentId.make("assignment-1");
      const createdAt = "2026-09-03T12:00:00.000Z";

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES
          (
            ${firstProjectId}, 'First Repository', '/repos/first', '[]',
            ${createdAt}, ${createdAt}, NULL
          ),
          (
            ${primaryProjectId}, 'Primary Repository', '/repos/primary', '[]',
            ${createdAt}, ${createdAt}, NULL
          )
      `;
      yield* workbench.createProject({
        id: projectId,
        title: "Jira Workspace",
        linkedProjectIds: [firstProjectId, primaryProjectId],
        createdAt,
      });
      yield* workbench.createTicket({
        id: ticketId,
        projectId,
        title: "Old Jira title",
        kind: "story",
        markdown: "## Agent instructions\n\nKeep this local execution context.",
        primaryT3ProjectId: primaryProjectId,
        repositoryProjectIds: [primaryProjectId, firstProjectId],
        createdAt,
      });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, pending_approval_count, pending_user_input_count,
          has_actionable_proposed_plan, created_at, updated_at, deleted_at
        ) VALUES (
          ${threadId}, ${primaryProjectId}, 'Assigned Agent Thread',
          '{"provider":"codex","model":"gpt-5-codex"}', 'full-access',
          'default', 0, 0, 0, ${createdAt}, ${createdAt}, NULL
        )
      `;
      yield* workbench.createAssignment({ id: assignmentId, ticketId, threadId, createdAt });

      const binding: WorkbenchJiraBinding = {
        id: WorkbenchJiraBindingId.make("binding-1"),
        projectId,
        connectionId: WorkbenchJiraConnectionId.make("connection-1"),
        jiraProjectId: "10000",
        jiraProjectKey: "WB",
        jiraProjectName: "Workbench",
        boardId: 42,
        boardName: "Workbench Board",
        sprintId: 7,
        sprintName: "Sprint 7",
        // Defaults apply only to new imports. Existing execution scope must win.
        defaultPrimaryT3ProjectId: firstProjectId,
        defaultRepositoryProjectIds: [firstProjectId],
        statusMappings: [{ jiraStatusId: "2", workbenchStatus: "in_progress" }],
        selectedSprints: [{ id: 7, name: "Sprint 7" }],
        followActiveSprint: false,
        observedActiveSprintIds: [],
        boardMode: "mapped",
        boardColumns: [],
        active: true,
        lastSyncedAt: null,
        lastSyncError: null,
        createdAt,
        updatedAt: createdAt,
      };

      const importInput = {
        binding,
        existingTicketId: ticketId,
        issue: {
          issueId: "10001",
          key: "WB-1",
          url: "https://example.atlassian.net/browse/WB-1",
          summary: "Fix the Jira synchronization bug",
          description: "Shared Jira description used by the Agent.",
          issueType: { id: "10002", name: "Bug" },
          status: { id: "2", name: "In Progress" },
          epic: { id: "10003", key: "WB-EPIC", summary: "Jira integration" },
          flagged: true,
          rank: 0,
          remoteUpdatedAt: "2026-09-03T13:00:00.000Z",
        },
        mappedStatus: "in_progress" as const,
      };
      const importedTicketId = yield* importer.upsertJiraProjection(importInput);
      const newTicketId = yield* importer.upsertJiraProjection({
        ...importInput,
        existingTicketId: null,
        mappedStatus: "todo",
        issue: { ...importInput.issue, issueId: "10004", key: "WB-4", flagged: false },
      });
      const snapshot = yield* workbench.getSnapshot;
      const ticket = snapshot.tickets.find((candidate) => candidate.id === ticketId);
      const assignment = snapshot.assignments.find((candidate) => candidate.id === assignmentId);
      const epic = snapshot.epics.find((candidate) => candidate.id === "jira:binding-1:epic:10003");

      expect(importedTicketId).toBe(ticketId);
      expect(snapshot.tickets.find((candidate) => candidate.id === newTicketId)?.markdown).toBe(
        "Shared Jira description used by the Agent.",
      );
      expect(ticket).toMatchObject({
        title: "Fix the Jira synchronization bug",
        kind: "bug",
        markdown: "Shared Jira description used by the Agent.",
        primaryT3ProjectId: primaryProjectId,
        repositoryProjectIds: [primaryProjectId, firstProjectId],
        status: "in_progress",
        blocked: true,
        epicId: "jira:binding-1:epic:10003",
      });
      expect(assignment).toMatchObject({ ticketId, threadId, supersededAt: null });
      expect(epic).toMatchObject({ title: "Jira integration", markdown: "", archivedAt: null });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect(
    "preserves concurrent delivery edits when a legacy Jira snapshot has no description",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const workbench = yield* WorkbenchStore;
        const importer = yield* JiraTicketImporter;
        const firstProjectId = ProjectId.make("native-project-1");
        const secondProjectId = ProjectId.make("native-project-2");
        const projectId = WorkbenchProjectId.make("workspace-1");
        const ticketId = WorkbenchTicketId.make("ticket-1");
        const epicId = WorkbenchEpicId.make("jira:binding-1:epic:10003");
        const createdAt = "2026-09-03T12:00:00.000Z";

        yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES
          (
            ${firstProjectId}, 'First Repository', '/repos/first', '[]',
            ${createdAt}, ${createdAt}, NULL
          ),
          (
            ${secondProjectId}, 'Second Repository', '/repos/second', '[]',
            ${createdAt}, ${createdAt}, NULL
          )
      `;
        yield* workbench.createProject({
          id: projectId,
          title: "Jira Workspace",
          linkedProjectIds: [firstProjectId, secondProjectId],
          createdAt,
        });
        yield* workbench.createTicket({
          id: ticketId,
          projectId,
          title: "Original title",
          kind: "story",
          markdown: "Original instructions",
          primaryT3ProjectId: firstProjectId,
          repositoryProjectIds: [firstProjectId],
          createdAt,
        });
        yield* workbench.createEpic({
          id: epicId,
          projectId,
          title: "Original Jira Epic title",
          markdown: "Original Epic instructions",
          createdAt,
        });

        const binding: WorkbenchJiraBinding = {
          id: WorkbenchJiraBindingId.make("binding-1"),
          projectId,
          connectionId: WorkbenchJiraConnectionId.make("connection-1"),
          jiraProjectId: "10000",
          jiraProjectKey: "WB",
          jiraProjectName: "Workbench",
          boardId: 42,
          boardName: "Workbench Board",
          sprintId: 7,
          sprintName: "Sprint 7",
          defaultPrimaryT3ProjectId: firstProjectId,
          defaultRepositoryProjectIds: [firstProjectId],
          statusMappings: [{ jiraStatusId: "2", workbenchStatus: "in_progress" }],
          selectedSprints: [{ id: 7, name: "Sprint 7" }],
          followActiveSprint: false,
          observedActiveSprintIds: [],
          boardMode: "mapped",
          boardColumns: [],
          active: true,
          lastSyncedAt: null,
          lastSyncError: null,
          createdAt,
          updatedAt: createdAt,
        };

        yield* Effect.all(
          [
            importer.upsertJiraProjection({
              binding,
              existingTicketId: ticketId,
              issue: {
                issueId: "10001",
                key: "WB-1",
                url: "https://example.atlassian.net/browse/WB-1",
                summary: "Jira-owned title",
                issueType: { id: "10002", name: "Bug" },
                status: { id: "2", name: "In Progress" },
                epic: { id: "10003", key: "WB-EPIC", summary: "Jira-owned Epic title" },
                flagged: true,
                rank: 0,
                remoteUpdatedAt: "2026-09-03T13:00:00.000Z",
              },
              mappedStatus: "in_progress",
            }),
            workbench.updateTicket({
              id: ticketId,
              epicId: null,
              title: "Concurrent local title",
              kind: "story",
              markdown: "Concurrent local instructions",
              primaryT3ProjectId: secondProjectId,
              repositoryProjectIds: [secondProjectId, firstProjectId],
              status: "todo",
              blocked: false,
              updatedAt: "2026-09-03T14:00:00.000Z",
            }),
            workbench.updateEpic({
              id: epicId,
              title: "Concurrent local Epic title",
              markdown: "Concurrent local Epic instructions",
              updatedAt: "2026-09-03T14:00:00.000Z",
            }),
          ],
          { concurrency: "unbounded" },
        );

        const snapshot = yield* workbench.getSnapshot;
        const ticket = snapshot.tickets.find((candidate) => candidate.id === ticketId);
        const epic = snapshot.epics.find((candidate) => candidate.id === epicId);
        expect(ticket).toMatchObject({
          markdown: "Concurrent local instructions",
          primaryT3ProjectId: secondProjectId,
          repositoryProjectIds: [secondProjectId, firstProjectId],
          updatedAt: "2026-09-03T14:00:00.000Z",
        });
        expect(epic).toMatchObject({
          markdown: "Concurrent local Epic instructions",
          updatedAt: "2026-09-03T14:00:00.000Z",
        });
      }).pipe(Effect.provide(TestLayer)),
  );
});
