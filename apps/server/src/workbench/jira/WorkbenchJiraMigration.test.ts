import {
  ProjectId,
  WorkbenchEpicId,
  WorkbenchJiraBindingId,
  WorkbenchJiraConnectionId,
  WorkbenchJiraOperationError,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchJiraBinding,
} from "@t3tools/contracts";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "../WorkbenchStore.ts";
import { JiraApi, type JiraApiShape } from "@t3tools/workbench/jira/JiraApi";
import { JiraAuthService } from "@t3tools/workbench/jira/JiraAuthService";
import { JiraSyncService } from "@t3tools/workbench/jira/JiraSyncService";
import { JiraTicketWriteService } from "@t3tools/workbench/jira/JiraTicketWriteService";
import {
  WorkbenchJiraRepository,
  type WorkbenchJiraRepositoryShape,
} from "@t3tools/workbench/jira/WorkbenchJiraRepository";
import * as WorkbenchJiraService from "@t3tools/workbench/jira/WorkbenchJiraService";

const TestLayer = WorkbenchStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));
const createdAt = "2026-09-15T12:00:00.000Z";
const nativeProjectId = ProjectId.make("native-project");
const workspaceId = WorkbenchProjectId.make("workspace-1");
const binding: WorkbenchJiraBinding = {
  id: WorkbenchJiraBindingId.make("binding-1"),
  projectId: workspaceId,
  connectionId: WorkbenchJiraConnectionId.make("connection-1"),
  jiraProjectId: "10000",
  jiraProjectKey: "ORBIT",
  jiraProjectName: "Orbit",
  boardId: 42,
  boardName: "Orbit Board",
  sprintId: 7,
  sprintName: "Sprint 7",
  defaultPrimaryT3ProjectId: nativeProjectId,
  defaultRepositoryProjectIds: [nativeProjectId],
  statusMappings: [{ jiraStatusId: "1", workbenchStatus: "todo" }],
  followActiveSprint: false,
  selectedSprints: [{ id: 7, name: "Sprint 7" }],
  observedActiveSprintIds: [],
  boardMode: "mapped",
  boardColumns: [],
  active: true,
  lastSyncedAt: null,
  lastSyncError: null,
  createdAt,
  updatedAt: createdAt,
};

const makeRepository = (): WorkbenchJiraRepository["Service"] =>
  WorkbenchJiraRepository.of({
    findConnectionByCloudId: () => Effect.succeed(Option.none()),
    getConnection: () => Effect.succeed(Option.none()),
    listConnections: () => Effect.succeed([]),
    getCredentialId: () => Effect.succeed(Option.none()),
    upsertConnection: () => Effect.void,
    upsertConnections: () => Effect.void,
    getBinding: (id) => Effect.succeed(id === binding.id ? Option.some(binding) : Option.none()),
    listBindings: () => Effect.succeed([binding]),
    upsertBinding: () => Effect.void,
    updateBindingSyncMetadata: () => Effect.succeed(true),
    updateBindingSyncError: () => Effect.succeed(true),
    listIssueLinks: () => Effect.succeed([]),
    replaceIssueLinks: () => Effect.void,
  } satisfies WorkbenchJiraRepositoryShape);

const makeService = ({
  writer,
  creates,
  prepareEpicCreation = () => Effect.succeed({ issueTypeId: "epic", accountId: "account-1" }),
  onEpicCreate = () => Effect.void,
  repository = makeRepository(),
  beforeBindingPermit = Effect.void,
}: {
  writer: JiraTicketWriteService["Service"];
  creates: Ref.Ref<number>;
  prepareEpicCreation?: NonNullable<JiraApiShape["prepareEpicCreation"]>;
  onEpicCreate?: () => Effect.Effect<void>;
  repository?: WorkbenchJiraRepository["Service"];
  beforeBindingPermit?: Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const api = JiraApi.of({
      listProjects: () => Effect.die("unexpected project read"),
      listBoards: () => Effect.die("unexpected board read"),
      listSprints: () => Effect.die("unexpected sprint read"),
      getBoardConfiguration: () => Effect.die("unexpected board read"),
      listAssignedSprintIssues: () => Effect.die("unexpected issue read"),
      prepareIssueCreation: () => Effect.die("unexpected ticket metadata read"),
      prepareEpicCreation,
      createIssue: ({ ticket }) =>
        Ref.update(creates, (count) => count + 1).pipe(
          Effect.andThen(onEpicCreate()),
          Effect.as({ id: `remote-${ticket.id}`, key: `ORBIT-${ticket.id}` }),
        ),
      addIssueToSprint: () => Effect.die("unexpected sprint update"),
    });
    const auth = JiraAuthService.of({
      begin: () => Effect.die("unexpected auth start"),
      complete: () => Effect.die("unexpected auth completion"),
      getAccessToken: () => Effect.die("unexpected token read"),
    });
    const sync = JiraSyncService.of({
      withBindingPermit: (_bindingId, effect) => beforeBindingPermit.pipe(Effect.andThen(effect)),
      syncBinding: () => Effect.die("unexpected Jira synchronization"),
    });
    return yield* WorkbenchJiraService.make.pipe(
      Effect.provideService(WorkbenchJiraRepository, repository),
      Effect.provideService(JiraApi, api),
      Effect.provideService(JiraAuthService, auth),
      Effect.provideService(JiraSyncService, sync),
      Effect.provideService(JiraTicketWriteService, writer),
    );
  });

const seedLocalData = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const workbench = yield* WorkbenchStore;
  // The repository is mocked in these unit tests, so no binding row is needed
  // to exercise the migration's local and ledger behavior.
  yield* sql`PRAGMA foreign_keys = OFF`;
  yield* sql`
    INSERT INTO projection_projects (
      project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
    ) VALUES (${nativeProjectId}, 'Orbit Repo', '/repos/orbit', '[]', ${createdAt}, ${createdAt}, NULL)
  `;
  yield* workbench.createProject({
    id: workspaceId,
    title: "Orbit",
    linkedProjectIds: [nativeProjectId],
    createdAt,
  });
  const epic = yield* workbench.createEpic({
    id: WorkbenchEpicId.make("local-epic"),
    projectId: workspaceId,
    title: "Local Epic",
    markdown: "Local Epic details",
    createdAt,
  });
  const ticket = yield* workbench.createTicket({
    id: WorkbenchTicketId.make("local-ticket"),
    projectId: workspaceId,
    epicId: epic.id,
    title: "Local Ticket",
    kind: "story",
    markdown: "Local Ticket details",
    primaryT3ProjectId: nativeProjectId,
    repositoryProjectIds: [nativeProjectId],
    createdAt,
  });
  return { epic, ticket };
});

describe("WorkbenchJiraService local migration", () => {
  it.effect(
    "deletes confirmed Tickets and Epics while retaining the Ticket Thread reservation",
    () =>
      Effect.gen(function* () {
        const workbench = yield* WorkbenchStore;
        const creates = yield* Ref.make(0);
        const writer = JiraTicketWriteService.of({
          createTicket: () => Effect.die("unexpected Jira Ticket creation"),
          getTicketTransitions: () => Effect.die("unexpected Jira transition lookup"),
          updateTicket: () => Effect.die("unexpected Jira Ticket write"),
          startTicketExecution: () => Effect.die("unexpected Jira execution"),
        });
        const service = yield* makeService({ writer, creates });
        const { epic, ticket } = yield* seedLocalData;
        const result = yield* service.migrateLocalTickets({
          bindingId: binding.id,
          action: "delete",
          tickets: [{ id: ticket.id, revision: ticket.revision }],
          epics: [{ id: epic.id, updatedAt: epic.updatedAt }],
        });
        const snapshot = yield* workbench.getSnapshot;
        expect(result.deletedTicketCount).toBe(1);
        expect(result.deletedEpicCount).toBe(1);
        expect(snapshot.tickets).toEqual([]);
        expect(snapshot.epics).toEqual([]);
        expect(yield* Ref.get(creates)).toBe(0);
      }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("deletes a local Epic whose child Ticket was already deleted", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const workbench = yield* WorkbenchStore;
      const creates = yield* Ref.make(0);
      const writer = JiraTicketWriteService.of({
        createTicket: () => Effect.die("unexpected Jira Ticket creation"),
        getTicketTransitions: () => Effect.die("unexpected Jira transition lookup"),
        updateTicket: () => Effect.die("unexpected Jira Ticket write"),
        startTicketExecution: () => Effect.die("unexpected Jira execution"),
      });
      const service = yield* makeService({ writer, creates });
      const { epic, ticket } = yield* seedLocalData;
      yield* workbench.deleteTicket({
        ticketId: ticket.id,
        expectedRevision: ticket.revision,
        deletedAt: createdAt,
      });
      const result = yield* service.migrateLocalTickets({
        bindingId: binding.id,
        action: "delete",
        tickets: [],
        epics: [{ id: epic.id, updatedAt: epic.updatedAt }],
      });
      expect(result.deletedEpicCount).toBe(1);
      expect(result.deletedTicketCount).toBe(0);
      expect((yield* workbench.getSnapshot).epics).toEqual([]);
      expect(
        yield* sql`SELECT epic_id, deleted_at FROM workbench_tickets WHERE ticket_id = ${ticket.id}`,
      ).toEqual([{ epic_id: null, deleted_at: createdAt }]);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  for (const change of ["paused", "connection", "project"] as const) {
    it.effect(
      `refuses Epic publication when the binding is ${change} before acquiring its permit`,
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const creates = yield* Ref.make(0);
          const writer = JiraTicketWriteService.of({
            createTicket: () => Effect.die("unexpected Jira Ticket creation"),
            getTicketTransitions: () => Effect.die("unexpected Jira transition lookup"),
            updateTicket: () => Effect.die("unexpected Jira Ticket write"),
            startTicketExecution: () => Effect.die("unexpected Jira execution"),
          });
          const current = yield* Ref.make(binding);
          const service = yield* makeService({
            writer,
            creates,
            repository: {
              ...makeRepository(),
              getBinding: () => Ref.get(current).pipe(Effect.map(Option.some)),
            },
            beforeBindingPermit: Ref.set(current, {
              ...binding,
              ...(change === "paused"
                ? { active: false }
                : change === "connection"
                  ? { connectionId: WorkbenchJiraConnectionId.make("connection-2") }
                  : { jiraProjectKey: "OTHER" }),
            }),
          });
          const { epic } = yield* seedLocalData;
          const error = yield* Effect.flip(
            service.migrateLocalTickets({
              bindingId: binding.id,
              action: "publish",
              tickets: [],
              epics: [{ id: epic.id, updatedAt: epic.updatedAt }],
            }),
          );
          expect(error.code).toBe(change === "paused" ? "binding_inactive" : "invalid_binding");
          expect(yield* Ref.get(creates)).toBe(0);
          expect(yield* sql`SELECT * FROM workbench_jira_epic_creations`).toEqual([]);
        }).pipe(Effect.scoped, Effect.provide(TestLayer)),
    );
  }

  it.effect("rolls back earlier local deletes when a later Ticket revision conflicts", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const workbench = yield* WorkbenchStore;
      const creates = yield* Ref.make(0);
      const writer = JiraTicketWriteService.of({
        createTicket: () => Effect.die("unexpected Jira Ticket creation"),
        getTicketTransitions: () => Effect.die("unexpected Jira transition lookup"),
        updateTicket: () => Effect.die("unexpected Jira Ticket write"),
        startTicketExecution: () => Effect.die("unexpected Jira execution"),
      });
      const service = yield* makeService({ writer, creates });
      const { epic, ticket } = yield* seedLocalData;
      const laterTicket = yield* workbench.createTicket({
        id: WorkbenchTicketId.make("local-ticket-2"),
        projectId: workspaceId,
        epicId: epic.id,
        title: "Second local Ticket",
        kind: "story",
        markdown: "Second local Ticket details",
        primaryT3ProjectId: nativeProjectId,
        repositoryProjectIds: [nativeProjectId],
        createdAt,
      });

      // Simulate a concurrent edit after the first deletion succeeds. The
      // trigger fires only for the first Ticket, so the second deletion sees
      // a revision conflict and the outer migration transaction must roll back.
      yield* sql`
        CREATE TRIGGER bump_later_ticket_revision
        AFTER UPDATE OF deleted_at ON workbench_tickets
        WHEN NEW.ticket_id = 'local-ticket'
        BEGIN
          UPDATE workbench_tickets
          SET revision = revision + 1,
              updated_at = '2026-09-15T12:01:00.000Z'
          WHERE ticket_id = 'local-ticket-2';
        END
      `;

      const error = yield* Effect.flip(
        service.migrateLocalTickets({
          bindingId: binding.id,
          action: "delete",
          tickets: [
            { id: ticket.id, revision: ticket.revision },
            { id: laterTicket.id, revision: laterTicket.revision },
          ],
          epics: [{ id: epic.id, updatedAt: epic.updatedAt }],
        }),
      );

      expect(error.message).toContain("changed");
      const snapshot = yield* workbench.getSnapshot;
      expect(snapshot.tickets.map((entry) => entry.id)).toEqual([ticket.id, laterTicket.id]);
      expect(snapshot.tickets.every((entry) => entry.archivedAt === null)).toBe(true);
      expect(snapshot.epics.map((entry) => entry.id)).toEqual([epic.id]);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("rolls back Ticket deletion when the selected Epic changes before deletion", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const workbench = yield* WorkbenchStore;
      const creates = yield* Ref.make(0);
      const writer = JiraTicketWriteService.of({
        createTicket: () => Effect.die("unexpected Jira Ticket creation"),
        getTicketTransitions: () => Effect.die("unexpected Jira transition lookup"),
        updateTicket: () => Effect.die("unexpected Jira Ticket write"),
        startTicketExecution: () => Effect.die("unexpected Jira execution"),
      });
      const service = yield* makeService({ writer, creates });
      const { epic, ticket } = yield* seedLocalData;

      // The Ticket delete happens before the raw Epic delete. Make that
      // mutation invalidate the Epic CAS so the outer transaction must roll
      // both records back when the affected-row check fails.
      yield* sql`
        CREATE TRIGGER bump_selected_epic_updated_at
        AFTER UPDATE OF deleted_at ON workbench_tickets
        WHEN NEW.ticket_id = 'local-ticket'
        BEGIN
          UPDATE workbench_epics
          SET updated_at = '2026-09-15T12:01:00.000Z'
          WHERE epic_id = 'local-epic';
        END
      `;

      const error = yield* Effect.flip(
        service.migrateLocalTickets({
          bindingId: binding.id,
          action: "delete",
          tickets: [{ id: ticket.id, revision: ticket.revision }],
          epics: [{ id: epic.id, updatedAt: epic.updatedAt }],
        }),
      );

      expect(error.message).toContain("Local Epic");
      const snapshot = yield* workbench.getSnapshot;
      expect(snapshot.tickets).toHaveLength(1);
      expect(snapshot.tickets[0]?.archivedAt).toBeNull();
      expect(snapshot.epics).toEqual([epic]);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("rejects a stale Ticket snapshot before any remote write", () =>
    Effect.gen(function* () {
      const creates = yield* Ref.make(0);
      const writer = JiraTicketWriteService.of({
        createTicket: () =>
          Ref.update(creates, (count) => count + 1).pipe(
            Effect.as(WorkbenchTicketId.make("local-ticket")),
          ),
        getTicketTransitions: () => Effect.die("unexpected Jira transition lookup"),
        updateTicket: () => Effect.die("unexpected Jira Ticket write"),
        startTicketExecution: () => Effect.die("unexpected Jira execution"),
      });
      const service = yield* makeService({ writer, creates });
      const { ticket } = yield* seedLocalData;
      const error = yield* Effect.flip(
        service.migrateLocalTickets({
          bindingId: binding.id,
          action: "publish",
          tickets: [{ id: ticket.id, revision: ticket.revision + 1 }],
          epics: [],
        }),
      );
      assert(error._tag === "WorkbenchJiraOperationError");
      expect(error.message).toContain("changed");
      expect(yield* Ref.get(creates)).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("rechecks the Epic after Jira metadata preparation", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const creates = yield* Ref.make(0);
      const writer = JiraTicketWriteService.of({
        createTicket: () => Effect.die("unexpected Jira Ticket creation"),
        getTicketTransitions: () => Effect.die("unexpected Jira transition lookup"),
        updateTicket: () => Effect.die("unexpected Jira Ticket write"),
        startTicketExecution: () => Effect.die("unexpected Jira execution"),
      });
      const prepareEpicCreation: NonNullable<JiraApiShape["prepareEpicCreation"]> = () =>
        sql`
          UPDATE workbench_epics
          SET title = 'Edited while Jira metadata loaded',
              updated_at = '2026-09-15T12:01:00.000Z'
          WHERE epic_id = 'local-epic'
        `.pipe(
          Effect.mapError(
            () =>
              new WorkbenchJiraOperationError({
                code: "persistence_failed",
                message: "Test Epic update failed.",
              }),
          ),
          Effect.as({ issueTypeId: "epic", accountId: "account-1" }),
        );
      const service = yield* makeService({ writer, creates, prepareEpicCreation });
      const { epic, ticket } = yield* seedLocalData;
      const error = yield* Effect.flip(
        service.migrateLocalTickets({
          bindingId: binding.id,
          action: "publish",
          tickets: [{ id: ticket.id, revision: ticket.revision }],
          epics: [{ id: epic.id, updatedAt: epic.updatedAt }],
        }),
      );

      assert(error._tag === "WorkbenchJiraOperationError");
      expect(error.message).toContain("Local Epic");
      expect(yield* Ref.get(creates)).toBe(0);
      const rows = yield* sql`SELECT * FROM workbench_jira_epic_creations`;
      expect(rows).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("records the remote Epic before rejecting a post-create local edit", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const creates = yield* Ref.make(0);
      const writer = JiraTicketWriteService.of({
        createTicket: () => Effect.die("unexpected Jira Ticket creation"),
        getTicketTransitions: () => Effect.die("unexpected Jira transition lookup"),
        updateTicket: () => Effect.die("unexpected Jira Ticket write"),
        startTicketExecution: () => Effect.die("unexpected Jira execution"),
      });
      const onEpicCreate: () => Effect.Effect<void, never> = () =>
        sql`
          UPDATE workbench_epics
          SET title = 'Edited after Jira accepted the Epic',
              updated_at = '2026-09-15T12:01:00.000Z'
          WHERE epic_id = 'local-epic'
        `.pipe(Effect.orDie, Effect.asVoid);
      const service = yield* makeService({ writer, creates, onEpicCreate });
      const { epic, ticket } = yield* seedLocalData;
      const error = yield* Effect.flip(
        service.migrateLocalTickets({
          bindingId: binding.id,
          action: "publish",
          tickets: [{ id: ticket.id, revision: ticket.revision }],
          epics: [{ id: epic.id, updatedAt: epic.updatedAt }],
        }),
      );

      assert(error._tag === "WorkbenchJiraOperationError");
      expect(error.message).toContain("changed while Jira was creating it");
      expect(yield* Ref.get(creates)).toBe(1);
      const creation = yield* sql<{
        readonly jiraIssueId: string | null;
        readonly state: string;
      }>`
        SELECT jira_issue_id AS "jiraIssueId", state
        FROM workbench_jira_epic_creations
        WHERE epic_id = ${epic.id}
      `;
      expect(creation).toEqual([{ jiraIssueId: `remote-${epic.id}`, state: "created" }]);
      expect(yield* sql`SELECT * FROM workbench_jira_epic_links`).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("treats a locally identified migrated Epic as Jira-owned", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const workbench = yield* WorkbenchStore;
      const { epic } = yield* seedLocalData;
      yield* sql`
        INSERT INTO workbench_jira_bindings (
          binding_id, workbench_project_id, connection_id, jira_project_id,
          jira_project_key, jira_project_name, board_id, board_name, sprint_id,
          sprint_name, default_primary_t3_project_id, default_repository_project_ids_json,
          status_mappings_json, active, created_at, updated_at
        ) VALUES (
          ${binding.id}, ${workspaceId}, ${binding.connectionId}, ${binding.jiraProjectId},
          ${binding.jiraProjectKey}, ${binding.jiraProjectName}, ${binding.boardId},
          ${binding.boardName}, ${binding.sprintId}, ${binding.sprintName},
          ${nativeProjectId}, '["native-project"]', '[{"jiraStatusId":"1","workbenchStatus":"todo"}]',
          1, ${createdAt}, ${createdAt}
        )
      `;
      yield* sql`
        INSERT INTO workbench_jira_epic_links
          (binding_id, jira_issue_id, jira_issue_key, epic_id)
        VALUES (${binding.id}, 'remote-epic', 'ORBIT-42', ${epic.id})
      `;
      const canonicalEpic = yield* workbench.createEpic({
        id: WorkbenchEpicId.make("jira:binding-1:epic:remote-canonical-epic"),
        projectId: workspaceId,
        title: "Canonical Jira Epic",
        markdown: "Canonical Jira Epic details",
        createdAt,
      });

      const updated = yield* workbench.updateEpic({
        id: epic.id,
        title: "Local edit should be ignored",
        markdown: "Jira-owned markdown",
        updatedAt: "2026-09-15T12:01:00.000Z",
      });

      expect(updated.title).toBe(epic.title);
      expect(updated.markdown).toBe("Jira-owned markdown");
      const updatedCanonical = yield* workbench.updateEpic({
        id: canonicalEpic.id,
        title: "Canonical local edit should be ignored",
        markdown: "Canonical Jira-owned markdown",
        updatedAt: "2026-09-15T12:01:00.000Z",
      });

      expect(updatedCanonical.title).toBe(canonicalEpic.title);
      expect(updatedCanonical.markdown).toBe("Canonical Jira-owned markdown");
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("reuses completed Tickets and already-managed Epic parents on publish retry", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const workbench = yield* WorkbenchStore;
      const creates = yield* Ref.make(0);
      const inputs = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([]);
      const writer = JiraTicketWriteService.of({
        createTicket: (input) =>
          Ref.update(inputs, (current) => [...current, input]).pipe(Effect.as(input.id)),
        getTicketTransitions: () => Effect.die("unexpected Jira transition lookup"),
        updateTicket: () => Effect.die("unexpected Jira Ticket write"),
        startTicketExecution: () => Effect.die("unexpected Jira execution"),
      });
      const service = yield* makeService({ writer, creates });
      const { epic, ticket } = yield* seedLocalData;
      const canonicalEpic = yield* workbench.createEpic({
        id: WorkbenchEpicId.make("jira:binding-1:epic:remote-canonical-epic"),
        projectId: workspaceId,
        title: "Canonical Jira Epic",
        markdown: "Canonical Jira Epic details",
        createdAt,
      });
      const mappedTicket = yield* workbench.createTicket({
        id: WorkbenchTicketId.make("local-ticket-2"),
        projectId: workspaceId,
        epicId: epic.id,
        title: "Mapped parent Ticket",
        kind: "story",
        markdown: "Mapped parent Ticket details",
        primaryT3ProjectId: nativeProjectId,
        repositoryProjectIds: [nativeProjectId],
        createdAt,
      });
      const canonicalTicket = yield* workbench.createTicket({
        id: WorkbenchTicketId.make("local-ticket-3"),
        projectId: workspaceId,
        epicId: canonicalEpic.id,
        title: "Canonical parent Ticket",
        kind: "story",
        markdown: "Canonical parent Ticket details",
        primaryT3ProjectId: nativeProjectId,
        repositoryProjectIds: [nativeProjectId],
        createdAt,
      });
      yield* workbench.updateTicket({
        id: ticket.id,
        expectedRevision: ticket.revision,
        epicId: ticket.epicId,
        title: ticket.title,
        kind: ticket.kind,
        markdown: ticket.markdown,
        primaryT3ProjectId: ticket.primaryT3ProjectId,
        repositoryProjectIds: ticket.repositoryProjectIds,
        status: ticket.status,
        blocked: ticket.blocked,
        updatedAt: "2026-09-15T12:01:00.000Z",
      });
      yield* sql`
        INSERT INTO workbench_jira_ticket_creations (
          ticket_id, binding_id, title, kind, markdown, jira_issue_id, jira_issue_key,
          request_fingerprint, result_ticket_id, state, created_at, updated_at
        ) VALUES (
          ${ticket.id}, ${binding.id}, ${ticket.title}, ${ticket.kind}, ${ticket.markdown},
          'remote-ticket-1', 'ORBIT-1', 'completed-ticket-fingerprint', ${ticket.id},
          'created', ${createdAt}, ${createdAt}
        )
      `;
      yield* sql`
        INSERT INTO workbench_jira_epic_links
          (binding_id, jira_issue_id, jira_issue_key, epic_id)
        VALUES (${binding.id}, 'remote-epic', 'ORBIT-42', ${epic.id})
      `;

      const result = yield* service.migrateLocalTickets({
        bindingId: binding.id,
        action: "publish",
        tickets: [
          { id: ticket.id, revision: ticket.revision },
          { id: mappedTicket.id, revision: mappedTicket.revision },
          { id: canonicalTicket.id, revision: canonicalTicket.revision },
        ],
        epics: [],
      });
      const createdInputs = yield* Ref.get(inputs);

      expect(result.publishedTicketCount).toBe(3);
      expect(result.publishedEpicCount).toBe(0);
      expect(createdInputs).toHaveLength(2);
      expect(createdInputs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: mappedTicket.id,
            remoteEpicIssueId: "remote-epic",
          }),
          expect.objectContaining({
            id: canonicalTicket.id,
            remoteEpicIssueId: "remote-canonical-epic",
          }),
        ]),
      );
      expect(yield* Ref.get(creates)).toBe(0);

      const completedTicketDeleteError = yield* Effect.flip(
        service.migrateLocalTickets({
          bindingId: binding.id,
          action: "delete",
          tickets: [{ id: ticket.id, revision: ticket.revision + 1 }],
          epics: [],
        }),
      );
      expect(completedTicketDeleteError.message).toContain("Jira");
      const managedEpicDeleteError = yield* Effect.flip(
        service.migrateLocalTickets({
          bindingId: binding.id,
          action: "delete",
          tickets: [],
          epics: [{ id: epic.id, updatedAt: epic.updatedAt }],
        }),
      );
      expect(managedEpicDeleteError.message).toContain("Jira");
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("publishes local IDs with their Epic and selected sprint", () =>
    Effect.gen(function* () {
      const creates = yield* Ref.make(0);
      const inputs = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([]);
      const writer = JiraTicketWriteService.of({
        createTicket: (input) =>
          Ref.update(inputs, (current) => [...current, input]).pipe(Effect.as(input.id)),
        getTicketTransitions: () => Effect.die("unexpected Jira transition lookup"),
        updateTicket: () => Effect.die("unexpected Jira Ticket write"),
        startTicketExecution: () => Effect.die("unexpected Jira execution"),
      });
      const service = yield* makeService({ writer, creates });
      const { epic, ticket } = yield* seedLocalData;
      const result = yield* service.migrateLocalTickets({
        bindingId: binding.id,
        action: "publish",
        tickets: [{ id: ticket.id, revision: ticket.revision }],
        epics: [{ id: epic.id, updatedAt: epic.updatedAt }],
      });
      const [input] = yield* Ref.get(inputs);
      expect(result.publishedTicketCount).toBe(1);
      expect(result.publishedEpicCount).toBe(1);
      expect(input).toMatchObject({
        id: ticket.id,
        existingLocalTicketRevision: ticket.revision,
        jiraSprintId: binding.sprintId,
        remoteEpicIssueId: `remote-${epic.id}`,
      });
      expect(yield* Ref.get(creates)).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
});
