import {
  WorkbenchEpicId,
  WorkbenchJiraOperationError,
  WorkbenchTicketId,
  type WorkbenchJiraBinding,
  type WorkbenchJiraIssueSnapshot,
  type WorkbenchTicketStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { WorkbenchStore } from "../WorkbenchStore.ts";

export interface JiraTicketImportInput {
  readonly binding: WorkbenchJiraBinding;
  readonly existingTicketId: WorkbenchTicketId | null;
  readonly issue: WorkbenchJiraIssueSnapshot;
  readonly mappedStatus: WorkbenchTicketStatus;
}

export interface JiraTicketImporterShape {
  /**
   * Creates or updates the local Ticket projection for Jira-owned fields only:
   * title, description, remote type, mapped status, and Epic link. An implementation must
   * preserve repository scope, Assignments, and Thread history.
   */
  readonly upsertJiraProjection: (
    input: JiraTicketImportInput,
  ) => Effect.Effect<WorkbenchTicketId, WorkbenchJiraOperationError>;
}

/** Implemented at the existing WorkbenchStore boundary during RPC integration. */
export class JiraTicketImporter extends Context.Service<
  JiraTicketImporter,
  JiraTicketImporterShape
>()("t3/workbench/jira/JiraTicketImporter") {}

const importError = (message: string) =>
  new WorkbenchJiraOperationError({ code: "persistence_failed", message });

const jiraTicketId = (bindingId: string, issueId: string) =>
  WorkbenchTicketId.make(`jira:${bindingId}:issue:${issueId}`);

const jiraEpicId = (bindingId: string, epicId: string) =>
  WorkbenchEpicId.make(`jira:${bindingId}:epic:${epicId}`);

export const layer = Layer.effect(
  JiraTicketImporter,
  Effect.gen(function* () {
    const workbench = yield* WorkbenchStore;
    const sql = yield* SqlClient.SqlClient;

    const updateJiraOwnedEpicFields = Effect.fn("JiraTicketImporter.updateJiraOwnedEpicFields")(
      function* (input: {
        readonly epicId: WorkbenchEpicId;
        readonly title: string;
        readonly updatedAt: string;
      }) {
        const updated = yield* sql<{ readonly epicId: string }>`
          UPDATE workbench_epics
          SET title = ${input.title}, updated_at = MAX(updated_at, ${input.updatedAt})
          WHERE epic_id = ${input.epicId} AND archived_at IS NULL
          RETURNING epic_id AS "epicId"
        `;
        if (updated.length === 0) {
          return yield* importError("The Jira Epic is no longer active.");
        }
      },
    );

    const updateJiraOwnedTicketFields = Effect.fn("JiraTicketImporter.updateJiraOwnedTicketFields")(
      function* (input: {
        readonly ticketId: WorkbenchTicketId;
        readonly epicId: WorkbenchEpicId | null;
        readonly title: string;
        readonly kind: "story" | "bug";
        readonly status: WorkbenchTicketStatus;
        readonly blocked: boolean;
        readonly markdown: string | null;
        readonly updatedAt: string;
      }) {
        const updated = yield* sql<{ readonly ticketId: string }>`
        UPDATE workbench_tickets
        SET
          epic_id = ${input.epicId},
          title = ${input.title},
          kind = ${input.kind},
          status = ${input.status},
          blocked = ${input.blocked ? 1 : 0},
          markdown = COALESCE(${input.markdown}, markdown),
          updated_at = MAX(updated_at, ${input.updatedAt})
        WHERE ticket_id = ${input.ticketId}
        RETURNING ticket_id AS "ticketId"
      `;
        if (updated.length === 0) {
          return yield* importError("The Jira Ticket no longer exists.");
        }
      },
    );

    return JiraTicketImporter.of({
      upsertJiraProjection: (input) =>
        Effect.gen(function* () {
          let snapshot = yield* workbench.getSnapshot.pipe(
            Effect.mapError(() => importError("Workbench data could not be loaded for Jira sync.")),
          );
          let epicId: WorkbenchEpicId | null = null;
          if (input.issue.epic !== null) {
            const proposedEpicId = jiraEpicId(input.binding.id, input.issue.epic.id);
            const existingEpic = snapshot.epics.find((epic) => epic.id === proposedEpicId);
            if (existingEpic === undefined) {
              yield* workbench
                .createEpic({
                  id: proposedEpicId,
                  projectId: input.binding.projectId,
                  title: input.issue.epic.summary,
                  markdown: "",
                  createdAt: input.issue.remoteUpdatedAt ?? input.binding.updatedAt,
                })
                .pipe(Effect.mapError(() => importError("A Jira Epic could not be created.")));
              epicId = proposedEpicId;
            } else if (existingEpic.archivedAt === null) {
              epicId = proposedEpicId;
              if (existingEpic.title !== input.issue.epic.summary) {
                yield* updateJiraOwnedEpicFields({
                  epicId: existingEpic.id,
                  title: input.issue.epic.summary,
                  updatedAt: input.issue.remoteUpdatedAt ?? input.binding.updatedAt,
                }).pipe(Effect.mapError(() => importError("A Jira Epic could not be updated.")));
              }
            }
            snapshot = yield* workbench.getSnapshot.pipe(
              Effect.mapError(() =>
                importError("Workbench data could not be refreshed for Jira sync."),
              ),
            );
          }

          const ticketId =
            input.existingTicketId ?? jiraTicketId(input.binding.id, input.issue.issueId);
          const existingTicket = snapshot.tickets.find((ticket) => ticket.id === ticketId);
          const kind = input.issue.issueType.name.trim().toLowerCase() === "bug" ? "bug" : "story";
          const updatedAt = input.issue.remoteUpdatedAt ?? input.binding.updatedAt;
          if (existingTicket === undefined) {
            yield* workbench
              .createTicket({
                id: ticketId,
                projectId: input.binding.projectId,
                epicId,
                title: input.issue.summary,
                kind,
                markdown: input.issue.description ?? "",
                primaryT3ProjectId: input.binding.defaultPrimaryT3ProjectId,
                repositoryProjectIds: input.binding.defaultRepositoryProjectIds,
                createdAt: updatedAt,
              })
              .pipe(
                Effect.mapError(() =>
                  importError(`Jira issue ${input.issue.key} could not be imported.`),
                ),
              );
          } else {
            yield* updateJiraOwnedTicketFields({
              ticketId: existingTicket.id,
              epicId,
              title: input.issue.summary,
              kind,
              status: input.mappedStatus,
              blocked: input.issue.flagged,
              markdown: input.issue.description ?? null,
              updatedAt,
            }).pipe(
              Effect.mapError(() =>
                importError(`Jira issue ${input.issue.key} could not be updated.`),
              ),
            );
          }
          if (
            existingTicket === undefined &&
            (input.mappedStatus !== "todo" || input.issue.flagged)
          ) {
            const refreshed = yield* workbench.getSnapshot.pipe(
              Effect.mapError(() => importError("The imported Jira Ticket could not be reloaded.")),
            );
            const created = refreshed.tickets.find((ticket) => ticket.id === ticketId);
            if (created) {
              yield* updateJiraOwnedTicketFields({
                ticketId: created.id,
                epicId: created.epicId,
                title: created.title,
                kind: created.kind,
                status: input.mappedStatus,
                blocked: input.issue.flagged,
                markdown: input.issue.description ?? null,
                updatedAt,
              }).pipe(
                Effect.mapError(() =>
                  importError(`Jira issue ${input.issue.key} could not be positioned.`),
                ),
              );
            }
          }
          return ticketId;
        }),
    });
  }),
);
