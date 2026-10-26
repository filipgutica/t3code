import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

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

const parseJsonOrNull = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const stringList = (value: unknown): ReadonlyArray<string> | null =>
  Array.isArray(value) && value.every((item) => nonEmptyString(item) !== null) ? value : null;

const jiraBrowseUrl = (siteUrl: string, key: string) =>
  `${siteUrl.replace(/\/+$/u, "")}/browse/${key}`;

/**
 * Jira creation requests stored the requested repository scope in their
 * fingerprint. Older or malformed rows fall back to the binding's defaults.
 */
const requestedRepositoryScope = (row: {
  readonly fingerprint: string;
  readonly defaultPrimaryT3ProjectId: string;
  readonly defaultRepositoryProjectIdsJson: string;
}) => {
  const requested = parseJsonOrNull(row.fingerprint);
  const primary =
    (isRecord(requested) ? nonEmptyString(requested.primaryT3ProjectId) : null) ??
    row.defaultPrimaryT3ProjectId;
  const repositories =
    (isRecord(requested) ? stringList(requested.repositoryProjectIds) : null) ??
    stringList(parseJsonOrNull(row.defaultRepositoryProjectIdsJson)) ??
    [];
  return {
    primary,
    repositories: [
      ...new Set(repositories.includes(primary) ? repositories : [primary, ...repositories]),
    ],
  };
};

type JiraIssueLink = { readonly key: string; readonly url: string };

const creationLink = (row: {
  readonly key: string | null;
  readonly siteUrl: string;
}): JiraIssueLink | null => {
  const key = nonEmptyString(row.key);
  return key === null ? null : { key, url: jiraBrowseUrl(row.siteUrl, key) };
};

// Candidates arrive best first; the IS NULL guard keeps the first link per record.
const linkTicket = Effect.fn("WorkbenchSchema.linkTicket")(function* (
  link: JiraIssueLink & { readonly id: string },
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`UPDATE workbench_tickets SET jira_issue_key = ${link.key}, jira_issue_url = ${link.url}
    WHERE ticket_id = ${link.id} AND jira_issue_key IS NULL`;
});
const linkEpic = Effect.fn("WorkbenchSchema.linkEpic")(function* (
  link: JiraIssueLink & { readonly id: string },
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`UPDATE workbench_epics SET jira_issue_key = ${link.key}, jira_issue_url = ${link.url}
    WHERE epic_id = ${link.id} AND jira_issue_key IS NULL`;
});

/** Imported Tickets prefer an active issue link, then the most recently seen one. */
const linkTicketsFromIssueLinks = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const issueLinks = yield* sql<{
    readonly ticketId: string;
    readonly issueJson: string;
    readonly siteUrl: string;
  }>`
    SELECT link.ticket_id AS "ticketId", link.issue_json AS "issueJson",
      connection.site_url AS "siteUrl"
    FROM workbench_jira_issue_links AS link
    JOIN workbench_jira_bindings AS binding ON binding.binding_id = link.binding_id
    JOIN workbench_jira_connections AS connection
      ON connection.connection_id = binding.connection_id
    ORDER BY link.active DESC, link.last_seen_at DESC, link.jira_issue_id ASC
  `;
  for (const link of issueLinks) {
    const issue = parseJsonOrNull(link.issueJson);
    const key = isRecord(issue) ? nonEmptyString(issue.key) : null;
    if (!isRecord(issue) || key === null) continue;
    const url = nonEmptyString(issue.url) ?? jiraBrowseUrl(link.siteUrl, key);
    yield* linkTicket({ id: link.ticketId, key, url });
  }
});

interface TicketCreationRow {
  readonly ticketId: string;
  readonly bindingId: string;
  readonly projectId: string;
  readonly title: string;
  readonly kind: string;
  readonly markdown: string;
  readonly fingerprint: string;
  readonly key: string | null;
  readonly siteUrl: string;
  readonly defaultPrimaryT3ProjectId: string;
  readonly defaultRepositoryProjectIdsJson: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly hasLocalTicket: number;
}

/**
 * A request named its Epic by local Epic ID or, for Jira Epics, by Jira issue ID.
 * Resolve it while the binding's Epic links still exist.
 */
const requestedEpicId = Effect.fn("WorkbenchSchema.requestedEpicId")(function* (
  creation: TicketCreationRow,
) {
  const sql = yield* SqlClient.SqlClient;
  const requested = parseJsonOrNull(creation.fingerprint);
  const epicId = isRecord(requested) ? nonEmptyString(requested.epicId) : null;
  if (epicId === null) return null;
  const rows = yield* sql<{ readonly epicId: string }>`
    SELECT epic_id AS "epicId" FROM workbench_epics
    WHERE workbench_project_id = ${creation.projectId} AND (
      epic_id = ${epicId}
      OR epic_id = ${`jira:${creation.bindingId}:epic:${epicId}`}
      OR epic_id IN (
        SELECT epic_id FROM workbench_jira_epic_links
        WHERE binding_id = ${creation.bindingId} AND jira_issue_id = ${epicId}
      )
    )
    LIMIT 1
  `;
  return rows[0]?.epicId ?? null;
});

/** A reservation whose local Ticket never appeared becomes a local Ticket. */
const insertReservedTicket = Effect.fn("WorkbenchSchema.insertReservedTicket")(function* (
  creation: TicketCreationRow,
  link: JiraIssueLink | null,
) {
  const sql = yield* SqlClient.SqlClient;
  const scope = requestedRepositoryScope(creation);
  const epicId = yield* requestedEpicId(creation);
  yield* sql`
    INSERT INTO workbench_tickets (
      ticket_id, workbench_project_id, epic_id, title, kind, markdown, primary_t3_project_id,
      status, blocked, revision, generated_summary_status, jira_issue_key, jira_issue_url,
      created_at, updated_at
    ) VALUES (
      ${creation.ticketId}, ${creation.projectId}, ${epicId}, ${creation.title},
      ${creation.kind === "bug" ? "bug" : "story"}, ${creation.markdown}, ${scope.primary},
      'todo', 0, 0, 'pending', ${link?.key ?? null}, ${link?.url ?? null},
      ${creation.createdAt}, ${creation.updatedAt}
    )
  `;
  for (const [position, repositoryProjectId] of scope.repositories.entries()) {
    yield* sql`
      INSERT INTO workbench_ticket_repositories (ticket_id, t3_project_id, position)
      VALUES (${creation.ticketId}, ${repositoryProjectId}, ${position})
    `;
  }
});

const foldTicketCreations = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // A creation's result can be an existing Ticket that already carried the issue link.
  const creations = yield* sql<TicketCreationRow>`
    SELECT COALESCE(creation.result_ticket_id, creation.ticket_id) AS "ticketId",
      creation.binding_id AS "bindingId", binding.workbench_project_id AS "projectId", creation.title, creation.kind,
      creation.markdown, creation.request_fingerprint AS fingerprint,
      creation.jira_issue_key AS key, connection.site_url AS "siteUrl",
      binding.default_primary_t3_project_id AS "defaultPrimaryT3ProjectId",
      binding.default_repository_project_ids_json AS "defaultRepositoryProjectIdsJson",
      creation.created_at AS "createdAt", creation.updated_at AS "updatedAt",
      EXISTS (
        SELECT 1 FROM workbench_tickets AS ticket
        WHERE ticket.ticket_id = COALESCE(creation.result_ticket_id, creation.ticket_id)
      ) AS "hasLocalTicket"
    FROM workbench_jira_ticket_creations AS creation
    JOIN workbench_jira_bindings AS binding ON binding.binding_id = creation.binding_id
    JOIN workbench_jira_connections AS connection
      ON connection.connection_id = binding.connection_id
    ORDER BY creation.updated_at DESC, creation.ticket_id ASC
  `;
  for (const creation of creations) {
    const link = creationLink(creation);
    if (creation.hasLocalTicket === 0) yield* insertReservedTicket(creation, link);
    else if (link !== null) yield* linkTicket({ id: creation.ticketId, ...link });
  }
});

const linkEpicsFromEpicLinks = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const epicLinks = yield* sql<{
    readonly epicId: string;
    readonly key: string | null;
    readonly siteUrl: string;
  }>`
    SELECT link.epic_id AS "epicId", link.jira_issue_key AS key, connection.site_url AS "siteUrl"
    FROM workbench_jira_epic_links AS link
    JOIN workbench_jira_bindings AS binding ON binding.binding_id = link.binding_id
    JOIN workbench_jira_connections AS connection
      ON connection.connection_id = binding.connection_id
    ORDER BY link.jira_issue_id ASC
  `;
  for (const epicLink of epicLinks) {
    const link = creationLink(epicLink);
    if (link !== null) yield* linkEpic({ id: epicLink.epicId, ...link });
  }
});

const importedEpicLink = (
  bindingId: string,
  siteUrl: string,
  epic: unknown,
): (JiraIssueLink & { readonly id: string }) | null => {
  const jiraIssueId = isRecord(epic) ? nonEmptyString(epic.id) : null;
  const key = isRecord(epic) ? nonEmptyString(epic.key) : null;
  if (jiraIssueId === null || key === null) return null;
  return { id: `jira:${bindingId}:epic:${jiraIssueId}`, key, url: jiraBrowseUrl(siteUrl, key) };
};

/**
 * Sprint sync imported an unmapped Epic under its `jira:` ID and kept the Epic's key only on
 * its child issues. Runs after explicit Epic mappings, which win.
 */
const linkImportedEpicsFromIssueLinks = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const issueLinks = yield* sql<{
    readonly bindingId: string;
    readonly issueJson: string;
    readonly siteUrl: string;
  }>`
    SELECT link.binding_id AS "bindingId", link.issue_json AS "issueJson",
      connection.site_url AS "siteUrl"
    FROM workbench_jira_issue_links AS link
    JOIN workbench_jira_bindings AS binding ON binding.binding_id = link.binding_id
    JOIN workbench_jira_connections AS connection
      ON connection.connection_id = binding.connection_id
    ORDER BY link.active DESC, link.last_seen_at DESC, link.jira_issue_id ASC
  `;
  for (const link of issueLinks) {
    const issue = parseJsonOrNull(link.issueJson);
    const epic = importedEpicLink(
      link.bindingId,
      link.siteUrl,
      isRecord(issue) ? issue.epic : null,
    );
    if (epic !== null) yield* linkEpic(epic);
  }
});

const foldEpicCreations = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const creations = yield* sql<{
    readonly epicId: string;
    readonly projectId: string;
    readonly title: string;
    readonly markdown: string;
    readonly key: string | null;
    readonly siteUrl: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly hasLocalEpic: number;
  }>`
    SELECT creation.epic_id AS "epicId", binding.workbench_project_id AS "projectId",
      creation.title, creation.markdown, creation.jira_issue_key AS key,
      connection.site_url AS "siteUrl", creation.created_at AS "createdAt",
      creation.updated_at AS "updatedAt",
      EXISTS (
        SELECT 1 FROM workbench_epics AS epic WHERE epic.epic_id = creation.epic_id
      ) AS "hasLocalEpic"
    FROM workbench_jira_epic_creations AS creation
    JOIN workbench_jira_bindings AS binding ON binding.binding_id = creation.binding_id
    JOIN workbench_jira_connections AS connection
      ON connection.connection_id = binding.connection_id
    ORDER BY creation.updated_at DESC, creation.epic_id ASC
  `;
  for (const creation of creations) {
    const link = creationLink(creation);
    if (creation.hasLocalEpic === 1) {
      if (link !== null) yield* linkEpic({ id: creation.epicId, ...link });
      continue;
    }
    yield* sql`
      INSERT INTO workbench_epics (
        epic_id, workbench_project_id, title, markdown, archived_at, jira_issue_key,
        jira_issue_url, created_at, updated_at
      ) VALUES (
        ${creation.epicId}, ${creation.projectId}, ${creation.title}, ${creation.markdown}, NULL,
        ${link?.key ?? null}, ${link?.url ?? null}, ${creation.createdAt}, ${creation.updatedAt}
      )
    `;
  }
});

/**
 * v20 keeps each Jira-backed Ticket and Epic as an ordinary local record with
 * its issue key and URL, then drops Workbench's own Jira tables. Existing rows
 * are updated in place: rebuilding workbench_tickets or workbench_epics would
 * fire their ON DELETE cascades.
 */
const migrateJiraStateToLinks = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const table of ["workbench_tickets", "workbench_epics"]) {
    yield* sql`ALTER TABLE ${sql(table)} ADD COLUMN jira_issue_key TEXT`;
    yield* sql`ALTER TABLE ${sql(table)} ADD COLUMN jira_issue_url TEXT`;
  }
  yield* linkTicketsFromIssueLinks;
  // Sync hid issues that had left every selected sprint; archiving keeps them in history.
  yield* sql`UPDATE workbench_tickets SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE archived_at IS NULL AND ticket_id IN (
      SELECT ticket_id FROM workbench_jira_issue_links GROUP BY ticket_id HAVING MAX(active) = 0
    )`;
  yield* foldTicketCreations;
  yield* linkEpicsFromEpicLinks;
  yield* linkImportedEpicsFromIssueLinks;
  yield* foldEpicCreations;
  // Children first, so dropping a parent never runs a foreign-key action.
  for (const table of [
    "workbench_jira_epic_links",
    "workbench_jira_issue_links",
    "workbench_jira_ticket_creations",
    "workbench_jira_epic_creations",
    "workbench_jira_bindings",
    "workbench_jira_connections",
  ]) {
    yield* sql`DROP TABLE ${sql(table)}`;
  }
});

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
      attempt_id TEXT,
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
  // v20 folded Workbench-owned Jira state into link columns. Older databases still
  // need these tables so the earlier numbered migrations below can run first.
  const hasJiraLinks =
    (yield* sql`SELECT 1 FROM workbench_schema_migrations WHERE version = 20`).length > 0;
  if (!hasJiraLinks) {
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
        local_migration_pending INTEGER NOT NULL DEFAULT 0,
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
    yield* sql`
      CREATE TABLE IF NOT EXISTS workbench_jira_ticket_creations (
        ticket_id TEXT PRIMARY KEY,
        binding_id TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        markdown TEXT NOT NULL,
        jira_issue_id TEXT,
        jira_issue_key TEXT,
        request_fingerprint TEXT NOT NULL DEFAULT '',
        result_ticket_id TEXT,
        state TEXT NOT NULL CHECK (state IN ('pending', 'uncertain', 'created')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (binding_id)
          REFERENCES workbench_jira_bindings(binding_id)
          ON DELETE CASCADE
      )
    `;
    yield* sql`
      CREATE TABLE IF NOT EXISTS workbench_jira_epic_creations (
        epic_id TEXT PRIMARY KEY,
        binding_id TEXT NOT NULL,
        title TEXT NOT NULL,
        markdown TEXT NOT NULL,
        jira_issue_id TEXT,
        jira_issue_key TEXT,
        request_fingerprint TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL CHECK (state IN ('pending', 'uncertain', 'created')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (binding_id)
          REFERENCES workbench_jira_bindings(binding_id)
          ON DELETE CASCADE
      )
    `;
    yield* sql`
      CREATE TABLE IF NOT EXISTS workbench_jira_epic_links (
        binding_id TEXT NOT NULL,
        jira_issue_id TEXT NOT NULL,
        jira_issue_key TEXT NOT NULL,
        epic_id TEXT NOT NULL,
        PRIMARY KEY (binding_id, jira_issue_id),
        FOREIGN KEY (binding_id)
          REFERENCES workbench_jira_bindings(binding_id)
          ON DELETE CASCADE,
        FOREIGN KEY (epic_id)
          REFERENCES workbench_epics(epic_id)
          ON DELETE CASCADE
      )
    `;

    const creationColumns = yield* sql<{
      readonly name: string;
    }>`PRAGMA table_info(workbench_jira_ticket_creations)`;
    if (!creationColumns.some((column) => column.name === "request_fingerprint")) {
      yield* sql`ALTER TABLE workbench_jira_ticket_creations ADD COLUMN request_fingerprint TEXT NOT NULL DEFAULT ''`;
    }
    if (!creationColumns.some((column) => column.name === "result_ticket_id")) {
      yield* sql`ALTER TABLE workbench_jira_ticket_creations ADD COLUMN result_ticket_id TEXT`;
    }
  }

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

  yield* sql.withTransaction(
    Effect.gen(function* () {
      const migration = yield* sql<{ readonly version: number }>`
        SELECT version
        FROM workbench_schema_migrations
        WHERE version = 13
        LIMIT 1
      `;
      if (migration.length > 0) return;

      const workspaceRepositoryColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(workbench_ticket_workspace_repositories)
      `;
      if (!workspaceRepositoryColumns.some((column) => column.name === "attempt_id")) {
        yield* sql`
          ALTER TABLE workbench_ticket_workspace_repositories
          ADD COLUMN attempt_id TEXT
        `;
      }
      yield* sql`
        UPDATE workbench_ticket_workspace_repositories
        SET attempt_id = (
          SELECT attempt_id
          FROM workbench_ticket_workspaces
          WHERE workbench_ticket_workspaces.ticket_id =
            workbench_ticket_workspace_repositories.ticket_id
        )
        WHERE attempt_id IS NULL
      `;
      yield* sql`
        INSERT OR IGNORE INTO workbench_schema_migrations (version)
        VALUES (13)
      `;
    }),
  );

  yield* sql.withTransaction(
    Effect.gen(function* () {
      const migration = yield* sql<{ readonly version: number }>`
        SELECT version
        FROM workbench_schema_migrations
        WHERE version = 14
        LIMIT 1
      `;
      if (migration.length > 0) return;

      const jiraBindingColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(workbench_jira_bindings)
      `;
      if (!jiraBindingColumns.some((column) => column.name === "local_migration_pending")) {
        yield* sql`
          ALTER TABLE workbench_jira_bindings
          ADD COLUMN local_migration_pending INTEGER NOT NULL DEFAULT 0
        `;
      }
      yield* sql`
        INSERT OR IGNORE INTO workbench_schema_migrations (version)
        VALUES (14)
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
  if (!hasJiraLinks) {
    yield* sql`
      CREATE INDEX IF NOT EXISTS idx_workbench_jira_issue_links_ticket
      ON workbench_jira_issue_links(ticket_id, active)
    `;
  }
  const applyMigration = <E, R>(version: number, migration: Effect.Effect<void, E, R>) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const applied =
          yield* sql`SELECT version FROM workbench_schema_migrations WHERE version = ${version}`;
        if (applied.length > 0) return;
        yield* migration;
        yield* sql`INSERT INTO workbench_schema_migrations (version) VALUES (${version})`;
      }),
    );
  yield* applyMigration(
    15,
    Effect.gen(function* () {
      yield* sql`ALTER TABLE workbench_tickets ADD COLUMN execution_after_sequence INTEGER NOT NULL DEFAULT 0`;
      yield* sql`ALTER TABLE workbench_assignments ADD COLUMN execution_after_sequence INTEGER NOT NULL DEFAULT 0`;
      yield* sql`CREATE TABLE workbench_execution_cursor (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1), sequence INTEGER NOT NULL
    )`;
      yield* sql`CREATE TABLE workbench_execution_runs (
      run_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, thread_id TEXT, ticket_id TEXT,
      assignment_id TEXT, started_at TEXT, state TEXT NOT NULL
        CHECK (state IN ('done', 'pending', 'uncertain'))
    )`;
    }),
  );
  yield* applyMigration(
    16,
    Effect.gen(function* () {
      yield* sql`ALTER TABLE workbench_projects ADD COLUMN archived_at TEXT`;
      yield* sql`ALTER TABLE workbench_projects ADD COLUMN deleted_at TEXT`;
      yield* sql`ALTER TABLE workbench_projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`;
      yield* sql`ALTER TABLE workbench_projects ADD COLUMN execution_after_sequence INTEGER NOT NULL DEFAULT 0`;
    }),
  );
  yield* applyMigration(
    17,
    Effect.gen(function* () {
      yield* sql`CREATE TABLE workbench_ticket_drafts (
      draft_id TEXT PRIMARY KEY, workbench_project_id TEXT NOT NULL,
      thread_id TEXT NOT NULL UNIQUE, phase TEXT NOT NULL, revision INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY (workbench_project_id) REFERENCES workbench_projects(project_id) ON DELETE CASCADE
    )`;
      yield* sql`CREATE UNIQUE INDEX uq_workbench_active_ticket_draft
      ON workbench_ticket_drafts(workbench_project_id)
      WHERE phase IN ('creating', 'draft', 'promoting', 'discarding')`;
    }),
  );
  yield* applyMigration(
    18,
    sql`DROP INDEX IF EXISTS uq_workbench_active_ticket_draft`.pipe(Effect.asVoid),
  );
  yield* applyMigration(
    19,
    Effect.gen(function* () {
      yield* sql`ALTER TABLE workbench_ticket_workspaces ADD COLUMN generated_branch_name TEXT`;
      // All-PR Workspaces used branch_name only as an identity, not as a selected branch.
      yield* sql`
        UPDATE workbench_ticket_workspaces SET generated_branch_name = branch_name
        WHERE NOT EXISTS (
          SELECT 1 FROM workbench_ticket_workspace_repositories AS repository
          WHERE repository.ticket_id = workbench_ticket_workspaces.ticket_id
        ) OR EXISTS (
          SELECT 1 FROM workbench_ticket_workspace_repositories AS repository
          WHERE repository.ticket_id = workbench_ticket_workspaces.ticket_id
            AND repository.branch_name = workbench_ticket_workspaces.branch_name
        )
      `;
    }),
  );
  yield* applyMigration(20, migrateJiraStateToLinks);
  yield* sql`
    INSERT OR IGNORE INTO workbench_schema_migrations (version)
    VALUES (1), (2), (3), (4), (5), (6), (7), (8), (9), (10), (11), (12), (13), (14)
  `;
});
