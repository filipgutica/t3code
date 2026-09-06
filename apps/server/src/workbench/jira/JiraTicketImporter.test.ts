import {
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchEpicId,
  WorkbenchJiraBindingId,
  WorkbenchJiraConnectionId,
  WorkbenchProjectId,
  WorkbenchSnapshot,
  WorkbenchTicketId,
  type WorkbenchJiraBinding,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "../WorkbenchStore.ts";
import {
  JiraTicketImporter,
  layer as jiraTicketImporterLayer,
} from "@t3tools/workbench/jira/JiraTicketImporter";

const TestLayer = jiraTicketImporterLayer.pipe(
  Layer.provideMerge(WorkbenchStoreLive),
  Layer.provideMerge(SqlitePersistenceMemory),
);
const decodeWorkbenchSnapshot = Schema.decodeUnknownEffect(WorkbenchSnapshot);

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
      const revisionAfterFirstImport = (yield* workbench.getSnapshot).tickets.find(
        (ticket) => ticket.id === ticketId,
      )?.revision;
      yield* importer.upsertJiraProjection(importInput);
      const revisionAfterSecondImport = (yield* workbench.getSnapshot).tickets.find(
        (ticket) => ticket.id === ticketId,
      )?.revision;
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
      expect(revisionAfterSecondImport).toBe(revisionAfterFirstImport);
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

  it.effect("rejects a stale Jira field patch after a local Ticket revision changes", () =>
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

      const expectedRevision = (yield* workbench.getSnapshot).tickets.find(
        (ticket) => ticket.id === ticketId,
      )?.revision;
      if (expectedRevision === undefined) {
        return yield* Effect.die("Ticket revision was not loaded");
      }
      const statusOnly = yield* workbench.updateJiraTicketFields({
        id: ticketId,
        expectedRevision,
        status: "in_progress",
        updatedAt: "2026-09-03T13:00:00.000Z",
      });
      expect(statusOnly).toMatchObject({
        title: "Original title",
        markdown: "Original instructions",
        status: "in_progress",
      });
      yield* workbench.updateTicket({
        id: ticketId,
        expectedRevision: statusOnly.revision,
        epicId: null,
        title: "Concurrent local title",
        kind: "story",
        markdown: "Concurrent local instructions",
        primaryT3ProjectId: secondProjectId,
        repositoryProjectIds: [secondProjectId, firstProjectId],
        status: "todo",
        blocked: false,
        updatedAt: "2026-09-03T14:00:00.000Z",
      });
      const stalePatch = yield* Effect.flip(
        workbench.updateJiraTicketFields({
          id: ticketId,
          expectedRevision,
          title: "Jira-owned title",
          kind: "bug",
          status: "in_progress",
          blocked: true,
          updatedAt: "2026-09-03T13:00:00.000Z",
        }),
      );
      const importedAfterLocalEdit = yield* importer.upsertJiraProjection({
        binding,
        existingTicketId: ticketId,
        issue: {
          issueId: "10001",
          key: "WB-1",
          url: "https://example.atlassian.net/browse/WB-1",
          summary: "Jira-owned title",
          issueType: { id: "10002", name: "Bug" },
          status: { id: "2", name: "In Progress" },
          epic: null,
          flagged: true,
          rank: 0,
          remoteUpdatedAt: "2026-09-03T13:00:00.000Z",
        },
        mappedStatus: "in_progress",
      });
      yield* workbench.updateEpic({
        id: epicId,
        title: "Concurrent local Epic title",
        markdown: "Concurrent local Epic instructions",
        updatedAt: "2026-09-03T14:00:00.000Z",
      });

      const snapshot = yield* workbench.getSnapshot;
      const ticket = snapshot.tickets.find((candidate) => candidate.id === ticketId);
      const epic = snapshot.epics.find((candidate) => candidate.id === epicId);
      expect(ticket).toMatchObject({
        title: "Jira-owned title",
        kind: "bug",
        markdown: "Concurrent local instructions",
        status: "in_progress",
        blocked: true,
        primaryT3ProjectId: secondProjectId,
        repositoryProjectIds: [secondProjectId, firstProjectId],
        updatedAt: "2026-09-03T14:00:00.000Z",
      });
      expect(importedAfterLocalEdit).toBe(ticketId);
      expect(stalePatch.code).toBe("ticket_changed");
      expect(epic).toMatchObject({
        markdown: "Concurrent local Epic instructions",
        updatedAt: "2026-09-03T14:00:00.000Z",
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("bounds Jira issue and Epic titles on create and refresh", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const workbench = yield* WorkbenchStore;
      const importer = yield* JiraTicketImporter;
      const t3ProjectId = ProjectId.make("native-project-long-title");
      const projectId = WorkbenchProjectId.make("workspace-long-title");
      const createdAt = "2026-09-03T12:00:00.000Z";

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          ${t3ProjectId}, 'Long title repository', '/repos/long-title', '[]',
          ${createdAt}, ${createdAt}, NULL
        )
      `;
      yield* workbench.createProject({
        id: projectId,
        title: "Long title workspace",
        linkedProjectIds: [t3ProjectId],
        createdAt,
      });

      const binding: WorkbenchJiraBinding = {
        id: WorkbenchJiraBindingId.make("binding-long-title"),
        projectId,
        connectionId: WorkbenchJiraConnectionId.make("connection-long-title"),
        jiraProjectId: "10000",
        jiraProjectKey: "WB",
        jiraProjectName: "Workbench",
        boardId: 42,
        boardName: "Workbench Board",
        sprintId: 7,
        sprintName: "Sprint 7",
        defaultPrimaryT3ProjectId: t3ProjectId,
        defaultRepositoryProjectIds: [t3ProjectId],
        statusMappings: [],
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
      const firstSummary = "T".repeat(241);
      const firstEpicSummary = "E".repeat(241);
      const ticketId = yield* importer.upsertJiraProjection({
        binding,
        existingTicketId: null,
        issue: {
          issueId: "20001",
          key: "WB-2001",
          url: "https://example.atlassian.net/browse/WB-2001",
          summary: firstSummary,
          description: "A bounded Jira description.",
          issueType: { id: "10001", name: "Story" },
          status: { id: "1", name: "To Do" },
          epic: { id: "30001", key: "WB-EPIC-1", summary: firstEpicSummary },
          flagged: false,
          rank: 0,
          remoteUpdatedAt: "2026-09-03T13:00:00.000Z",
        },
        mappedStatus: "todo",
      });
      const createdSnapshot = yield* decodeWorkbenchSnapshot(yield* workbench.getSnapshot);
      const createdTicket = createdSnapshot.tickets.find((ticket) => ticket.id === ticketId);
      const createdEpic = createdSnapshot.epics.find(
        (epic) => epic.id === "jira:binding-long-title:epic:30001",
      );
      expect(createdTicket?.title).toBe(firstSummary.slice(0, 240));
      expect(createdTicket?.title.length).toBe(240);
      expect(createdEpic?.title).toBe(firstEpicSummary.slice(0, 240));
      expect(createdEpic?.title.length).toBe(240);

      const refreshedSummary = `${"R".repeat(239)}😀refresh`;
      const refreshedEpicSummary = `${"P".repeat(239)}😀refresh`;
      yield* importer.upsertJiraProjection({
        binding,
        existingTicketId: ticketId,
        issue: {
          issueId: "20001",
          key: "WB-2001",
          url: "https://example.atlassian.net/browse/WB-2001",
          summary: refreshedSummary,
          description: "A refreshed bounded Jira description.",
          issueType: { id: "10001", name: "Story" },
          status: { id: "1", name: "To Do" },
          epic: { id: "30001", key: "WB-EPIC-1", summary: refreshedEpicSummary },
          flagged: false,
          rank: 0,
          remoteUpdatedAt: "2026-09-03T14:00:00.000Z",
        },
        mappedStatus: "todo",
      });
      const refreshedSnapshot = yield* decodeWorkbenchSnapshot(yield* workbench.getSnapshot);
      const refreshedTicket = refreshedSnapshot.tickets.find((ticket) => ticket.id === ticketId);
      const refreshedEpic = refreshedSnapshot.epics.find(
        (epic) => epic.id === "jira:binding-long-title:epic:30001",
      );
      expect(refreshedTicket?.title).toBe("R".repeat(239));
      expect(refreshedTicket?.title.length).toBe(239);
      expect(refreshedEpic?.title).toBe("P".repeat(239));
      expect(refreshedEpic?.title.length).toBe(239);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("rejects oversized Jira descriptions before create or refresh persistence", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const workbench = yield* WorkbenchStore;
      const importer = yield* JiraTicketImporter;
      const t3ProjectId = ProjectId.make("native-project-long-description");
      const projectId = WorkbenchProjectId.make("workspace-long-description");
      const createdAt = "2026-09-03T12:00:00.000Z";

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          ${t3ProjectId}, 'Long description repository', '/repos/long-description', '[]',
          ${createdAt}, ${createdAt}, NULL
        )
      `;
      yield* workbench.createProject({
        id: projectId,
        title: "Long description workspace",
        linkedProjectIds: [t3ProjectId],
        createdAt,
      });

      const binding: WorkbenchJiraBinding = {
        id: WorkbenchJiraBindingId.make("binding-long-description"),
        projectId,
        connectionId: WorkbenchJiraConnectionId.make("connection-long-description"),
        jiraProjectId: "10000",
        jiraProjectKey: "WB",
        jiraProjectName: "Workbench",
        boardId: 42,
        boardName: "Workbench Board",
        sprintId: 7,
        sprintName: "Sprint 7",
        defaultPrimaryT3ProjectId: t3ProjectId,
        defaultRepositoryProjectIds: [t3ProjectId],
        statusMappings: [],
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
      const validIssue = {
        issueId: "40001",
        key: "WB-4001",
        url: "https://example.atlassian.net/browse/WB-4001",
        summary: "A valid Jira issue",
        description: "Existing shared description.",
        issueType: { id: "10001", name: "Story" },
        status: { id: "1", name: "To Do" },
        epic: null,
        flagged: false,
        rank: 0,
        remoteUpdatedAt: "2026-09-03T13:00:00.000Z",
      };
      const ticketId = yield* importer.upsertJiraProjection({
        binding,
        existingTicketId: null,
        issue: validIssue,
        mappedStatus: "todo",
      });
      const oversizedDescription = "D".repeat(120_001);

      const createError = yield* Effect.flip(
        importer.upsertJiraProjection({
          binding,
          existingTicketId: null,
          issue: {
            ...validIssue,
            issueId: "40002",
            key: "WB-4002",
            description: oversizedDescription,
          },
          mappedStatus: "todo",
        }),
      );
      expect(createError).toMatchObject({
        code: "persistence_failed",
        message: expect.stringContaining("120000 character limit"),
      });
      const afterCreateFailure = yield* decodeWorkbenchSnapshot(yield* workbench.getSnapshot);
      expect(afterCreateFailure.tickets).toHaveLength(1);
      expect(afterCreateFailure.tickets[0]?.markdown).toBe("Existing shared description.");

      const refreshError = yield* Effect.flip(
        importer.upsertJiraProjection({
          binding,
          existingTicketId: ticketId,
          issue: { ...validIssue, description: oversizedDescription },
          mappedStatus: "todo",
        }),
      );
      expect(refreshError).toMatchObject({
        code: "persistence_failed",
        message: expect.stringContaining("120000 character limit"),
      });
      const afterRefreshFailure = yield* decodeWorkbenchSnapshot(yield* workbench.getSnapshot);
      expect(afterRefreshFailure.tickets).toHaveLength(1);
      expect(afterRefreshFailure.tickets[0]?.markdown).toBe("Existing shared description.");
    }).pipe(Effect.provide(TestLayer)),
  );
});
