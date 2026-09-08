import {
  WorkbenchJiraBinding,
  type WorkbenchJiraBindingId,
  WorkbenchJiraConnection,
  type WorkbenchJiraConnectionId,
  WorkbenchJiraIssueLink,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export class WorkbenchJiraRepositoryError extends Schema.TaggedError<WorkbenchJiraRepositoryError>()(
  "WorkbenchJiraRepositoryError",
  { cause: Schema.Defect() },
) {}

export interface WorkbenchJiraRepositoryShape {
  readonly findConnectionByCloudId: (
    cloudId: string,
  ) => Effect.Effect<Option.Option<WorkbenchJiraConnection>, WorkbenchJiraRepositoryError>;
  readonly getConnection: (
    id: WorkbenchJiraConnectionId,
  ) => Effect.Effect<Option.Option<WorkbenchJiraConnection>, WorkbenchJiraRepositoryError>;
  readonly listConnections: () => Effect.Effect<
    ReadonlyArray<WorkbenchJiraConnection>,
    WorkbenchJiraRepositoryError
  >;
  readonly getCredentialId: (
    connectionId: WorkbenchJiraConnectionId,
  ) => Effect.Effect<Option.Option<string>, WorkbenchJiraRepositoryError>;
  readonly upsertConnection: (
    connection: WorkbenchJiraConnection,
    credentialId: string,
  ) => Effect.Effect<void, WorkbenchJiraRepositoryError>;
  readonly upsertConnections: (
    connections: ReadonlyArray<WorkbenchJiraConnection>,
    credentialId: string,
  ) => Effect.Effect<void, WorkbenchJiraRepositoryError>;
  readonly getBinding: (
    id: WorkbenchJiraBindingId,
  ) => Effect.Effect<Option.Option<WorkbenchJiraBinding>, WorkbenchJiraRepositoryError>;
  readonly listBindings: () => Effect.Effect<
    ReadonlyArray<WorkbenchJiraBinding>,
    WorkbenchJiraRepositoryError
  >;
  readonly upsertBinding: (
    binding: WorkbenchJiraBinding,
  ) => Effect.Effect<void, WorkbenchJiraRepositoryError>;
  readonly updateBindingSyncMetadata: (input: {
    readonly id: WorkbenchJiraBindingId;
    readonly expectedUpdatedAt: string;
    readonly syncedAt: string;
    readonly sprintId?: WorkbenchJiraBinding["sprintId"];
    readonly sprintName?: WorkbenchJiraBinding["sprintName"];
    readonly selectedSprints?: WorkbenchJiraBinding["selectedSprints"];
    readonly statusMappings?: WorkbenchJiraBinding["statusMappings"];
    readonly boardColumns?: WorkbenchJiraBinding["boardColumns"];
    readonly observedActiveSprintIds?: WorkbenchJiraBinding["observedActiveSprintIds"];
  }) => Effect.Effect<boolean, WorkbenchJiraRepositoryError>;
  readonly updateBindingSyncError: (input: {
    readonly id: WorkbenchJiraBindingId;
    readonly expectedUpdatedAt: string;
    readonly updatedAt: string;
    readonly message: string;
    readonly selectedSprints?: WorkbenchJiraBinding["selectedSprints"];
    readonly observedActiveSprintIds?: WorkbenchJiraBinding["observedActiveSprintIds"];
  }) => Effect.Effect<boolean, WorkbenchJiraRepositoryError>;
  readonly listIssueLinks: (
    bindingId: WorkbenchJiraBindingId,
  ) => Effect.Effect<ReadonlyArray<WorkbenchJiraIssueLink>, WorkbenchJiraRepositoryError>;
  readonly replaceIssueLinks: (
    bindingId: WorkbenchJiraBindingId,
    links: ReadonlyArray<WorkbenchJiraIssueLink>,
  ) => Effect.Effect<void, WorkbenchJiraRepositoryError>;
}

/**
 * Persistence seam for the fork-owned Jira tables. The SQL implementation is
 * wired with the Workbench schema; OAuth and API code only depend on this seam.
 */
export class WorkbenchJiraRepository extends Context.Service<
  WorkbenchJiraRepository,
  WorkbenchJiraRepositoryShape
>()("@t3tools/workbench/jira/WorkbenchJiraRepository") {}

const ConnectionRow = Schema.Struct({
  id: WorkbenchJiraConnection.fields.id,
  cloudId: WorkbenchJiraConnection.fields.cloudId,
  credentialId: Schema.String,
  siteName: WorkbenchJiraConnection.fields.siteName,
  siteUrl: WorkbenchJiraConnection.fields.siteUrl,
  avatarUrl: WorkbenchJiraConnection.fields.avatarUrl,
  scopesJson: Schema.String,
  createdAt: WorkbenchJiraConnection.fields.createdAt,
  updatedAt: WorkbenchJiraConnection.fields.updatedAt,
});

const BindingRow = Schema.Struct({
  id: WorkbenchJiraBinding.fields.id,
  projectId: WorkbenchJiraBinding.fields.projectId,
  connectionId: WorkbenchJiraBinding.fields.connectionId,
  jiraProjectId: WorkbenchJiraBinding.fields.jiraProjectId,
  jiraProjectKey: WorkbenchJiraBinding.fields.jiraProjectKey,
  jiraProjectName: WorkbenchJiraBinding.fields.jiraProjectName,
  boardId: WorkbenchJiraBinding.fields.boardId,
  boardName: WorkbenchJiraBinding.fields.boardName,
  sprintId: WorkbenchJiraBinding.fields.sprintId,
  sprintName: WorkbenchJiraBinding.fields.sprintName,
  selectedSprintsJson: Schema.String,
  defaultPrimaryT3ProjectId: WorkbenchJiraBinding.fields.defaultPrimaryT3ProjectId,
  defaultRepositoryProjectIdsJson: Schema.String,
  statusMappingsJson: Schema.String,
  followActiveSprint: Schema.Number,
  observedActiveSprintIdsJson: Schema.String,
  boardMode: WorkbenchJiraBinding.fields.boardMode,
  boardColumnsJson: Schema.String,
  active: Schema.Number,
  lastSyncedAt: WorkbenchJiraBinding.fields.lastSyncedAt,
  lastSyncError: WorkbenchJiraBinding.fields.lastSyncError,
  createdAt: WorkbenchJiraBinding.fields.createdAt,
  updatedAt: WorkbenchJiraBinding.fields.updatedAt,
});

const IssueLinkRow = Schema.Struct({
  bindingId: WorkbenchJiraIssueLink.fields.bindingId,
  ticketId: WorkbenchJiraIssueLink.fields.ticketId,
  issueJson: Schema.String,
  active: Schema.Number,
  linkedAt: WorkbenchJiraIssueLink.fields.linkedAt,
  lastSeenAt: WorkbenchJiraIssueLink.fields.lastSeenAt,
});

const decodeJson = <S extends Schema.Top>(schema: S, value: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(value);
const encodeJson = <S extends Schema.Top>(schema: S, value: S["Type"]) =>
  Schema.encodeEffect(Schema.fromJsonString(schema))(value);

const repositoryFailure = (cause: unknown) => new WorkbenchJiraRepositoryError({ cause });

export const layerSql = Layer.effect(
  WorkbenchJiraRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const loadConnections = Effect.fn("WorkbenchJiraRepository.loadConnections")(function* () {
      const rows = yield* sql<Schema.Schema.Type<typeof ConnectionRow>>`
        SELECT
          connection_id AS "id",
          cloud_id AS "cloudId",
          credential_id AS "credentialId",
          site_name AS "siteName",
          site_url AS "siteUrl",
          avatar_url AS "avatarUrl",
          scopes_json AS "scopesJson",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM workbench_jira_connections
        ORDER BY created_at ASC, connection_id ASC
      `;
      return yield* Effect.forEach(rows, (row) =>
        decodeJson(WorkbenchJiraConnection.fields.scopes, row.scopesJson).pipe(
          Effect.map(
            (scopes) =>
              ({
                id: row.id,
                cloudId: row.cloudId,
                siteName: row.siteName,
                siteUrl: row.siteUrl,
                avatarUrl: row.avatarUrl,
                scopes,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
              }) satisfies WorkbenchJiraConnection,
          ),
        ),
      );
    });

    const loadBindings = Effect.fn("WorkbenchJiraRepository.loadBindings")(function* () {
      const rows = yield* sql<Schema.Schema.Type<typeof BindingRow>>`
        SELECT
          binding_id AS "id",
          workbench_project_id AS "projectId",
          connection_id AS "connectionId",
          jira_project_id AS "jiraProjectId",
          jira_project_key AS "jiraProjectKey",
          jira_project_name AS "jiraProjectName",
          board_id AS "boardId",
          board_name AS "boardName",
          sprint_id AS "sprintId",
          sprint_name AS "sprintName",
          selected_sprints_json AS "selectedSprintsJson",
          default_primary_t3_project_id AS "defaultPrimaryT3ProjectId",
          default_repository_project_ids_json AS "defaultRepositoryProjectIdsJson",
          status_mappings_json AS "statusMappingsJson",
          follow_active_sprint AS "followActiveSprint",
          observed_active_sprint_ids_json AS "observedActiveSprintIdsJson",
          board_mode AS "boardMode",
          board_columns_json AS "boardColumnsJson",
          active,
          last_synced_at AS "lastSyncedAt",
          last_sync_error AS "lastSyncError",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM workbench_jira_bindings
        ORDER BY created_at ASC, binding_id ASC
      `;
      return yield* Effect.forEach(rows, (row) =>
        Effect.all({
          defaultRepositoryProjectIds: decodeJson(
            WorkbenchJiraBinding.fields.defaultRepositoryProjectIds,
            row.defaultRepositoryProjectIdsJson,
          ),
          statusMappings: decodeJson(
            WorkbenchJiraBinding.fields.statusMappings,
            row.statusMappingsJson,
          ),
          selectedSprints: decodeJson(
            WorkbenchJiraBinding.fields.selectedSprints,
            row.selectedSprintsJson,
          ),
          boardColumns: decodeJson(WorkbenchJiraBinding.fields.boardColumns, row.boardColumnsJson),
          observedActiveSprintIds: decodeJson(
            WorkbenchJiraBinding.fields.observedActiveSprintIds,
            row.observedActiveSprintIdsJson,
          ),
        }).pipe(
          Effect.map(
            (decoded) =>
              ({
                id: row.id,
                projectId: row.projectId,
                connectionId: row.connectionId,
                jiraProjectId: row.jiraProjectId,
                jiraProjectKey: row.jiraProjectKey,
                jiraProjectName: row.jiraProjectName,
                boardId: row.boardId,
                boardName: row.boardName,
                sprintId: row.sprintId,
                sprintName: row.sprintName,
                defaultPrimaryT3ProjectId: row.defaultPrimaryT3ProjectId,
                ...decoded,
                followActiveSprint: row.followActiveSprint === 1,
                boardMode: row.boardMode,
                active: row.active === 1,
                lastSyncedAt: row.lastSyncedAt,
                lastSyncError: row.lastSyncError,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
              }) satisfies WorkbenchJiraBinding,
          ),
        ),
      );
    });

    const loadIssueLinks = Effect.fn("WorkbenchJiraRepository.loadIssueLinks")(function* (
      bindingId: WorkbenchJiraBindingId,
    ) {
      const rows = yield* sql<Schema.Schema.Type<typeof IssueLinkRow>>`
        SELECT
          binding_id AS "bindingId",
          ticket_id AS "ticketId",
          issue_json AS "issueJson",
          active,
          linked_at AS "linkedAt",
          last_seen_at AS "lastSeenAt"
        FROM workbench_jira_issue_links
        WHERE binding_id = ${bindingId}
        ORDER BY active DESC, last_seen_at DESC, jira_issue_id ASC
      `;
      return yield* Effect.forEach(rows, (row) =>
        decodeJson(WorkbenchJiraIssueLink.fields.issue, row.issueJson).pipe(
          Effect.map(
            (issue) =>
              ({
                bindingId: row.bindingId,
                ticketId: row.ticketId,
                issue,
                active: row.active === 1,
                linkedAt: row.linkedAt,
                lastSeenAt: row.lastSeenAt,
              }) satisfies WorkbenchJiraIssueLink,
          ),
        ),
      );
    });

    const protect = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.mapError(repositoryFailure));

    const saveConnection = Effect.fn("WorkbenchJiraRepository.saveConnection")(function* (
      connection: WorkbenchJiraConnection,
      credentialId: string,
    ) {
      const scopesJson = yield* encodeJson(
        WorkbenchJiraConnection.fields.scopes,
        connection.scopes,
      );
      yield* sql`
        INSERT INTO workbench_jira_connections (
          connection_id, cloud_id, credential_id, site_name, site_url, avatar_url,
          scopes_json, created_at, updated_at
        ) VALUES (
          ${connection.id}, ${connection.cloudId}, ${credentialId}, ${connection.siteName},
          ${connection.siteUrl}, ${connection.avatarUrl}, ${scopesJson},
          ${connection.createdAt}, ${connection.updatedAt}
        )
        ON CONFLICT(connection_id) DO UPDATE SET
          cloud_id = excluded.cloud_id,
          credential_id = excluded.credential_id,
          site_name = excluded.site_name,
          site_url = excluded.site_url,
          avatar_url = excluded.avatar_url,
          scopes_json = excluded.scopes_json,
          updated_at = excluded.updated_at
      `;
    });

    return WorkbenchJiraRepository.of({
      listConnections: () => protect(loadConnections()),
      findConnectionByCloudId: (cloudId) =>
        protect(
          loadConnections().pipe(
            Effect.map((connections) =>
              Option.fromNullishOr(
                connections.find((connection) => connection.cloudId === cloudId),
              ),
            ),
          ),
        ),
      getConnection: (id) =>
        protect(
          loadConnections().pipe(
            Effect.map((connections) =>
              Option.fromNullishOr(connections.find((connection) => connection.id === id)),
            ),
          ),
        ),
      getCredentialId: (connectionId) =>
        protect(
          sql<{ readonly credentialId: string }>`
            SELECT credential_id AS "credentialId"
            FROM workbench_jira_connections
            WHERE connection_id = ${connectionId}
            LIMIT 1
          `.pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]?.credentialId))),
        ),
      upsertConnection: (connection, credentialId) =>
        protect(saveConnection(connection, credentialId)),
      upsertConnections: (connections, credentialId) =>
        protect(
          sql.withTransaction(
            Effect.forEach(connections, (connection) => saveConnection(connection, credentialId), {
              concurrency: 1,
              discard: true,
            }),
          ),
        ),
      listBindings: () => protect(loadBindings()),
      getBinding: (id) =>
        protect(
          loadBindings().pipe(
            Effect.map((bindings) =>
              Option.fromNullishOr(bindings.find((binding) => binding.id === id)),
            ),
          ),
        ),
      upsertBinding: (binding) =>
        protect(
          Effect.gen(function* () {
            const repositoryIdsJson = yield* encodeJson(
              WorkbenchJiraBinding.fields.defaultRepositoryProjectIds,
              binding.defaultRepositoryProjectIds,
            );
            const statusMappingsJson = yield* encodeJson(
              WorkbenchJiraBinding.fields.statusMappings,
              binding.statusMappings,
            );
            const selectedSprintsJson = yield* encodeJson(
              WorkbenchJiraBinding.fields.selectedSprints,
              binding.selectedSprints,
            );
            const boardColumnsJson = yield* encodeJson(
              WorkbenchJiraBinding.fields.boardColumns,
              binding.boardColumns,
            );
            const observedActiveSprintIdsJson = yield* encodeJson(
              WorkbenchJiraBinding.fields.observedActiveSprintIds,
              binding.observedActiveSprintIds,
            );
            yield* sql`
            INSERT INTO workbench_jira_bindings (
              binding_id, workbench_project_id, connection_id, jira_project_id,
              jira_project_key, jira_project_name, board_id, board_name, sprint_id, sprint_name,
              selected_sprints_json, default_primary_t3_project_id, default_repository_project_ids_json,
              status_mappings_json, follow_active_sprint, observed_active_sprint_ids_json,
              board_mode, board_columns_json,
              active, last_synced_at, last_sync_error, created_at, updated_at
            ) VALUES (
              ${binding.id}, ${binding.projectId}, ${binding.connectionId}, ${binding.jiraProjectId},
              ${binding.jiraProjectKey}, ${binding.jiraProjectName}, ${binding.boardId},
              ${binding.boardName}, ${binding.sprintId}, ${binding.sprintName},
              ${selectedSprintsJson},
              ${binding.defaultPrimaryT3ProjectId},
              ${repositoryIdsJson},
              ${statusMappingsJson}, ${binding.followActiveSprint ? 1 : 0},
              ${observedActiveSprintIdsJson}, ${binding.boardMode},
              ${boardColumnsJson}, ${binding.active ? 1 : 0},
              ${binding.lastSyncedAt}, ${binding.lastSyncError}, ${binding.createdAt},
              ${binding.updatedAt}
            )
            ON CONFLICT(binding_id) DO UPDATE SET
              connection_id = excluded.connection_id,
              jira_project_id = excluded.jira_project_id,
              jira_project_key = excluded.jira_project_key,
              jira_project_name = excluded.jira_project_name,
              board_id = excluded.board_id,
              board_name = excluded.board_name,
              sprint_id = excluded.sprint_id,
              sprint_name = excluded.sprint_name,
              selected_sprints_json = excluded.selected_sprints_json,
              default_primary_t3_project_id = excluded.default_primary_t3_project_id,
              default_repository_project_ids_json = excluded.default_repository_project_ids_json,
              status_mappings_json = excluded.status_mappings_json,
              follow_active_sprint = excluded.follow_active_sprint,
              observed_active_sprint_ids_json = excluded.observed_active_sprint_ids_json,
              board_mode = excluded.board_mode,
              board_columns_json = excluded.board_columns_json,
              active = excluded.active,
              last_synced_at = excluded.last_synced_at,
              last_sync_error = excluded.last_sync_error,
              updated_at = excluded.updated_at
            `;
          }),
        ),
      updateBindingSyncMetadata: (input) =>
        protect(
          Effect.gen(function* () {
            const statusMappingsJson =
              input.statusMappings === undefined
                ? null
                : yield* encodeJson(
                    WorkbenchJiraBinding.fields.statusMappings,
                    input.statusMappings,
                  );
            const boardColumnsJson =
              input.boardColumns === undefined
                ? null
                : yield* encodeJson(WorkbenchJiraBinding.fields.boardColumns, input.boardColumns);
            const observedActiveSprintIdsJson =
              input.observedActiveSprintIds === undefined
                ? null
                : yield* encodeJson(
                    WorkbenchJiraBinding.fields.observedActiveSprintIds,
                    input.observedActiveSprintIds,
                  );
            const selectedSprintsJson =
              input.selectedSprints === undefined
                ? null
                : yield* encodeJson(
                    WorkbenchJiraBinding.fields.selectedSprints,
                    input.selectedSprints,
                  );
            const rows = yield* sql<{ readonly id: string }>`
              UPDATE workbench_jira_bindings
              SET
                sprint_id = COALESCE(${input.sprintId ?? null}, sprint_id),
                sprint_name = COALESCE(${input.sprintName ?? null}, sprint_name),
                selected_sprints_json = COALESCE(
                  ${selectedSprintsJson}, selected_sprints_json
                ),
                status_mappings_json = COALESCE(${statusMappingsJson}, status_mappings_json),
                board_columns_json = COALESCE(${boardColumnsJson}, board_columns_json),
                observed_active_sprint_ids_json = COALESCE(
                  ${observedActiveSprintIdsJson}, observed_active_sprint_ids_json
                ),
                last_synced_at = ${input.syncedAt},
                last_sync_error = NULL,
                updated_at = ${input.syncedAt}
              WHERE binding_id = ${input.id} AND updated_at = ${input.expectedUpdatedAt}
              RETURNING binding_id AS id
            `;
            return rows.length === 1;
          }),
        ),
      updateBindingSyncError: (input) =>
        protect(
          Effect.gen(function* () {
            const selectedSprintsJson =
              input.selectedSprints === undefined
                ? null
                : yield* encodeJson(
                    WorkbenchJiraBinding.fields.selectedSprints,
                    input.selectedSprints,
                  );
            const observedActiveSprintIdsJson =
              input.observedActiveSprintIds === undefined
                ? null
                : yield* encodeJson(
                    WorkbenchJiraBinding.fields.observedActiveSprintIds,
                    input.observedActiveSprintIds,
                  );
            const rows = yield* sql<{ readonly id: string }>`
              UPDATE workbench_jira_bindings
              SET
                selected_sprints_json = COALESCE(
                  ${selectedSprintsJson}, selected_sprints_json
                ),
                observed_active_sprint_ids_json = COALESCE(
                  ${observedActiveSprintIdsJson}, observed_active_sprint_ids_json
                ),
                last_sync_error = ${input.message}, updated_at = ${input.updatedAt}
              WHERE binding_id = ${input.id} AND updated_at = ${input.expectedUpdatedAt}
              RETURNING binding_id AS id
            `;
            return rows.length === 1;
          }),
        ),
      listIssueLinks: (bindingId) => protect(loadIssueLinks(bindingId)),
      replaceIssueLinks: (bindingId, links) =>
        protect(
          sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM workbench_jira_issue_links WHERE binding_id = ${bindingId}`;
              for (const link of links) {
                const issueJson = yield* encodeJson(
                  WorkbenchJiraIssueLink.fields.issue,
                  link.issue,
                );
                yield* sql`
                  INSERT INTO workbench_jira_issue_links (
                    binding_id, jira_issue_id, ticket_id, issue_json, active, linked_at, last_seen_at
                  ) VALUES (
                    ${bindingId}, ${link.issue.issueId}, ${link.ticketId},
                    ${issueJson}, ${link.active ? 1 : 0}, ${link.linkedAt},
                    ${link.lastSeenAt}
                  )
                `;
              }
            }),
          ),
        ),
    });
  }),
);
