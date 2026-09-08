import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const migrateLegacyStatusMappings = (statusMappingsJson: string): string => {
  try {
    const parsed: unknown = JSON.parse(statusMappingsJson);
    if (!Array.isArray(parsed)) return statusMappingsJson;

    let changed = false;
    const migrated = parsed.map((mapping) => {
      if (!isRecord(mapping) || mapping.workbenchStatus !== "ready_for_review") {
        return mapping;
      }
      changed = true;
      return { ...mapping, workbenchStatus: "in_progress" };
    });
    return changed ? JSON.stringify(migrated) : statusMappingsJson;
  } catch {
    // Preserve malformed data so the repository decoder still reports the existing error.
    return statusMappingsJson;
  }
};

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
      revision INTEGER NOT NULL DEFAULT 0,
      generated_summary TEXT,
      generated_summary_status TEXT NOT NULL DEFAULT 'pending',
      generated_summary_stale INTEGER NOT NULL DEFAULT 0,
      generated_summary_error TEXT,
      generated_summary_source_hash TEXT,
      generated_summary_request_id TEXT,
      archived_at TEXT,
      deleted_at TEXT,
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
      follow_active_sprint INTEGER NOT NULL DEFAULT 1,
      selected_sprints_json TEXT NOT NULL DEFAULT '[]',
      observed_active_sprint_ids_json TEXT NOT NULL DEFAULT '[]',
      board_mode TEXT NOT NULL DEFAULT 'mapped',
      board_columns_json TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL,
      last_synced_at TEXT,
      last_sync_error TEXT,
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

  yield* sql.withTransaction(
    Effect.gen(function* () {
      const migration = yield* sql<{ readonly version: number }>`
        SELECT version
        FROM workbench_schema_migrations
        WHERE version = 6
        LIMIT 1
      `;
      if (migration.length > 0) return;

      yield* sql`
        UPDATE workbench_tickets
        SET status = 'in_progress'
        WHERE status = 'ready_for_review'
      `;

      const statusMappingRows = yield* sql<{
        readonly bindingId: string;
        readonly statusMappingsJson: string;
      }>`
        SELECT
          binding_id AS "bindingId",
          status_mappings_json AS "statusMappingsJson"
        FROM workbench_jira_bindings
      `;
      for (const row of statusMappingRows) {
        const migrated = migrateLegacyStatusMappings(row.statusMappingsJson);
        if (migrated === row.statusMappingsJson) continue;
        yield* sql`
          UPDATE workbench_jira_bindings
          SET status_mappings_json = ${migrated}
          WHERE binding_id = ${row.bindingId}
        `;
      }

      yield* sql`
        INSERT OR IGNORE INTO workbench_schema_migrations (version)
        VALUES (6)
      `;
    }),
  );

  yield* sql.withTransaction(
    Effect.gen(function* () {
      const migration = yield* sql<{ readonly version: number }>`
        SELECT version
        FROM workbench_schema_migrations
        WHERE version = 7
        LIMIT 1
      `;
      if (migration.length > 0) return;

      const jiraBindingColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(workbench_jira_bindings)
      `;
      if (!jiraBindingColumns.some((column) => column.name === "follow_active_sprint")) {
        yield* sql`
          ALTER TABLE workbench_jira_bindings
          ADD COLUMN follow_active_sprint INTEGER NOT NULL DEFAULT 1
        `;
      }
      if (!jiraBindingColumns.some((column) => column.name === "board_mode")) {
        yield* sql`
          ALTER TABLE workbench_jira_bindings
          ADD COLUMN board_mode TEXT NOT NULL DEFAULT 'mapped'
        `;
      }
      if (!jiraBindingColumns.some((column) => column.name === "board_columns_json")) {
        yield* sql`
          ALTER TABLE workbench_jira_bindings
          ADD COLUMN board_columns_json TEXT NOT NULL DEFAULT '[]'
        `;
      }
      if (!jiraBindingColumns.some((column) => column.name === "last_sync_error")) {
        yield* sql`
          ALTER TABLE workbench_jira_bindings
          ADD COLUMN last_sync_error TEXT
        `;
      }
      yield* sql`
        INSERT OR IGNORE INTO workbench_schema_migrations (version)
        VALUES (7)
      `;
    }),
  );

  yield* sql.withTransaction(
    Effect.gen(function* () {
      const migration = yield* sql<{ readonly version: number }>`
        SELECT version
        FROM workbench_schema_migrations
        WHERE version = 8
        LIMIT 1
      `;
      if (migration.length > 0) return;

      const jiraBindingColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(workbench_jira_bindings)
      `;
      if (!jiraBindingColumns.some((column) => column.name === "observed_active_sprint_ids_json")) {
        yield* sql`
          ALTER TABLE workbench_jira_bindings
          ADD COLUMN observed_active_sprint_ids_json TEXT NOT NULL DEFAULT '[]'
        `;
      }
      yield* sql`
        INSERT OR IGNORE INTO workbench_schema_migrations (version)
        VALUES (8)
      `;
    }),
  );

  yield* sql.withTransaction(
    Effect.gen(function* () {
      const migration = yield* sql<{ readonly version: number }>`
        SELECT version
        FROM workbench_schema_migrations
        WHERE version = 9
        LIMIT 1
      `;
      if (migration.length > 0) return;

      const jiraBindingColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(workbench_jira_bindings)
      `;
      if (!jiraBindingColumns.some((column) => column.name === "selected_sprints_json")) {
        yield* sql`
          ALTER TABLE workbench_jira_bindings
          ADD COLUMN selected_sprints_json TEXT NOT NULL DEFAULT '[]'
        `;
      }
      yield* sql`
        INSERT OR IGNORE INTO workbench_schema_migrations (version)
        VALUES (9)
      `;
    }),
  );

  yield* sql.withTransaction(
    Effect.gen(function* () {
      const migration = yield* sql<{ readonly version: number }>`
        SELECT version
        FROM workbench_schema_migrations
        WHERE version = 10
        LIMIT 1
      `;
      if (migration.length > 0) return;

      const ticketColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(workbench_tickets)
      `;
      if (!ticketColumns.some((column) => column.name === "archived_at")) {
        yield* sql`
          ALTER TABLE workbench_tickets
          ADD COLUMN archived_at TEXT
        `;
      }
      if (!ticketColumns.some((column) => column.name === "deleted_at")) {
        yield* sql`
          ALTER TABLE workbench_tickets
          ADD COLUMN deleted_at TEXT
        `;
      }
      yield* sql`
        INSERT OR IGNORE INTO workbench_schema_migrations (version)
        VALUES (10)
      `;
    }),
  );

  yield* sql.withTransaction(
    Effect.gen(function* () {
      const migration = yield* sql<{ readonly version: number }>`
        SELECT version
        FROM workbench_schema_migrations
        WHERE version = 11
        LIMIT 1
      `;
      if (migration.length > 0) return;

      const ticketColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(workbench_tickets)
      `;
      if (!ticketColumns.some((column) => column.name === "revision")) {
        yield* sql`
          ALTER TABLE workbench_tickets
          ADD COLUMN revision INTEGER NOT NULL DEFAULT 0
        `;
      }
      yield* sql`
      INSERT OR IGNORE INTO workbench_schema_migrations (version)
      VALUES (11)
      `;
    }),
  );

  yield* sql.withTransaction(
    Effect.gen(function* () {
      const migration = yield* sql<{ readonly version: number }>`
        SELECT version
        FROM workbench_schema_migrations
        WHERE version = 12
        LIMIT 1
      `;
      if (migration.length > 0) return;

      const ticketColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(workbench_tickets)
      `;
      if (!ticketColumns.some((column) => column.name === "generated_summary")) {
        yield* sql`
          ALTER TABLE workbench_tickets
          ADD COLUMN generated_summary TEXT
        `;
      }
      if (!ticketColumns.some((column) => column.name === "generated_summary_status")) {
        yield* sql`
          ALTER TABLE workbench_tickets
          ADD COLUMN generated_summary_status TEXT NOT NULL DEFAULT 'pending'
        `;
      }
      if (!ticketColumns.some((column) => column.name === "generated_summary_stale")) {
        yield* sql`
          ALTER TABLE workbench_tickets
          ADD COLUMN generated_summary_stale INTEGER NOT NULL DEFAULT 0
        `;
      }
      if (!ticketColumns.some((column) => column.name === "generated_summary_error")) {
        yield* sql`
          ALTER TABLE workbench_tickets
          ADD COLUMN generated_summary_error TEXT
        `;
      }
      if (!ticketColumns.some((column) => column.name === "generated_summary_source_hash")) {
        yield* sql`
          ALTER TABLE workbench_tickets
          ADD COLUMN generated_summary_source_hash TEXT
        `;
      }
      if (!ticketColumns.some((column) => column.name === "generated_summary_request_id")) {
        yield* sql`
          ALTER TABLE workbench_tickets
          ADD COLUMN generated_summary_request_id TEXT
        `;
      }
      yield* sql`
        INSERT OR IGNORE INTO workbench_schema_migrations (version)
        VALUES (12)
      `;
    }),
  );

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
    DROP INDEX IF EXISTS uq_workbench_assignments_active_ticket
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_workbench_assignments_active_ticket_thread
    ON workbench_assignments(ticket_id, thread_id)
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
    VALUES (1), (2), (3), (4), (5), (6), (7), (8), (9), (10), (11), (12)
  `;
});
