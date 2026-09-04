import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Fork-owned schema initialization deliberately stays outside T3's numbered
 * migration ledger. Upstream can keep appending migrations without colliding
 * with Workbench-only identifiers.
 */
export const ensureWorkbenchSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workbench_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS workbench_projects (
      project_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS workbench_project_links (
      workbench_project_id TEXT NOT NULL,
      t3_project_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (workbench_project_id, t3_project_id),
      FOREIGN KEY (workbench_project_id)
        REFERENCES workbench_projects(project_id)
        ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS workbench_epics (
      epic_id TEXT PRIMARY KEY,
      workbench_project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      markdown TEXT NOT NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workbench_project_id)
        REFERENCES workbench_projects(project_id)
        ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS workbench_tickets (
      ticket_id TEXT PRIMARY KEY,
      workbench_project_id TEXT NOT NULL,
      epic_id TEXT,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'story',
      markdown TEXT NOT NULL,
      primary_t3_project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      blocked INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workbench_project_id)
        REFERENCES workbench_projects(project_id)
        ON DELETE CASCADE,
      FOREIGN KEY (epic_id)
        REFERENCES workbench_epics(epic_id)
        ON DELETE SET NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS workbench_ticket_repositories (
      ticket_id TEXT NOT NULL,
      t3_project_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (ticket_id, t3_project_id),
      FOREIGN KEY (ticket_id)
        REFERENCES workbench_tickets(ticket_id)
        ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS workbench_assignments (
      assignment_id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      thread_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      superseded_at TEXT,
      FOREIGN KEY (ticket_id)
        REFERENCES workbench_tickets(ticket_id)
        ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS workbench_ticket_workspaces (
      ticket_id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      status TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (ticket_id)
        REFERENCES workbench_tickets(ticket_id)
        ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS workbench_ticket_workspace_repositories (
      ticket_id TEXT NOT NULL,
      t3_project_id TEXT NOT NULL,
      is_primary INTEGER NOT NULL,
      source_path TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (ticket_id, t3_project_id),
      FOREIGN KEY (ticket_id)
        REFERENCES workbench_ticket_workspaces(ticket_id)
        ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS workbench_jira_connections (
      connection_id TEXT PRIMARY KEY,
      cloud_id TEXT NOT NULL UNIQUE,
      credential_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      site_url TEXT NOT NULL,
      avatar_url TEXT,
      scopes_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS workbench_jira_bindings (
      binding_id TEXT PRIMARY KEY,
      workbench_project_id TEXT NOT NULL UNIQUE,
      connection_id TEXT NOT NULL,
      jira_project_id TEXT NOT NULL,
      jira_project_key TEXT NOT NULL,
      jira_project_name TEXT NOT NULL,
      board_id INTEGER NOT NULL,
      board_name TEXT NOT NULL,
      sprint_id INTEGER NOT NULL,
      sprint_name TEXT NOT NULL,
      default_primary_t3_project_id TEXT NOT NULL,
      default_repository_project_ids_json TEXT NOT NULL,
      status_mappings_json TEXT NOT NULL,
      active INTEGER NOT NULL,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workbench_project_id)
        REFERENCES workbench_projects(project_id)
        ON DELETE CASCADE,
      FOREIGN KEY (connection_id)
        REFERENCES workbench_jira_connections(connection_id)
        ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS workbench_jira_issue_links (
      binding_id TEXT NOT NULL,
      jira_issue_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      issue_json TEXT NOT NULL,
      active INTEGER NOT NULL,
      linked_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (binding_id, jira_issue_id),
      FOREIGN KEY (binding_id)
        REFERENCES workbench_jira_bindings(binding_id)
        ON DELETE CASCADE,
      FOREIGN KEY (ticket_id)
        REFERENCES workbench_tickets(ticket_id)
        ON DELETE CASCADE
    )
  `;

  const ticketColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(workbench_tickets)
  `;
  if (!ticketColumns.some((column) => column.name === "kind")) {
    yield* sql`
      ALTER TABLE workbench_tickets
      ADD COLUMN kind TEXT NOT NULL DEFAULT 'story'
    `;
  }
  if (!ticketColumns.some((column) => column.name === "epic_id")) {
    yield* sql`
      ALTER TABLE workbench_tickets
      ADD COLUMN epic_id TEXT REFERENCES workbench_epics(epic_id) ON DELETE SET NULL
    `;
  }

  const assignmentColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(workbench_assignments)
  `;
  if (!assignmentColumns.some((column) => column.name === "superseded_at")) {
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`DROP INDEX IF EXISTS uq_workbench_assignments_ticket`;
        yield* sql`
          ALTER TABLE workbench_assignments
          RENAME TO workbench_assignments_v1
        `;
        yield* sql`
          CREATE TABLE workbench_assignments (
            assignment_id TEXT PRIMARY KEY,
            ticket_id TEXT NOT NULL,
            thread_id TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            superseded_at TEXT,
            FOREIGN KEY (ticket_id)
              REFERENCES workbench_tickets(ticket_id)
              ON DELETE CASCADE
          )
        `;
        yield* sql`
          INSERT INTO workbench_assignments (
            assignment_id,
            ticket_id,
            thread_id,
            created_at,
            superseded_at
          )
          SELECT assignment_id, ticket_id, thread_id, created_at, NULL
          FROM workbench_assignments_v1
        `;
        yield* sql`DROP TABLE workbench_assignments_v1`;
      }),
    );
  }

  yield* sql`
    INSERT OR IGNORE INTO workbench_ticket_repositories (
      ticket_id,
      t3_project_id,
      position
    )
    SELECT ticket_id, primary_t3_project_id, 0
    FROM workbench_tickets
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workbench_epics_project_archived
    ON workbench_epics(workbench_project_id, archived_at, created_at)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workbench_tickets_project_status
    ON workbench_tickets(workbench_project_id, status, created_at)
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_workbench_assignments_active_ticket
    ON workbench_assignments(ticket_id)
    WHERE superseded_at IS NULL
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_workbench_ticket_workspace_primary
    ON workbench_ticket_workspace_repositories(ticket_id)
    WHERE is_primary = 1
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workbench_jira_issue_links_ticket
    ON workbench_jira_issue_links(ticket_id, active)
  `;
  yield* sql`
    INSERT OR IGNORE INTO workbench_schema_migrations (version)
    VALUES (1), (2), (3), (4), (5)
  `;
});
