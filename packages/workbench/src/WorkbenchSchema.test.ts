import { parseJiraIssueUrl } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { ensureWorkbenchSchema } from "./WorkbenchSchema.ts";

const now = "2026-10-20T10:00:00.000Z";
const later = "2026-10-21T10:00:00.000Z";
const site = "https://acme.atlassian.net/";
const browse = (key: string) => `https://acme.atlassian.net/browse/${key}`;
const issueJson = (key: string, epic?: { readonly id: string; readonly key: string }) =>
  JSON.stringify({ key, url: browse(key), ...(epic ? { epic } : {}) });

const withForeignKeys = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA foreign_keys = ON`;
    return yield* effect;
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })));

const jiraSchemaObjects = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE name LIKE '%jira%' ORDER BY name
  `;
});

const expectForeignKeysIntact = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  expect(yield* sql`PRAGMA foreign_key_check`).toEqual([]);
});

/** The v19 Jira tables exactly as the last release that owned them created them. */
const createV19JiraTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE workbench_jira_connections (
    connection_id TEXT PRIMARY KEY, cloud_id TEXT NOT NULL UNIQUE, credential_id TEXT NOT NULL,
    site_name TEXT NOT NULL, site_url TEXT NOT NULL, avatar_url TEXT, scopes_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
  yield* sql`CREATE TABLE workbench_jira_bindings (
    binding_id TEXT PRIMARY KEY, workbench_project_id TEXT NOT NULL UNIQUE,
    connection_id TEXT NOT NULL, jira_project_id TEXT NOT NULL, jira_project_key TEXT NOT NULL,
    jira_project_name TEXT NOT NULL, board_id INTEGER NOT NULL, board_name TEXT NOT NULL,
    sprint_id INTEGER NOT NULL, sprint_name TEXT NOT NULL,
    default_primary_t3_project_id TEXT NOT NULL, default_repository_project_ids_json TEXT NOT NULL,
    status_mappings_json TEXT NOT NULL, follow_active_sprint INTEGER NOT NULL DEFAULT 1,
    selected_sprints_json TEXT NOT NULL DEFAULT '[]',
    observed_active_sprint_ids_json TEXT NOT NULL DEFAULT '[]',
    board_mode TEXT NOT NULL DEFAULT 'mapped', board_columns_json TEXT NOT NULL DEFAULT '[]',
    local_migration_pending INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL,
    last_synced_at TEXT, last_sync_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (workbench_project_id) REFERENCES workbench_projects(project_id) ON DELETE CASCADE,
    FOREIGN KEY (connection_id) REFERENCES workbench_jira_connections(connection_id) ON DELETE CASCADE)`;
  yield* sql`CREATE TABLE workbench_jira_issue_links (
    binding_id TEXT NOT NULL, jira_issue_id TEXT NOT NULL, ticket_id TEXT NOT NULL,
    issue_json TEXT NOT NULL, active INTEGER NOT NULL, linked_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL, PRIMARY KEY (binding_id, jira_issue_id),
    FOREIGN KEY (binding_id) REFERENCES workbench_jira_bindings(binding_id) ON DELETE CASCADE,
    FOREIGN KEY (ticket_id) REFERENCES workbench_tickets(ticket_id) ON DELETE CASCADE)`;
  yield* sql`CREATE TABLE workbench_jira_ticket_creations (
    ticket_id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL,
    markdown TEXT NOT NULL, jira_issue_id TEXT, jira_issue_key TEXT,
    request_fingerprint TEXT NOT NULL DEFAULT '', result_ticket_id TEXT,
    state TEXT NOT NULL CHECK (state IN ('pending', 'uncertain', 'created')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (binding_id) REFERENCES workbench_jira_bindings(binding_id) ON DELETE CASCADE)`;
  yield* sql`CREATE TABLE workbench_jira_epic_creations (
    epic_id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, title TEXT NOT NULL,
    markdown TEXT NOT NULL, jira_issue_id TEXT, jira_issue_key TEXT,
    request_fingerprint TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL CHECK (state IN ('pending', 'uncertain', 'created')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (binding_id) REFERENCES workbench_jira_bindings(binding_id) ON DELETE CASCADE)`;
  yield* sql`CREATE TABLE workbench_jira_epic_links (
    binding_id TEXT NOT NULL, jira_issue_id TEXT NOT NULL, jira_issue_key TEXT NOT NULL,
    epic_id TEXT NOT NULL, PRIMARY KEY (binding_id, jira_issue_id),
    FOREIGN KEY (binding_id) REFERENCES workbench_jira_bindings(binding_id) ON DELETE CASCADE,
    FOREIGN KEY (epic_id) REFERENCES workbench_epics(epic_id) ON DELETE CASCADE)`;
  yield* sql`CREATE INDEX idx_workbench_jira_issue_links_ticket
    ON workbench_jira_issue_links(ticket_id, active)`;
});

/** Rewinds a current database to v19, the last schema with Workbench-owned Jira state. */
const rewindToV19 = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM workbench_schema_migrations WHERE version = 20`;
  for (const table of ["workbench_tickets", "workbench_epics"]) {
    yield* sql`ALTER TABLE ${sql(table)} DROP COLUMN jira_issue_key`;
    yield* sql`ALTER TABLE ${sql(table)} DROP COLUMN jira_issue_url`;
  }
  yield* createV19JiraTables;
});

const insertTicket = (ticket: {
  readonly id: string;
  readonly status: string;
  readonly title?: string;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO workbench_tickets (ticket_id, workbench_project_id, title, kind, markdown,
        primary_t3_project_id, status, blocked, revision, created_at, updated_at)
      VALUES (${ticket.id}, 'workspace', ${ticket.title ?? `Title ${ticket.id}`}, 'story',
        ${`Body ${ticket.id}`}, 'native', ${ticket.status}, 0, 3, ${now}, ${now})`;
  });

const seedV19 = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO workbench_projects (project_id, title, created_at, updated_at)
    VALUES ('workspace', 'Workspace', ${now}, ${now})`;
  yield* sql`INSERT INTO workbench_jira_connections (connection_id, cloud_id, credential_id,
      site_name, site_url, scopes_json, created_at, updated_at)
    VALUES ('connection', 'cloud', 'credential', 'Acme', ${site}, '[]', ${now}, ${now})`;
  yield* sql`INSERT INTO workbench_jira_bindings (binding_id, workbench_project_id, connection_id,
      jira_project_id, jira_project_key, jira_project_name, board_id, board_name, sprint_id,
      sprint_name, default_primary_t3_project_id, default_repository_project_ids_json,
      status_mappings_json, active, created_at, updated_at)
    VALUES ('binding', 'workspace', 'connection', '10000', 'ORBIT', 'Orbit', 1, 'Board', 3,
      'Sprint 3', 'native', '["native","docs"]', '[]', 1, ${now}, ${now})`;

  // Imported Tickets: an active link beats a newer inactive one; otherwise the newest wins.
  yield* insertTicket({ id: "jira:binding:issue:1", status: "in_progress" });
  yield* insertTicket({ id: "jira:binding:issue:2", status: "done" });
  const link = (input: {
    readonly issueId: string;
    readonly ticketId: string;
    readonly key: string;
    readonly active: number;
    readonly lastSeenAt: string;
    readonly epic?: { readonly id: string; readonly key: string };
  }) => sql`INSERT INTO workbench_jira_issue_links (binding_id, jira_issue_id, ticket_id,
      issue_json, active, linked_at, last_seen_at)
    VALUES ('binding', ${input.issueId}, ${input.ticketId}, ${issueJson(input.key, input.epic)},
      ${input.active}, ${now}, ${input.lastSeenAt})`;
  yield* link({
    issueId: "1",
    ticketId: "jira:binding:issue:1",
    key: "ORBIT-1",
    active: 1,
    lastSeenAt: now,
    // Sprint sync recorded an imported Epic's key only on its child issues.
    epic: { id: "20", key: "ORBIT-20" },
  });
  yield* link({
    issueId: "101",
    ticketId: "jira:binding:issue:1",
    key: "ORBIT-101",
    active: 0,
    lastSeenAt: later,
  });
  yield* link({
    issueId: "2",
    ticketId: "jira:binding:issue:2",
    key: "ORBIT-2",
    active: 0,
    lastSeenAt: later,
  });
  yield* link({
    issueId: "102",
    ticketId: "jira:binding:issue:2",
    key: "ORBIT-102",
    active: 0,
    lastSeenAt: now,
  });

  // A published local Ticket, and a creation whose result reused another Ticket.
  yield* insertTicket({ id: "published", status: "in_progress" });
  yield* insertTicket({ id: "reused", status: "todo" });
  const creation = (input: {
    readonly ticketId: string;
    readonly key: string | null;
    readonly state: string;
    readonly resultTicketId?: string;
    readonly fingerprint?: string;
  }) => sql`INSERT INTO workbench_jira_ticket_creations (ticket_id, binding_id, title, kind,
      markdown, jira_issue_key, request_fingerprint, result_ticket_id, state, created_at, updated_at)
    VALUES (${input.ticketId}, 'binding', ${`Requested ${input.ticketId}`}, 'bug',
      ${`Request body ${input.ticketId}`}, ${input.key}, ${input.fingerprint ?? ""},
      ${input.resultTicketId ?? null}, ${input.state}, ${now}, ${later})`;
  yield* creation({
    ticketId: "published",
    key: "ORBIT-3",
    state: "created",
    resultTicketId: "published",
  });
  yield* creation({
    ticketId: "draft-reused",
    key: "ORBIT-4",
    state: "created",
    resultTicketId: "reused",
  });
  // Reservations whose local Ticket never appeared.
  yield* creation({
    ticketId: "reserved-pending",
    key: null,
    state: "pending",
    // The request named its Epic by Jira issue ID or by local Epic ID.
    fingerprint: JSON.stringify({
      primaryT3ProjectId: "docs",
      repositoryProjectIds: ["docs", "native"],
      epicId: "10",
    }),
  });
  yield* creation({
    ticketId: "reserved-uncertain",
    key: null,
    state: "uncertain",
    fingerprint: JSON.stringify({ epicId: "local-epic" }),
  });
  yield* creation({ ticketId: "reserved-created", key: "ORBIT-5", state: "created" });

  // Epics: two Jira Epics, a published local Epic, and a reservation without a local Epic.
  for (const id of ["jira:binding:epic:10", "jira:binding:epic:20", "local-epic"]) {
    yield* sql`INSERT INTO workbench_epics (epic_id, workbench_project_id, title, markdown,
        archived_at, created_at, updated_at)
      VALUES (${id}, 'workspace', ${`Epic ${id}`}, ${`Epic body ${id}`}, NULL, ${now}, ${now})`;
  }
  yield* sql`INSERT INTO workbench_jira_epic_links (binding_id, jira_issue_id, jira_issue_key,
      epic_id) VALUES ('binding', '10', 'ORBIT-10', 'jira:binding:epic:10')`;
  const epicCreation = (input: {
    readonly epicId: string;
    readonly key: string | null;
    readonly state: string;
  }) => sql`INSERT INTO workbench_jira_epic_creations (epic_id, binding_id, title, markdown,
      jira_issue_key, state, created_at, updated_at)
    VALUES (${input.epicId}, 'binding', ${`Requested ${input.epicId}`},
      ${`Request body ${input.epicId}`}, ${input.key}, ${input.state}, ${now}, ${later})`;
  yield* epicCreation({ epicId: "local-epic", key: "ORBIT-11", state: "created" });
  yield* epicCreation({ epicId: "reserved-epic", key: null, state: "uncertain" });

  // Execution runs held on a Jira transition settle at startup, not in the migration.
  yield* sql`INSERT INTO workbench_execution_runs (run_id, sequence, thread_id, ticket_id,
      assignment_id, started_at, state)
    VALUES ('run-pending', 1, 'thread', 'reused', 'assignment', ${now}, 'pending'),
      ('run-uncertain', 2, 'thread', 'reused', 'assignment', ${now}, 'uncertain')`;
});

const readTickets = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{
    readonly id: string;
    readonly projectId: string;
    readonly title: string;
    readonly kind: string;
    readonly markdown: string;
    readonly primaryT3ProjectId: string;
    readonly status: string;
    readonly revision: number;
    readonly key: string | null;
    readonly url: string | null;
  }>`SELECT ticket_id AS id, workbench_project_id AS "projectId", title, kind, markdown,
      primary_t3_project_id AS "primaryT3ProjectId", status, revision,
      jira_issue_key AS key, jira_issue_url AS url
    FROM workbench_tickets ORDER BY ticket_id`;
});

describe("ensureWorkbenchSchema", () => {
  it.effect("creates Jira link columns without Workbench-owned Jira tables", () =>
    withForeignKeys(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* ensureWorkbenchSchema;
        yield* ensureWorkbenchSchema;
        expect(yield* jiraSchemaObjects).toEqual([]);
        for (const table of ["workbench_tickets", "workbench_epics"]) {
          const columns = yield* sql<{
            readonly name: string;
          }>`SELECT name FROM pragma_table_info(${table})`;
          expect(columns.map((column) => column.name)).toEqual(
            expect.arrayContaining(["jira_issue_key", "jira_issue_url"]),
          );
        }
        expect(
          yield* sql`SELECT version FROM workbench_schema_migrations WHERE version = 20`,
        ).toHaveLength(1);
      }),
    ),
  );

  it.effect("creates the Thread recap table once", () =>
    withForeignKeys(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* ensureWorkbenchSchema;
        yield* ensureWorkbenchSchema;
        const columns = yield* sql<{
          readonly name: string;
        }>`SELECT name FROM pragma_table_info('workbench_thread_recaps')`;
        expect(columns.map((column) => column.name)).toEqual([
          "thread_id",
          "run_id",
          "text",
          "updated_at",
        ]);
        expect(
          yield* sql`SELECT version FROM workbench_schema_migrations WHERE version = 21`,
        ).toHaveLength(1);
      }),
    ),
  );

  it.effect("moves v19 Jira state onto local Tickets and Epics and drops the Jira tables", () =>
    withForeignKeys(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* ensureWorkbenchSchema;
        yield* rewindToV19;
        yield* seedV19;
        const before = yield* sql<Record<string, unknown>>`SELECT ticket_id, workbench_project_id,
            title, kind, markdown, primary_t3_project_id, status, revision
          FROM workbench_tickets ORDER BY ticket_id`;

        yield* ensureWorkbenchSchema;

        expect(yield* jiraSchemaObjects).toEqual([]);
        yield* expectForeignKeysIntact;
        const tickets = yield* readTickets;
        const links = Object.fromEntries(tickets.map((ticket) => [ticket.id, ticket.key]));
        expect(links).toEqual({
          "jira:binding:issue:1": "ORBIT-1",
          "jira:binding:issue:2": "ORBIT-2",
          published: "ORBIT-3",
          reused: "ORBIT-4",
          "reserved-created": "ORBIT-5",
          "reserved-pending": null,
          "reserved-uncertain": null,
        });
        for (const ticket of tickets) {
          if (ticket.key === null) {
            expect(ticket.url).toBeNull();
          } else {
            expect(ticket.url).toBe(browse(ticket.key));
            expect(parseJiraIssueUrl(ticket.url ?? "")?.key).toBe(ticket.key);
          }
        }
        // Issues that had left every selected sprint stay out of the active Board.
        const archived = yield* sql<{ readonly id: string }>`SELECT ticket_id AS id
          FROM workbench_tickets WHERE archived_at IS NOT NULL ORDER BY ticket_id`;
        expect(archived).toEqual([{ id: "jira:binding:issue:2" }]);
        // Existing rows keep identity, status, and content.
        const after = yield* sql<Record<string, unknown>>`SELECT ticket_id, workbench_project_id,
            title, kind, markdown, primary_t3_project_id, status, revision
          FROM workbench_tickets WHERE ticket_id NOT LIKE 'reserved-%' ORDER BY ticket_id`;
        expect(after).toEqual(before);

        expect(tickets.find((ticket) => ticket.id === "reserved-pending")).toMatchObject({
          projectId: "workspace",
          title: "Requested reserved-pending",
          kind: "bug",
          markdown: "Request body reserved-pending",
          primaryT3ProjectId: "docs",
          status: "todo",
          revision: 0,
        });
        const reservedEpics = yield* sql<{ readonly id: string; readonly epicId: string | null }>`
          SELECT ticket_id AS id, epic_id AS "epicId" FROM workbench_tickets
          WHERE ticket_id LIKE 'reserved-%' ORDER BY ticket_id`;
        expect(reservedEpics).toEqual([
          { id: "reserved-created", epicId: null },
          { id: "reserved-pending", epicId: "jira:binding:epic:10" },
          { id: "reserved-uncertain", epicId: "local-epic" },
        ]);
        expect(tickets.find((ticket) => ticket.id === "reserved-uncertain")).toMatchObject({
          primaryT3ProjectId: "native",
          status: "todo",
        });
        const repositories = yield* sql<{
          readonly ticketId: string;
          readonly projectId: string;
        }>`SELECT ticket_id AS "ticketId", t3_project_id AS "projectId"
          FROM workbench_ticket_repositories WHERE ticket_id LIKE 'reserved-%'
          ORDER BY ticket_id, position`;
        expect(repositories).toEqual([
          { ticketId: "reserved-created", projectId: "native" },
          { ticketId: "reserved-created", projectId: "docs" },
          { ticketId: "reserved-pending", projectId: "docs" },
          { ticketId: "reserved-pending", projectId: "native" },
          { ticketId: "reserved-uncertain", projectId: "native" },
          { ticketId: "reserved-uncertain", projectId: "docs" },
        ]);

        const epics = yield* sql<{
          readonly id: string;
          readonly title: string;
          readonly markdown: string;
          readonly key: string | null;
          readonly url: string | null;
        }>`SELECT epic_id AS id, title, markdown, jira_issue_key AS key, jira_issue_url AS url
          FROM workbench_epics ORDER BY epic_id`;
        expect(epics).toEqual([
          {
            id: "jira:binding:epic:10",
            title: "Epic jira:binding:epic:10",
            markdown: "Epic body jira:binding:epic:10",
            key: "ORBIT-10",
            url: browse("ORBIT-10"),
          },
          {
            id: "jira:binding:epic:20",
            title: "Epic jira:binding:epic:20",
            markdown: "Epic body jira:binding:epic:20",
            key: "ORBIT-20",
            url: browse("ORBIT-20"),
          },
          {
            id: "local-epic",
            title: "Epic local-epic",
            markdown: "Epic body local-epic",
            key: "ORBIT-11",
            url: browse("ORBIT-11"),
          },
          {
            id: "reserved-epic",
            title: "Requested reserved-epic",
            markdown: "Request body reserved-epic",
            key: null,
            url: null,
          },
        ]);

        expect(
          yield* sql`SELECT run_id, state FROM workbench_execution_runs ORDER BY sequence`,
        ).toEqual([
          { run_id: "run-pending", state: "pending" },
          { run_id: "run-uncertain", state: "uncertain" },
        ]);

        yield* ensureWorkbenchSchema;
        expect(yield* jiraSchemaObjects).toEqual([]);
        expect(yield* readTickets).toEqual(tickets);
        yield* expectForeignKeysIntact;
      }),
    ),
  );
});
