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
    CREATE TABLE IF NOT EXISTS workbench_tickets (
      ticket_id TEXT PRIMARY KEY,
      workbench_project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      markdown TEXT NOT NULL,
      primary_t3_project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      blocked INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workbench_project_id)
        REFERENCES workbench_projects(project_id)
        ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS workbench_assignments (
      assignment_id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY (ticket_id)
        REFERENCES workbench_tickets(ticket_id)
        ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workbench_tickets_project_status
    ON workbench_tickets(workbench_project_id, status, created_at)
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_workbench_assignments_ticket
    ON workbench_assignments(ticket_id)
  `;
  yield* sql`
    INSERT OR IGNORE INTO workbench_schema_migrations (version)
    VALUES (1)
  `;
});
