import {
  WorkbenchJiraOperationError,
  type WorkbenchCreateTicketInput,
  type WorkbenchJiraBinding,
  type WorkbenchJiraGetTicketTransitionsInput,
  type WorkbenchJiraGetTicketTransitionsResult,
  type WorkbenchJiraIssueLink,
  type WorkbenchJiraIssueSnapshot,
  type WorkbenchJiraSelectedSprint,
  type WorkbenchJiraUpdateTicketInput,
  type WorkbenchTicketStatus,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { JiraApi } from "./JiraApi.ts";
import { JiraAuthService } from "./JiraAuthService.ts";
import { JiraSyncService } from "./JiraSyncService.ts";
import { JiraTicketImporter } from "./JiraTicketImporter.ts";
import { WorkbenchJiraRepository } from "./WorkbenchJiraRepository.ts";

const operationError = (code: WorkbenchJiraOperationError["code"], message: string) =>
  new WorkbenchJiraOperationError({ code, message });

const repositoryError = (_cause: unknown) =>
  operationError("persistence_failed", "Jira connection metadata could not be loaded.");

const selectedSprintsForBinding = (
  binding: Pick<WorkbenchJiraBinding, "sprintId" | "sprintName" | "selectedSprints">,
) =>
  binding.selectedSprints.length > 0
    ? binding.selectedSprints
    : ([
        { id: binding.sprintId, name: binding.sprintName },
      ] satisfies ReadonlyArray<WorkbenchJiraSelectedSprint>);

// Sync updates timestamps, errors, and sprint display names as bookkeeping. Those changes
// must not invalidate a write that was already waiting for the binding permit, while changes to
// the binding configuration still need the stale-write guard.
const bindingConfiguration = (binding: WorkbenchJiraBinding) =>
  JSON.stringify([
    binding.id,
    binding.projectId,
    binding.connectionId,
    binding.jiraProjectId,
    binding.jiraProjectKey,
    binding.jiraProjectName,
    binding.boardId,
    binding.boardName,
    binding.sprintId,
    selectedSprintsForBinding(binding)
      .map((sprint) => sprint.id)
      .sort((left, right) => left - right),
    binding.defaultPrimaryT3ProjectId,
    binding.defaultRepositoryProjectIds,
    binding.statusMappings,
    binding.followActiveSprint,
    binding.boardMode,
    binding.boardColumns,
    binding.localMigrationPending ?? false,
    binding.active,
    binding.createdAt,
  ]);

const sameBindingConfiguration = (left: WorkbenchJiraBinding, right: WorkbenchJiraBinding) =>
  bindingConfiguration(left) === bindingConfiguration(right);

const encodeCreationFingerprint = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      projectId: Schema.String,
      bindingId: Schema.String,
      connectionId: Schema.String,
      jiraProjectKey: Schema.String,
      boardId: Schema.Int,
      title: Schema.String,
      markdown: Schema.String,
      kind: Schema.String,
      epicId: Schema.NullOr(Schema.String),
      sprintId: Schema.Int,
      primaryT3ProjectId: Schema.String,
      repositoryProjectIds: Schema.Array(Schema.String),
    }),
  ),
);

type JiraTicketCreationRow = {
  readonly ticketId: string;
  readonly bindingId: string;
  readonly requestFingerprint: string;
  readonly resultTicketId: WorkbenchCreateTicketInput["id"] | null;
  readonly jiraIssueId: string | null;
  readonly jiraIssueKey: string | null;
  readonly state: "pending" | "uncertain" | "created";
};

const RawTransitionId = Schema.Union([Schema.String, Schema.Number]);
const RawTransition = Schema.Struct({
  id: RawTransitionId,
  name: Schema.String,
  to: Schema.Struct({
    id: RawTransitionId,
    name: Schema.String,
  }),
});
const TransitionPage = Schema.Struct({ transitions: Schema.Array(RawTransition) });

const UNMAPPED_TRANSITION_REASON = "This Jira status is not mapped to Workbench.";

const issueWriteError = (message: string) => operationError("request_failed", message);

const httpStatusErrorMessage = (status: number): string => {
  switch (status) {
    case 401:
      return "Jira rejected write authorization (HTTP 401). Reconnect Jira and grant issue write access.";
    case 403:
      return "Jira denied write access (HTTP 403). Check project permissions and the write:jira-work OAuth scope, then reconnect Jira.";
    case 404:
      return "Jira could not find this issue (HTTP 404). Refresh Jira and try again.";
    case 409:
      return "Jira rejected the change because the issue changed remotely. Refresh the Ticket and try again.";
    case 429:
      return "Jira is rate-limiting writes (HTTP 429). Wait a moment and try again.";
    default:
      return `Jira rejected the write (HTTP ${status}).`;
  }
};

interface ManagedIssue {
  readonly binding: WorkbenchJiraBinding;
  readonly link: WorkbenchJiraIssueLink;
}

const validateReadback = ({
  input,
  refreshed,
  mappedStatus,
  expectedStatusId,
}: {
  readonly input: WorkbenchJiraUpdateTicketInput;
  readonly refreshed: WorkbenchJiraIssueSnapshot;
  readonly mappedStatus: WorkbenchTicketStatus | undefined;
  readonly expectedStatusId: string | undefined;
}) => {
  if (mappedStatus === undefined) {
    return Effect.fail(
      operationError(
        "status_unmapped",
        `Jira returned status ${refreshed.status.name}, which is not mapped to a Workbench column.`,
      ),
    );
  }
  if (input.markdown !== undefined && (refreshed.description ?? "") !== input.markdown) {
    return Effect.fail(
      operationError(
        "request_failed",
        "Jira accepted the description update, but the refreshed issue still has different content. Refresh Jira before trying again.",
      ),
    );
  }
  if (expectedStatusId !== undefined && refreshed.status.id !== expectedStatusId) {
    return Effect.fail(
      operationError(
        "request_failed",
        `Jira accepted the status update, but the refreshed issue is still at Jira status ${refreshed.status.name}. Refresh Jira before trying again.`,
      ),
    );
  }
  if (input.status !== undefined && mappedStatus !== input.status) {
    return Effect.fail(
      operationError(
        "request_failed",
        `Jira accepted the status update, but the refreshed issue is still mapped to ${mappedStatus}. Refresh Jira before trying again.`,
      ),
    );
  }
  return Effect.succeed(mappedStatus);
};

export interface JiraTicketWriteServiceShape {
  readonly createTicket: (
    input: WorkbenchCreateTicketInput & {
      readonly binding: WorkbenchJiraBinding;
      /** Remote Epic ID used while publishing a local Epic. */
      readonly remoteEpicIssueId?: string;
    },
  ) => Effect.Effect<WorkbenchCreateTicketInput["id"], WorkbenchJiraOperationError>;
  readonly getTicketTransitions: (
    input: WorkbenchJiraGetTicketTransitionsInput,
  ) => Effect.Effect<WorkbenchJiraGetTicketTransitionsResult, WorkbenchJiraOperationError>;
  readonly updateTicket: (
    input: WorkbenchJiraUpdateTicketInput,
  ) => Effect.Effect<WorkbenchJiraIssueSnapshot, WorkbenchJiraOperationError>;
  /** Starts execution only after a fresh Jira todo status is transitioned and read back. */
  readonly startTicketExecution: (
    input: WorkbenchJiraGetTicketTransitionsInput,
  ) => Effect.Effect<WorkbenchJiraIssueSnapshot, WorkbenchJiraOperationError>;
}

export class JiraTicketWriteService extends Context.Service<
  JiraTicketWriteService,
  JiraTicketWriteServiceShape
>()("@t3tools/workbench/jira/JiraTicketWriteService") {}

export const make = Effect.gen(function* () {
  const api = yield* JiraApi;
  const auth = yield* JiraAuthService;
  const sync = yield* JiraSyncService;
  const importer = yield* JiraTicketImporter;
  const repository = yield* WorkbenchJiraRepository;
  const clock = yield* Clock.Clock;
  const sql = yield* SqlClient.SqlClient;
  const httpClient = yield* HttpClient.HttpClient;

  const execute = (input: {
    readonly path: string;
    readonly request: HttpClientRequest.HttpClientRequest;
  }) =>
    httpClient.execute(input.request).pipe(
      Effect.mapError(() => issueWriteError("The Jira write request could not be sent.")),
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? Effect.succeed(response)
          : Effect.fail(
              issueWriteError(
                `${httpStatusErrorMessage(response.status)} Jira endpoint: ${input.path}`,
              ),
            ),
      ),
    );

  const getConnectionAndToken = (binding: WorkbenchJiraBinding) =>
    Effect.gen(function* () {
      const connection = yield* repository
        .getConnection(binding.connectionId)
        .pipe(Effect.mapError(repositoryError));
      if (Option.isNone(connection)) {
        return yield* operationError("connection_not_found", "The Jira connection was not found.");
      }
      if (!connection.value.scopes.includes("write:jira-work")) {
        return yield* operationError(
          "authorization_failed",
          "Jira write access is not authorized. Reconnect Jira and grant the write:jira-work OAuth scope.",
        );
      }
      return {
        connection: connection.value,
        accessToken: yield* auth.getAccessToken(binding.connectionId),
      };
    });

  const loadCreation = (ticketId: string) =>
    sql<JiraTicketCreationRow>`
      SELECT
        ticket_id AS "ticketId",
        binding_id AS "bindingId",
        request_fingerprint AS "requestFingerprint",
        result_ticket_id AS "resultTicketId",
        jira_issue_id AS "jiraIssueId",
        jira_issue_key AS "jiraIssueKey",
        state
      FROM workbench_jira_ticket_creations
      WHERE ticket_id = ${ticketId}
      LIMIT 1
    `.pipe(Effect.map((rows) => rows[0]));

  const reserveCreation = (input: {
    readonly ticket: WorkbenchCreateTicketInput;
    readonly binding: WorkbenchJiraBinding;
    readonly fingerprint: string;
  }) =>
    Effect.gen(function* () {
      yield* sql`
        INSERT OR IGNORE INTO workbench_jira_ticket_creations (
          ticket_id, binding_id, title, kind, markdown, request_fingerprint, state, created_at, updated_at
        ) VALUES (
          ${input.ticket.id}, ${input.binding.id}, ${input.ticket.title}, ${input.ticket.kind},
          ${input.ticket.markdown}, ${input.fingerprint}, 'pending', ${input.ticket.createdAt}, ${input.ticket.createdAt}
        )
      `;
      return yield* loadMatchingCreation({
        ticketId: input.ticket.id,
        fingerprint: input.fingerprint,
      });
    });

  const markCreationUncertain = (ticketId: string, updatedAt: string) =>
    Effect.gen(function* () {
      const claimed = yield* sql<{ ticket_id: string }>`
        UPDATE workbench_jira_ticket_creations
        SET state = 'uncertain', updated_at = ${updatedAt}
        WHERE ticket_id = ${ticketId} AND jira_issue_id IS NULL AND state = 'pending'
        RETURNING ticket_id
      `;
      if (claimed.length === 0) {
        return yield* operationError(
          "request_failed",
          "This Jira creation is already in progress. Check Jira before starting another Ticket.",
        );
      }
    });

  const markCreationCreated = (input: {
    readonly ticketId: string;
    readonly jiraIssueId: string;
    readonly jiraIssueKey: string;
    readonly updatedAt: string;
  }) =>
    sql`
      UPDATE workbench_jira_ticket_creations
      SET state = 'created', jira_issue_id = ${input.jiraIssueId},
          jira_issue_key = ${input.jiraIssueKey}, updated_at = ${input.updatedAt}
      WHERE ticket_id = ${input.ticketId} AND jira_issue_id IS NULL
    `;

  const loadMatchingCreation = ({
    ticketId,
    fingerprint,
  }: {
    readonly ticketId: string;
    readonly fingerprint: string;
  }) =>
    Effect.gen(function* () {
      const existing = yield* loadCreation(ticketId).pipe(Effect.mapError(repositoryError));
      if (existing && existing.requestFingerprint !== fingerprint) {
        return yield* operationError(
          "invalid_binding",
          "This creation is already in progress with different content. Restore the original fields to retry, or check Jira before starting another Ticket.",
        );
      }
      if (existing?.state === "uncertain" && existing.jiraIssueId === null) {
        return yield* operationError(
          "request_failed",
          "Jira may have accepted this Ticket, but Workbench could not confirm it. Check Jira before starting another creation; this request will not be sent again.",
        );
      }
      return existing;
    });

  const ensureExistingLocalTicketRevision = (input: WorkbenchCreateTicketInput) =>
    Effect.gen(function* () {
      if (input.existingLocalTicketRevision === undefined) return;
      const rows = yield* sql<{ readonly revision: number; readonly deletedAt: string | null }>`
        SELECT revision, deleted_at AS "deletedAt"
        FROM workbench_tickets
        WHERE ticket_id = ${input.id}
        LIMIT 1
      `;
      if (rows[0]?.revision !== input.existingLocalTicketRevision || rows[0]?.deletedAt !== null) {
        return yield* operationError(
          "invalid_binding",
          "The local Ticket changed. Refresh before publishing it to Jira.",
        );
      }
    }).pipe(
      Effect.catchTag("SqlError", () =>
        Effect.fail(
          operationError(
            "persistence_failed",
            "The local Ticket revision could not be checked before the Jira write.",
          ),
        ),
      ),
    );

  const findManagedIssue = (ticketId: WorkbenchJiraUpdateTicketInput["ticketId"]) =>
    Effect.gen(function* () {
      const bindings = yield* repository.listBindings().pipe(Effect.mapError(repositoryError));
      const matches: Array<ManagedIssue> = [];
      for (const binding of bindings) {
        if (!binding.active) continue;
        const links = yield* repository
          .listIssueLinks(binding.id)
          .pipe(Effect.mapError(repositoryError));
        for (const link of links) {
          if (link.active && link.ticketId === ticketId) matches.push({ binding, link });
        }
      }
      if (matches.length === 0) {
        return yield* operationError(
          "invalid_binding",
          "This Ticket is not linked to an active Jira issue. Refresh Jira before editing it.",
        );
      }
      if (matches.length > 1) {
        return yield* operationError(
          "invalid_binding",
          "This Ticket is linked to more than one Jira issue. Refresh Jira and repair the duplicate links before editing it.",
        );
      }
      return matches[0]!;
    });

  const readAssignedIssue = (managed: ManagedIssue) =>
    Effect.gen(function* () {
      const selectedSprints = selectedSprintsForBinding(managed.binding);
      const issues = yield* Effect.forEach(
        selectedSprints,
        (sprint) =>
          api.listAssignedSprintIssues({
            connectionId: managed.binding.connectionId,
            boardId: managed.binding.boardId,
            sprintId: sprint.id,
          }),
        { concurrency: 1 },
      );
      const issue = issues
        .flat()
        .find((candidate) => candidate.issueId === managed.link.issue.issueId);
      if (issue === undefined) {
        return yield* operationError(
          "invalid_binding",
          "This Jira issue is no longer assigned to you in the selected sprint(s). Refresh Jira before editing it.",
        );
      }
      return issue;
    });

  const getTransitions = (input: {
    readonly issueId: string;
    readonly accessToken: string;
    readonly cloudId: string;
  }) => {
    const path = `/rest/api/2/issue/${encodeURIComponent(input.issueId)}/transitions`;
    const url = `https://api.atlassian.com/ex/jira/${encodeURIComponent(input.cloudId)}${path}`;
    return execute({
      path,
      request: HttpClientRequest.get(url).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(input.accessToken),
      ),
    }).pipe(
      Effect.flatMap((response) =>
        HttpClientResponse.schemaBodyJson(TransitionPage)(response).pipe(
          Effect.mapError(() =>
            operationError("response_invalid", "Jira returned an unexpected transition response."),
          ),
        ),
      ),
      Effect.map((page) =>
        page.transitions.map((transition) => ({
          id: String(transition.id),
          name: transition.name,
          to: { id: String(transition.to.id), name: transition.to.name },
        })),
      ),
    );
  };

  const updateDescription = (input: {
    readonly issueId: string;
    readonly accessToken: string;
    readonly cloudId: string;
    readonly markdown: string;
  }) => {
    const path = `/rest/api/2/issue/${encodeURIComponent(input.issueId)}`;
    const url = `https://api.atlassian.com/ex/jira/${encodeURIComponent(input.cloudId)}${path}`;
    return execute({
      path,
      request: HttpClientRequest.put(url).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(input.accessToken),
        HttpClientRequest.bodyJsonUnsafe({ fields: { description: input.markdown } }),
      ),
    }).pipe(Effect.asVoid);
  };

  const applyTransition = (input: {
    readonly issueId: string;
    readonly accessToken: string;
    readonly cloudId: string;
    readonly transitionId: string;
  }) => {
    const path = `/rest/api/2/issue/${encodeURIComponent(input.issueId)}/transitions`;
    const url = `https://api.atlassian.com/ex/jira/${encodeURIComponent(input.cloudId)}${path}`;
    return execute({
      path,
      request: HttpClientRequest.post(url).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(input.accessToken),
        HttpClientRequest.bodyJsonUnsafe({ transition: { id: input.transitionId } }),
      ),
    }).pipe(Effect.asVoid);
  };

  const persistProjection = (input: {
    readonly managed: ManagedIssue;
    readonly issue: WorkbenchJiraIssueSnapshot;
    readonly mappedStatus: WorkbenchTicketStatus;
    readonly syncedAt: string;
  }) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* importer.upsertJiraProjection({
            binding: input.managed.binding,
            existingTicketId: input.managed.link.ticketId,
            issue: input.issue,
            mappedStatus: input.mappedStatus,
          });
          const links = yield* repository
            .listIssueLinks(input.managed.binding.id)
            .pipe(Effect.mapError(repositoryError));
          const targetLink = links.find(
            (link) =>
              link.ticketId === input.managed.link.ticketId &&
              link.issue.issueId === input.managed.link.issue.issueId &&
              link.active,
          );
          if (targetLink === undefined) {
            return yield* operationError(
              "persistence_failed",
              "The Jira issue was updated, but its local Workbench link disappeared. Refresh Jira to repair the local Ticket.",
            );
          }
          yield* repository
            .replaceIssueLinks(
              input.managed.binding.id,
              links.map((link) =>
                link === targetLink
                  ? { ...link, issue: input.issue, lastSeenAt: input.syncedAt }
                  : link,
              ),
            )
            .pipe(Effect.mapError(repositoryError));
        }),
      )
      .pipe(
        Effect.catchTag("SqlError", () =>
          Effect.fail(
            operationError(
              "persistence_failed",
              "Workbench could not save the local Ticket. Refresh Jira and try again.",
            ),
          ),
        ),
        Effect.mapError((error) =>
          operationError(
            "persistence_failed",
            `Jira was updated, but Workbench could not save the local Ticket: ${error.message}`,
          ),
        ),
      );

  const createTicket = (
    input: WorkbenchCreateTicketInput & {
      readonly binding: WorkbenchJiraBinding;
      readonly remoteEpicIssueId?: string;
    },
  ): Effect.Effect<WorkbenchCreateTicketInput["id"], WorkbenchJiraOperationError> =>
    Effect.gen(function* () {
      if (!input.binding.active) {
        return yield* operationError(
          "binding_inactive",
          "This Jira Workspace is paused. Resume the Jira binding before creating Tickets.",
        );
      }
      const selectedSprints = selectedSprintsForBinding(input.binding);
      const sprint =
        input.jiraSprintId === undefined
          ? selectedSprints.length === 1
            ? selectedSprints[0]
            : undefined
          : selectedSprints.find((candidate) => candidate.id === input.jiraSprintId);
      if (sprint === undefined) {
        return yield* operationError(
          "invalid_binding",
          input.jiraSprintId === undefined
            ? "Select a Jira sprint before creating a Ticket because this Workspace has multiple selected sprints."
            : "The selected Jira sprint is not configured for this Workspace.",
        );
      }
      const { connection } = yield* getConnectionAndToken(input.binding);
      const missingScopes = ["read:jira-user", "write:sprint:jira-software"].filter(
        (scope) => !connection.scopes.includes(scope),
      );
      if (missingScopes.length > 0) {
        return yield* operationError(
          "authorization_failed",
          `Reconnect Jira to create Tickets. Required access: ${missingScopes.join(", ")}.`,
        );
      }
      const fingerprint = encodeCreationFingerprint({
        projectId: input.projectId,
        bindingId: input.binding.id,
        connectionId: input.binding.connectionId,
        jiraProjectKey: input.binding.jiraProjectKey,
        boardId: input.binding.boardId,
        title: input.title,
        markdown: input.markdown,
        kind: input.kind,
        epicId: input.remoteEpicIssueId ?? input.epicId ?? null,
        sprintId: sprint.id,
        primaryT3ProjectId: input.primaryT3ProjectId,
        repositoryProjectIds: input.repositoryProjectIds ?? [input.primaryT3ProjectId],
      });
      return yield* sync.withBindingPermit(
        input.binding.id,
        Effect.gen(function* () {
          const currentBinding = yield* repository
            .getBinding(input.binding.id)
            .pipe(Effect.mapError(repositoryError));
          if (
            Option.isNone(currentBinding) ||
            !currentBinding.value.active ||
            !sameBindingConfiguration(currentBinding.value, input.binding)
          ) {
            return yield* operationError(
              "invalid_binding",
              "The Jira configuration changed. Refresh the Workspace before creating a Ticket.",
            );
          }
          // Migration callers provide the local revision they confirmed. Check
          // it before any resumable fast path so a completed creation cannot
          // silently succeed after the local Ticket was edited.
          yield* ensureExistingLocalTicketRevision(input);
          const existing = yield* loadMatchingCreation({ ticketId: input.id, fingerprint });
          if (existing?.resultTicketId) return existing.resultTicketId;
          // Preflight reads can fail safely: do not reserve an ambiguous write until they pass.
          const prepared = existing?.jiraIssueId
            ? undefined
            : yield* api.prepareIssueCreation({
                connectionId: input.binding.connectionId,
                projectKey: input.binding.jiraProjectKey,
                kind: input.kind,
              });
          const creation =
            existing ??
            (yield* reserveCreation({ ticket: input, binding: input.binding, fingerprint }).pipe(
              Effect.mapError(repositoryError),
            ));
          if (!creation)
            return yield* operationError(
              "persistence_failed",
              "Could not reserve Jira Ticket creation.",
            );
          let jiraIssueId = creation.jiraIssueId;
          let jiraIssueKey = creation.jiraIssueKey;
          if (jiraIssueId === null || jiraIssueKey === null) {
            if (!prepared)
              return yield* operationError(
                "request_failed",
                "Jira creation metadata is unavailable.",
              );
            // Recheck immediately before POST so a concurrent local edit cannot be overwritten.
            yield* ensureExistingLocalTicketRevision(input);
            // Persist before POST: a crash or failed response must never permit a duplicate POST.
            yield* markCreationUncertain(input.id, input.createdAt).pipe(
              Effect.mapError(repositoryError),
            );
            const created = yield* api
              .createIssue({
                connectionId: input.binding.connectionId,
                projectKey: input.binding.jiraProjectKey,
                ticket: input,
                ...prepared,
                ...(input.remoteEpicIssueId !== undefined
                  ? { epicIssueId: input.remoteEpicIssueId }
                  : input.epicId
                    ? {
                        epicIssueId: input.epicId.slice(`jira:${input.binding.id}:epic:`.length),
                      }
                    : {}),
              })
              .pipe(
                Effect.catch((error) =>
                  Effect.gen(function* () {
                    if (error.outcome === "rejected") {
                      yield* sql`DELETE FROM workbench_jira_ticket_creations WHERE ticket_id = ${input.id} AND jira_issue_id IS NULL`.pipe(
                        Effect.mapError(repositoryError),
                      );
                    }
                    return yield* operationError("request_failed", error.message);
                  }),
                ),
              );
            jiraIssueId = created.id;
            jiraIssueKey = created.key;
            yield* markCreationCreated({
              ticketId: input.id,
              jiraIssueId,
              jiraIssueKey,
              updatedAt: input.createdAt,
            }).pipe(
              Effect.mapError(() =>
                operationError(
                  "persistence_failed",
                  "Jira created the Ticket, but Workbench could not save its resumable creation state.",
                ),
              ),
            );
          }

          yield* api.addIssueToSprint({
            connectionId: input.binding.connectionId,
            sprintId: sprint.id,
            issueKey: jiraIssueKey,
          });
          const assignedIssues = yield* api.listAssignedSprintIssues({
            connectionId: input.binding.connectionId,
            boardId: input.binding.boardId,
            sprintId: sprint.id,
            // Jira's sprint search can lag immediately after the successful move. Ask the
            // endpoint to reconcile this issue while retaining its board, sprint, and assignee
            // filters before deciding that creation cannot be projected locally.
            reconcileIssueIds: [jiraIssueId],
          });
          const issue = assignedIssues.find((candidate) => candidate.issueId === jiraIssueId);
          if (issue === undefined) {
            return yield* operationError(
              "request_failed",
              `Jira issue ${jiraIssueKey} was created, but Workbench could not read it in the selected sprint. Refresh Jira before retrying.`,
            );
          }
          const mappedStatus = input.binding.statusMappings.find(
            (mapping) => mapping.jiraStatusId === issue.status.id,
          )?.workbenchStatus;
          if (mappedStatus === undefined) {
            return yield* operationError(
              "status_unmapped",
              `Jira created ${jiraIssueKey} with status ${issue.status.name}, which is not mapped to a Workbench column.`,
            );
          }

          const syncedAt = DateTime.formatIso(DateTime.makeUnsafe(yield* clock.currentTimeMillis));
          const ticketId = yield* sql
            .withTransaction(
              Effect.gen(function* () {
                yield* ensureExistingLocalTicketRevision(input);
                const links = yield* repository
                  .listIssueLinks(input.binding.id)
                  .pipe(Effect.mapError(repositoryError));
                const existingLink = links.find((link) => link.issue.issueId === issue.issueId);
                const projectedId = existingLink?.ticketId ?? input.id;
                yield* importer.upsertJiraProjection({
                  binding: input.binding,
                  existingTicketId: projectedId,
                  issue,
                  mappedStatus,
                  ...(input.primaryT3ProjectId === undefined
                    ? {}
                    : { primaryT3ProjectId: input.primaryT3ProjectId }),
                  repositoryProjectIds: input.repositoryProjectIds ?? [input.primaryT3ProjectId],
                });
                const targetLink: WorkbenchJiraIssueLink = {
                  bindingId: input.binding.id,
                  ticketId: projectedId,
                  issue,
                  active: true,
                  linkedAt: existingLink?.linkedAt ?? syncedAt,
                  lastSeenAt: syncedAt,
                };
                yield* repository
                  .replaceIssueLinks(
                    input.binding.id,
                    links.filter((link) => link.issue.issueId !== issue.issueId).concat(targetLink),
                  )
                  .pipe(Effect.mapError(repositoryError));
                yield* sql`UPDATE workbench_jira_ticket_creations SET result_ticket_id = ${projectedId} WHERE ticket_id = ${input.id}`;
                return projectedId;
              }),
            )
            .pipe(
              Effect.catch(() =>
                Effect.fail(
                  operationError(
                    "persistence_failed",
                    "Jira created the Ticket, but Workbench could not save its local link. Retry to resume the saved creation.",
                  ),
                ),
              ),
            );
          return ticketId;
        }),
      );
    });

  const selectTransition = (input: {
    readonly transitions: ReadonlyArray<{
      readonly id: string;
      readonly to: { readonly id: string; readonly name: string };
    }>;
    readonly statusMappings: WorkbenchJiraBinding["statusMappings"];
    readonly targetStatus: WorkbenchTicketStatus | undefined;
    readonly targetStatusIds?: ReadonlyArray<string>;
    readonly currentStatusName: string;
  }) => {
    const candidates = input.transitions.filter((transition) =>
      input.statusMappings.some(
        (mapping) =>
          (input.targetStatusIds === undefined ||
            input.targetStatusIds.includes(transition.to.id)) &&
          mapping.jiraStatusId === transition.to.id &&
          mapping.workbenchStatus === input.targetStatus,
      ),
    );
    if (candidates.length === 0) {
      return Effect.fail(
        operationError(
          "invalid_binding",
          `Jira does not offer a transition from ${input.currentStatusName} to the Workbench ${input.targetStatus} state. Update the Jira workflow or status mapping first.`,
        ),
      );
    }
    if (candidates.length > 1) {
      return Effect.fail(
        operationError(
          "invalid_binding",
          `Jira offers multiple transitions to the Workbench ${input.targetStatus} state. Choose the transition in Jira or adjust the status mapping so Workbench does not guess.`,
        ),
      );
    }
    return Effect.succeed(candidates[0]!);
  };

  const resolveTransition = (input: {
    readonly binding: WorkbenchJiraBinding;
    readonly issueId: string;
    readonly currentStatusName: string;
    readonly status: WorkbenchTicketStatus | undefined;
    readonly transitionId: string | undefined;
    readonly targetStatusIds?: ReadonlyArray<string>;
  }) =>
    Effect.gen(function* () {
      const credentials = yield* getConnectionAndToken(input.binding);
      const transitions = yield* getTransitions({
        issueId: input.issueId,
        accessToken: credentials.accessToken,
        cloudId: credentials.connection.cloudId,
      });
      const candidate =
        input.transitionId !== undefined
          ? transitions.find((transition) => transition.id === input.transitionId)
          : yield* selectTransition({
              transitions,
              statusMappings: input.binding.statusMappings,
              targetStatus: input.status,
              ...(input.targetStatusIds === undefined
                ? {}
                : { targetStatusIds: input.targetStatusIds }),
              currentStatusName: input.currentStatusName,
            });
      if (candidate === undefined) {
        return yield* operationError(
          "invalid_binding",
          "The selected Jira transition is no longer available. Refresh the Ticket and try again.",
        );
      }
      const transitionStatusMapping = input.binding.statusMappings.find(
        (mapping) => mapping.jiraStatusId === candidate.to.id,
      );
      if (transitionStatusMapping === undefined) {
        return yield* operationError(
          "status_unmapped",
          `Jira status ${candidate.to.name} is not mapped to a Workbench column.`,
        );
      }
      return {
        id: candidate.id,
        accessToken: credentials.accessToken,
        cloudId: credentials.connection.cloudId,
        destinationStatusId: input.transitionId !== undefined ? candidate.to.id : undefined,
        toStatusId: candidate.to.id,
      };
    });

  const getTicketTransitions: JiraTicketWriteServiceShape["getTicketTransitions"] = (input) =>
    Effect.gen(function* () {
      const initial = yield* findManagedIssue(input.ticketId);
      return yield* sync.withBindingPermit(
        initial.binding.id,
        Effect.gen(function* () {
          const managed = yield* findManagedIssue(input.ticketId);
          if (
            !sameBindingConfiguration(managed.binding, initial.binding) ||
            managed.link.issue.issueId !== initial.link.issue.issueId
          ) {
            return yield* operationError(
              "invalid_binding",
              "The Jira Ticket link changed while transitions were loading. Refresh the Ticket and try again.",
            );
          }
          // Choices are background-cache data. The write path rereads Jira and
          // validates this revision before applying a selected transition.
          const current = managed.link.issue;
          const credentials = yield* getConnectionAndToken(managed.binding);
          const transitions = yield* getTransitions({
            issueId: current.issueId,
            accessToken: credentials.accessToken,
            cloudId: credentials.connection.cloudId,
          });
          return {
            transitions: transitions.map((transition) => ({
              ...transition,
              unavailableReason: managed.binding.statusMappings.some(
                (mapping) => mapping.jiraStatusId === transition.to.id,
              )
                ? null
                : UNMAPPED_TRANSITION_REASON,
            })),
            remoteUpdatedAt: current.remoteUpdatedAt,
          };
        }),
      );
    });

  const updateTicket: JiraTicketWriteServiceShape["updateTicket"] = (input) =>
    Effect.gen(function* () {
      const hasMarkdown = input.markdown !== undefined;
      const hasStatus = input.status !== undefined;
      const hasTransition = input.transitionId !== undefined;
      if ([hasMarkdown, hasStatus, hasTransition].filter(Boolean).length !== 1) {
        return yield* operationError(
          "invalid_binding",
          "Update exactly one Jira Ticket field at a time: description, status, or transition.",
        );
      }
      const initial = yield* findManagedIssue(input.ticketId);
      return yield* sync.withBindingPermit(
        initial.binding.id,
        Effect.gen(function* () {
          // The lookup above only identifies the lock. Re-read inside the permit so a sync or
          // binding edit that was already queued cannot turn this request into a write against a
          // stale issue link or sprint selection.
          const managed = yield* findManagedIssue(input.ticketId);
          if (
            !sameBindingConfiguration(managed.binding, initial.binding) ||
            managed.link.issue.issueId !== initial.link.issue.issueId
          ) {
            return yield* operationError(
              "invalid_binding",
              "The Jira Ticket link changed while the update was waiting. Refresh the Ticket and try again.",
            );
          }
          const current = yield* readAssignedIssue(managed);
          if (current.remoteUpdatedAt === null || input.expectedRemoteUpdatedAt === null) {
            return yield* operationError(
              "invalid_binding",
              "Jira did not provide a remote update timestamp. Refresh the Ticket before saving your edits.",
            );
          }
          if (current.remoteUpdatedAt !== input.expectedRemoteUpdatedAt) {
            return yield* operationError(
              "invalid_binding",
              "This Jira Ticket changed remotely. Refresh the Ticket before saving your edits.",
            );
          }

          const description = current.description ?? "";
          const descriptionChanged = input.markdown !== undefined && input.markdown !== description;
          const currentMappedStatus = managed.binding.statusMappings.find(
            (mapping) => mapping.jiraStatusId === current.status.id,
          )?.workbenchStatus;
          if (input.status !== undefined && currentMappedStatus === undefined) {
            return yield* operationError(
              "status_unmapped",
              `Jira status ${current.status.name} is not mapped to a Workbench column.`,
            );
          }
          const statusChanged = input.status !== undefined && input.status !== currentMappedStatus;
          let transition:
            | {
                readonly id: string;
                readonly accessToken: string;
                readonly cloudId: string;
                readonly destinationStatusId: string | undefined;
              }
            | undefined;
          if (statusChanged || hasTransition) {
            transition = yield* resolveTransition({
              binding: managed.binding,
              issueId: current.issueId,
              currentStatusName: current.status.name,
              status: input.status,
              transitionId: input.transitionId,
            });
          }

          if (descriptionChanged && input.markdown !== undefined) {
            const credentials = yield* getConnectionAndToken(managed.binding);
            yield* updateDescription({
              issueId: current.issueId,
              accessToken: credentials.accessToken,
              cloudId: credentials.connection.cloudId,
              markdown: input.markdown,
            });
          }
          if (transition !== undefined) {
            yield* applyTransition({
              issueId: current.issueId,
              accessToken: transition.accessToken,
              cloudId: transition.cloudId,
              transitionId: transition.id,
            });
          }

          const refreshed = yield* readAssignedIssue(managed).pipe(
            Effect.mapError((error) =>
              operationError(
                "request_failed",
                `Jira accepted the Ticket change, but Workbench could not read it back: ${error.message} Refresh Jira before trying again.`,
              ),
            ),
          );
          const mappedStatus = managed.binding.statusMappings.find(
            (mapping) => mapping.jiraStatusId === refreshed.status.id,
          )?.workbenchStatus;
          const validatedStatus = yield* validateReadback({
            input,
            refreshed,
            mappedStatus,
            expectedStatusId: transition?.destinationStatusId,
          });
          const syncedAt = DateTime.formatIso(DateTime.makeUnsafe(yield* clock.currentTimeMillis));
          yield* persistProjection({
            managed,
            issue: refreshed,
            mappedStatus: validatedStatus,
            syncedAt,
          });
          return refreshed;
        }),
      );
    });

  const startTicketExecution: JiraTicketWriteServiceShape["startTicketExecution"] = (input) =>
    Effect.gen(function* () {
      const initial = yield* findManagedIssue(input.ticketId);
      return yield* sync.withBindingPermit(
        initial.binding.id,
        Effect.gen(function* () {
          const managed = yield* findManagedIssue(input.ticketId);
          if (
            managed.binding.id !== initial.binding.id ||
            managed.binding.connectionId !== initial.binding.connectionId ||
            managed.link.issue.issueId !== initial.link.issue.issueId
          ) {
            return yield* operationError(
              "invalid_binding",
              "The Jira Ticket link changed while execution was starting. Refresh Jira before trying again.",
            );
          }
          const current = yield* readAssignedIssue(managed);
          const currentMappedStatus = managed.binding.statusMappings.find(
            (mapping) => mapping.jiraStatusId === current.status.id,
          )?.workbenchStatus;
          if (currentMappedStatus === undefined) {
            return yield* operationError(
              "status_unmapped",
              `Jira status ${current.status.name} is not mapped to a Workbench column.`,
            );
          }

          // A sync or another execution may have already advanced this issue. Read it back into
          // the local projection while preserving that further-along Jira-owned status.
          if (currentMappedStatus !== "todo") {
            const syncedAt = DateTime.formatIso(
              DateTime.makeUnsafe(yield* clock.currentTimeMillis),
            );
            yield* persistProjection({
              managed,
              issue: current,
              mappedStatus: currentMappedStatus,
              syncedAt,
            });
            return current;
          }
          if (current.remoteUpdatedAt === null) {
            return yield* operationError(
              "invalid_binding",
              "Jira did not provide a remote update timestamp. Refresh the Ticket before starting execution.",
            );
          }

          // Mirror columns preserve workflow order; later review columns also map to
          // in_progress, but starting execution belongs in the first working column.
          const startColumn =
            managed.binding.boardMode === "mirror_jira"
              ? managed.binding.boardColumns.find(
                  (column) =>
                    !column.done &&
                    column.statusIds.some((id) =>
                      managed.binding.statusMappings.some(
                        (mapping) =>
                          mapping.jiraStatusId === id && mapping.workbenchStatus === "in_progress",
                      ),
                    ),
                )
              : undefined;
          const transition = yield* resolveTransition({
            ...(startColumn === undefined ? {} : { targetStatusIds: startColumn.statusIds }),
            binding: managed.binding,
            issueId: current.issueId,
            currentStatusName: current.status.name,
            status: "in_progress",
            transitionId: undefined,
          });
          yield* applyTransition({
            issueId: current.issueId,
            accessToken: transition.accessToken,
            cloudId: transition.cloudId,
            transitionId: transition.id,
          });

          const refreshed = yield* readAssignedIssue(managed).pipe(
            Effect.mapError((error) =>
              operationError(
                "request_failed",
                `Jira accepted the status update, but Workbench could not read it back: ${error.message} Refresh Jira before trying again.`,
              ),
            ),
          );
          const mappedStatus = managed.binding.statusMappings.find(
            (mapping) => mapping.jiraStatusId === refreshed.status.id,
          )?.workbenchStatus;
          const validatedStatus = yield* validateReadback({
            input: {
              ticketId: input.ticketId,
              status: "in_progress",
              expectedRemoteUpdatedAt: current.remoteUpdatedAt,
            },
            refreshed,
            mappedStatus,
            expectedStatusId: transition.toStatusId,
          });
          const syncedAt = DateTime.formatIso(DateTime.makeUnsafe(yield* clock.currentTimeMillis));
          yield* persistProjection({
            managed,
            issue: refreshed,
            mappedStatus: validatedStatus,
            syncedAt,
          });
          return refreshed;
        }),
      );
    });

  return JiraTicketWriteService.of({
    createTicket,
    getTicketTransitions,
    updateTicket,
    startTicketExecution,
  });
});

export const layer = Layer.effect(JiraTicketWriteService, make);
