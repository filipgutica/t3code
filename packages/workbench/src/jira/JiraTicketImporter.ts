import {
  WorkbenchEpicId,
  WorkbenchJiraOperationError,
  WorkbenchTicketId,
  type WorkbenchUpdateJiraTicketFieldsInput,
  type WorkbenchJiraBinding,
  type WorkbenchJiraIssueSnapshot,
  type WorkbenchTicketStatus,
  type WorkbenchTicket,
  type WorkbenchEpic,
  type WorkbenchJiraEpicReference,
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
>()("@t3tools/workbench/jira/JiraTicketImporter") {}

const importError = (message: string) =>
  new WorkbenchJiraOperationError({ code: "persistence_failed", message });

const WORKBENCH_TITLE_MAX_LENGTH = 240;
const WORKBENCH_MARKDOWN_MAX_LENGTH = 120_000;

const normalizeJiraTitle = (title: string) => {
  const normalized = title.trim();
  if (normalized.length <= WORKBENCH_TITLE_MAX_LENGTH) {
    return normalized;
  }
  const lastIncluded = normalized.charCodeAt(WORKBENCH_TITLE_MAX_LENGTH - 1);
  const firstExcluded = normalized.charCodeAt(WORKBENCH_TITLE_MAX_LENGTH);
  const endsWithHighSurrogate = lastIncluded >= 0xd800 && lastIncluded <= 0xdbff;
  const continuesWithLowSurrogate = firstExcluded >= 0xdc00 && firstExcluded <= 0xdfff;
  return normalized.slice(
    0,
    endsWithHighSurrogate && continuesWithLowSurrogate
      ? WORKBENCH_TITLE_MAX_LENGTH - 1
      : WORKBENCH_TITLE_MAX_LENGTH,
  );
};

const jiraTicketId = (bindingId: string, issueId: string) =>
  WorkbenchTicketId.make(`jira:${bindingId}:issue:${issueId}`);

const jiraEpicId = (bindingId: string, epicId: string) =>
  WorkbenchEpicId.make(`jira:${bindingId}:epic:${epicId}`);

const makeJiraTicketFieldPatch = ({
  ticket,
  epicId,
  title,
  kind,
  status,
  blocked,
  description,
  updatedAt,
}: {
  readonly ticket: Pick<
    WorkbenchTicket,
    "id" | "revision" | "epicId" | "title" | "kind" | "status" | "blocked" | "markdown"
  >;
  readonly epicId: WorkbenchEpicId | null;
  readonly title: WorkbenchTicket["title"];
  readonly kind: WorkbenchTicket["kind"];
  readonly status: WorkbenchTicketStatus;
  readonly blocked: boolean;
  readonly description: string | undefined;
  readonly updatedAt: WorkbenchUpdateJiraTicketFieldsInput["updatedAt"];
}): WorkbenchUpdateJiraTicketFieldsInput | undefined => {
  const changes: {
    epicId?: WorkbenchEpicId | null;
    title?: WorkbenchTicket["title"];
    kind?: WorkbenchTicket["kind"];
    status?: WorkbenchTicketStatus;
    blocked?: boolean;
    markdown?: WorkbenchTicket["markdown"];
  } = {};
  if (ticket.epicId !== epicId) changes.epicId = epicId;
  if (ticket.title !== title) changes.title = title;
  if (ticket.kind !== kind) changes.kind = kind;
  if (ticket.status !== status) changes.status = status;
  if (ticket.blocked !== blocked) changes.blocked = blocked;
  if (description !== undefined && ticket.markdown !== description) {
    changes.markdown = description;
  }
  if (Object.keys(changes).length === 0) return undefined;
  return {
    id: ticket.id,
    expectedRevision: ticket.revision,
    updatedAt,
    ...changes,
  };
};

const recheckPendingTicketSummary = ({
  workbench,
  ticketId,
  ticket,
}: {
  readonly workbench: WorkbenchStore["Service"];
  readonly ticketId: WorkbenchTicketId;
  readonly ticket: WorkbenchTicket | undefined;
}) =>
  ticket?.generatedSummary?.status === "pending"
    ? workbench.recheckTicketSummary(ticketId)
    : Effect.void;

export const layer = Layer.effect(
  JiraTicketImporter,
  Effect.gen(function* () {
    const workbench = yield* WorkbenchStore;
    const sql = yield* SqlClient.SqlClient;

    const updateJiraOwnedEpicFields = Effect.fn("JiraTicketImporter.updateJiraOwnedEpicFields")(
      function* (input: {
        readonly epicId: WorkbenchEpicId;
        readonly title: string;
        readonly markdown: string;
        readonly updatedAt: string;
      }) {
        const updated = yield* sql<{ readonly epicId: string }>`
          UPDATE workbench_epics
          SET title = ${input.title}, markdown = ${input.markdown}, updated_at = MAX(updated_at, ${input.updatedAt})
          WHERE epic_id = ${input.epicId} AND archived_at IS NULL
          RETURNING epic_id AS "epicId"
        `;
        if (updated.length === 0) {
          return yield* importError("The Jira Epic is no longer active.");
        }
      },
    );

    const updateJiraOwnedTicketFields = Effect.fn("JiraTicketImporter.updateJiraOwnedTicketFields")(
      function* (input: WorkbenchUpdateJiraTicketFieldsInput) {
        return yield* workbench.updateJiraTicketFields(input);
      },
    );

    const upsertEpic = Effect.fn("JiraTicketImporter.upsertEpic")(function* ({
      input,
      epic,
      epics,
    }: {
      input: JiraTicketImportInput;
      epic: WorkbenchJiraEpicReference;
      epics: ReadonlyArray<WorkbenchEpic>;
    }) {
      const epicTitle = normalizeJiraTitle(epic.summary);
      const epicDescription = epic.description;
      if (epicDescription !== undefined && epicDescription.length > WORKBENCH_MARKDOWN_MAX_LENGTH) {
        return yield* importError(
          `Jira Epic ${epic.key} description exceeds Workbench's ${WORKBENCH_MARKDOWN_MAX_LENGTH} character limit. Shorten it in Jira, then sync again.`,
        );
      }
      const proposedEpicId = jiraEpicId(input.binding.id, epic.id);
      const existingEpic = epics.find((epic) => epic.id === proposedEpicId);
      if (existingEpic === undefined) {
        yield* workbench
          .createEpic({
            id: proposedEpicId,
            projectId: input.binding.projectId,
            title: epicTitle,
            markdown: epicDescription ?? "",
            createdAt: input.issue.remoteUpdatedAt ?? input.binding.updatedAt,
          })
          .pipe(Effect.mapError(() => importError("A Jira Epic could not be created.")));
        return proposedEpicId;
      } else if (existingEpic.archivedAt === null) {
        if (
          existingEpic.title !== epicTitle ||
          (epicDescription !== undefined && existingEpic.markdown !== epicDescription)
        ) {
          yield* updateJiraOwnedEpicFields({
            epicId: existingEpic.id,
            title: epicTitle,
            markdown: epicDescription ?? existingEpic.markdown,
            updatedAt: input.issue.remoteUpdatedAt ?? input.binding.updatedAt,
          }).pipe(Effect.mapError(() => importError("A Jira Epic could not be updated.")));
        }
        return proposedEpicId;
      }
      return null;
    });

    return JiraTicketImporter.of({
      upsertJiraProjection: (input) =>
        Effect.gen(function* () {
          const description = input.issue.description ?? "";
          if (description.length > WORKBENCH_MARKDOWN_MAX_LENGTH) {
            return yield* importError(
              `Jira issue ${input.issue.key} description exceeds Workbench's ${WORKBENCH_MARKDOWN_MAX_LENGTH} character limit. Shorten it in Jira, then sync again.`,
            );
          }
          const title = normalizeJiraTitle(input.issue.summary);
          let snapshot = yield* workbench.getSnapshot.pipe(
            Effect.mapError(() => importError("Workbench data could not be loaded for Jira sync.")),
          );
          let epicId: WorkbenchEpicId | null = null;
          if (input.issue.epic !== null) {
            epicId = yield* upsertEpic({ input, epic: input.issue.epic, epics: snapshot.epics });
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
                title,
                kind,
                markdown: description,
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
            const patch = makeJiraTicketFieldPatch({
              ticket: existingTicket,
              epicId,
              title,
              kind,
              status: input.mappedStatus,
              blocked: input.issue.flagged,
              description: input.issue.description,
              updatedAt,
            });
            if (patch !== undefined) {
              yield* updateJiraOwnedTicketFields(patch).pipe(
                Effect.mapError(() =>
                  importError(`Jira issue ${input.issue.key} could not be updated.`),
                ),
              );
            }
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
                id: created.id,
                expectedRevision: created.revision,
                status: input.mappedStatus,
                blocked: input.issue.flagged,
                updatedAt,
              }).pipe(
                Effect.mapError(() =>
                  importError(`Jira issue ${input.issue.key} could not be positioned.`),
                ),
              );
            }
          }
          yield* recheckPendingTicketSummary({ workbench, ticketId, ticket: existingTicket });
          return ticketId;
        }),
    });
  }),
);
