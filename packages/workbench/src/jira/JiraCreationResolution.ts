import {
  WorkbenchJiraOperationError,
  WorkbenchTicketId,
  WorkbenchTicketKind,
  type WorkbenchJiraBinding,
  type WorkbenchJiraResolveCreationInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as WorkbenchStore from "../WorkbenchStore.ts";
import { JiraApi } from "./JiraApi.ts";

interface UncertainCreationRow {
  readonly requestFingerprint: string;
  readonly kind: string;
  readonly createdAt: string;
  readonly state: string;
  readonly jiraIssueId: string | null;
}

const invalid = (message: string) =>
  new WorkbenchJiraOperationError({ code: "invalid_binding", message });

const decodeSavedBinding = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      bindingId: Schema.String,
      connectionId: Schema.String,
      jiraProjectKey: Schema.String,
    }),
  ),
);
const decodeTicketKind = Schema.decodeUnknownEffect(WorkbenchTicketKind);

/** Caller holds the binding permit across verification, mutation, and completion. */
export const resolveUncertainCreation = Effect.fn(
  "JiraCreationResolution.resolveUncertainCreation",
)(function* (input: WorkbenchJiraResolveCreationInput, binding: WorkbenchJiraBinding) {
  const sql = yield* SqlClient.SqlClient;
  const api = yield* JiraApi;
  const table =
    input.kind === "ticket" ? "workbench_jira_ticket_creations" : "workbench_jira_epic_creations";
  const idColumn = input.kind === "ticket" ? "ticket_id" : "epic_id";
  const clearUncertainCreation = Effect.gen(function* () {
    const deleted = yield* sql`
        DELETE FROM ${sql(table)}
        WHERE ${sql(idColumn)} = ${input.id} AND binding_id = ${binding.id} AND state = 'uncertain' AND jira_issue_id IS NULL
        RETURNING ${sql(idColumn)}
      `;
    if (deleted.length !== 1)
      return yield* invalid(
        "The Jira creation changed. Refresh the Workspace before resolving it.",
      );
    if (input.kind !== "ticket") return;
    const drafts = yield* sql<{ readonly revision: number }>`
        SELECT revision FROM workbench_ticket_drafts WHERE draft_id = ${input.id} AND phase = 'promoting'
      `;
    if (drafts[0]) {
      const workbench = yield* WorkbenchStore.WorkbenchStore;
      // A failed restoration must retain the ledger so retry cannot POST a duplicate.
      yield* workbench
        .restoreUncreatedTicketDraft({
          id: WorkbenchTicketId.make(input.id),
          expectedRevision: drafts[0].revision,
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new WorkbenchJiraOperationError({
                code: "persistence_failed",
                message: error.message,
              }),
          ),
        );
    }
  });
  const rows = yield* sql<UncertainCreationRow>`
    SELECT request_fingerprint AS "requestFingerprint",
           ${input.kind === "ticket" ? sql("kind") : sql.literal("'epic'")} AS kind,
           created_at AS "createdAt", state, jira_issue_id AS "jiraIssueId"
    FROM ${sql(table)} WHERE ${sql(idColumn)} = ${input.id} AND binding_id = ${binding.id}
  `;
  const row = rows[0];
  if (!row || row.state !== "uncertain" || row.jiraIssueId !== null) {
    return yield* invalid(
      "Only an uncertain Jira creation without a confirmed issue can be resolved. Refresh the Workspace.",
    );
  }
  if (input.outcome.type === "not_created") {
    yield* sql.withTransaction(clearUncertainCreation);
    return { row, issue: null, linkedId: null };
  }
  const savedBinding = yield* decodeSavedBinding(row.requestFingerprint).pipe(
    Effect.mapError(() => invalid("The saved Jira creation cannot be read.")),
  );
  if (
    savedBinding.bindingId !== binding.id ||
    savedBinding.connectionId !== binding.connectionId ||
    savedBinding.jiraProjectKey !== binding.jiraProjectKey
  ) {
    return yield* invalid(
      "The Jira binding changed since this creation. Restore its original configuration before resolving it.",
    );
  }
  if (!api.getCreationIssue)
    return yield* invalid("Jira creation verification is unavailable on this server.");
  const issue = yield* api.getCreationIssue({
    connectionId: binding.connectionId,
    issueKey: input.outcome.issueKey,
  });
  if (issue.projectId !== binding.jiraProjectId)
    return yield* invalid("The Jira issue belongs to a different project.");
  const prepared =
    input.kind === "epic"
      ? api.prepareEpicCreation
        ? yield* api.prepareEpicCreation({
            connectionId: binding.connectionId,
            projectKey: binding.jiraProjectKey,
          })
        : undefined
      : yield* api.prepareIssueCreation({
          connectionId: binding.connectionId,
          projectKey: binding.jiraProjectKey,
          kind: yield* decodeTicketKind(row.kind).pipe(
            Effect.mapError(() => invalid("The saved Ticket type is invalid.")),
          ),
        });
  if (!prepared || issue.issueTypeId !== prepared.issueTypeId)
    return yield* invalid("The Jira issue type does not match this saved creation.");
  const linkedId = yield* sql.withTransaction(
    Effect.gen(function* () {
      const linked =
        input.kind === "ticket"
          ? yield* sql<{ readonly id: string }>`
              SELECT l.ticket_id AS id FROM workbench_jira_issue_links l
              JOIN workbench_tickets t ON t.ticket_id = l.ticket_id
              WHERE l.binding_id = ${binding.id} AND l.jira_issue_id = ${issue.id}
                AND t.workbench_project_id = ${binding.projectId} AND t.deleted_at IS NULL
            `
          : yield* sql<{ readonly id: string }>`
              SELECT e.epic_id AS id FROM workbench_epics e
              WHERE e.workbench_project_id = ${binding.projectId} AND (
                EXISTS (SELECT 1 FROM workbench_jira_epic_links l
                  WHERE l.binding_id = ${binding.id} AND l.jira_issue_id = ${issue.id} AND l.epic_id = e.epic_id)
                OR (e.epic_id = ${`jira:${binding.id}:epic:${issue.id}`} AND NOT EXISTS (
                  SELECT 1 FROM workbench_jira_epic_links l WHERE l.binding_id = ${binding.id} AND l.jira_issue_id = ${issue.id}
                ))
              )
            `;
      const existingId = linked[0]?.id ?? null;
      // Keep an imported record's identity; never move native work from the original.
      const duplicates = yield* sql`
    SELECT 1 WHERE EXISTS (
      SELECT 1 FROM workbench_jira_issue_links l JOIN workbench_jira_bindings b ON b.binding_id = l.binding_id
      WHERE b.connection_id = ${binding.connectionId} AND l.jira_issue_id = ${issue.id}
        AND NOT (${input.kind === "ticket" && existingId !== null ? 1 : 0} AND l.binding_id = ${binding.id} AND l.ticket_id = ${existingId})
    ) OR EXISTS (
      SELECT 1 FROM workbench_jira_epic_links l JOIN workbench_jira_bindings b ON b.binding_id = l.binding_id
      WHERE b.connection_id = ${binding.connectionId} AND l.jira_issue_id = ${issue.id}
        AND NOT (${input.kind === "epic" && existingId !== null ? 1 : 0} AND l.binding_id = ${binding.id} AND l.epic_id = ${existingId})
    ) OR EXISTS (
      SELECT 1 FROM workbench_epics e JOIN workbench_jira_bindings b
        ON e.workbench_project_id = b.workbench_project_id
        AND e.epic_id = 'jira:' || b.binding_id || ':epic:' || ${issue.id}
      WHERE b.connection_id = ${binding.connectionId}
        AND NOT (${input.kind === "epic" && existingId !== null ? 1 : 0} AND b.binding_id = ${binding.id} AND e.epic_id = ${existingId})
    ) OR EXISTS (
      SELECT 1 FROM workbench_jira_ticket_creations c JOIN workbench_jira_bindings b ON b.binding_id = c.binding_id
      WHERE b.connection_id = ${binding.connectionId} AND c.jira_issue_id = ${issue.id}
    ) OR EXISTS (
      SELECT 1 FROM workbench_jira_epic_creations c JOIN workbench_jira_bindings b ON b.binding_id = c.binding_id
      WHERE b.connection_id = ${binding.connectionId} AND c.jira_issue_id = ${issue.id}
    )
  `;
      if (duplicates.length > 0)
        return yield* invalid(
          "This Jira issue is already linked to another saved creation or Workbench item.",
        );
      if (existingId !== null) {
        yield* clearUncertainCreation;
        return existingId;
      }
      const updated = yield* sql`
    UPDATE ${sql(table)} SET state = 'created', jira_issue_id = ${issue.id}, jira_issue_key = ${issue.key}
    WHERE ${sql(idColumn)} = ${input.id} AND binding_id = ${binding.id} AND state = 'uncertain' AND jira_issue_id IS NULL
    RETURNING ${sql(idColumn)}
  `;
      if (updated.length !== 1)
        return yield* invalid(
          "The Jira creation changed. Refresh the Workspace before resolving it.",
        );
      return null;
    }),
  );
  return { row, issue, linkedId };
});
