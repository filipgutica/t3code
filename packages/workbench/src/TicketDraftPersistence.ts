import {
  IsoDateTime,
  WorkbenchOperationError,
  WorkbenchTicketDraft,
  WorkbenchTicketPreparation,
  type WorkbenchBeginTicketDraftInput,
  type WorkbenchUpdateTicketDraftInput,
  type WorkbenchTicketDraftActionInput,
  type WorkbenchTicketDraftPhase,
  type WorkbenchProjectId,
  type ProjectId,
  type ThreadId,
  type WorkbenchTicketId,
  type WorkbenchTicketWorkspaceAttemptId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { WorkbenchNativeAccess } from "./WorkbenchNativeAccess.ts";

const persistenceError = () =>
  new WorkbenchOperationError({
    code: "persistence_failed",
    message: "Ticket preparation data could not be saved or loaded.",
  });
const isWorkbenchOperationError = Schema.is(WorkbenchOperationError);
const operationError = (cause: unknown) =>
  isWorkbenchOperationError(cause) ? cause : persistenceError();
const changed = () =>
  new WorkbenchOperationError({
    code: "ticket_draft_changed",
    message: "This ticket draft changed. Reload it before continuing.",
  });
const busy = () =>
  new WorkbenchOperationError({
    code: "ticket_draft_busy",
    message: "Ticket preparation is changing. Finish or retry that operation first.",
  });
const DraftJson = Schema.fromJsonString(WorkbenchTicketDraft);
const decodeDraftJson = Schema.decodeEffect(DraftJson);
const decodePreparations = Schema.decodeEffect(Schema.Array(WorkbenchTicketPreparation));
const decodeDraft = (payload: string) =>
  decodeDraftJson(payload).pipe(Effect.mapError(operationError));
const encodeDraft = Schema.encodeEffect(DraftJson);

// Detached saved planning conversations retain their runtime guard, but no longer own
// the Ticket's preparation UI. Native reads share the caller's SQL transaction.
const hasLivePreparationThread = (threadId: ThreadId, ticketId: WorkbenchTicketId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const native = yield* WorkbenchNativeAccess;
    const assignments = yield* sql`SELECT 1 FROM workbench_assignments
      WHERE ticket_id = ${ticketId} AND thread_id = ${threadId} AND superseded_at IS NULL LIMIT 1`;
    if (assignments.length === 0) return false;
    const thread = yield* native.findThread(threadId);
    return Option.isSome(thread) && thread.value.archivedAt == null;
  });

/** Snapshot and lifecycle reads use the same SQL transaction as the caller. */
export const listTicketDrafts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly payload: string }>`
    SELECT d.payload_json AS payload FROM workbench_ticket_drafts d
    JOIN workbench_projects p ON p.project_id = d.workbench_project_id
    WHERE p.deleted_at IS NULL AND d.phase <> 'working' ORDER BY d.draft_id`;
  const drafts = yield* Effect.forEach(rows, (row) => decodeDraft(row.payload));
  return yield* Effect.filter(drafts, (draft) =>
    draft.phase === "planning" || draft.phase === "starting"
      ? hasLivePreparationThread(draft.threadId, draft.id)
      : Effect.succeed(true),
  );
}).pipe(Effect.mapError(operationError));

export const makeTicketDraftPersistence = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const native = yield* WorkbenchNativeAccess;
  const now = DateTime.now.pipe(Effect.map((value) => IsoDateTime.make(DateTime.formatIso(value))));
  const getTicketPreparations = sql
    .withTransaction(
      Effect.gen(function* () {
        const rows =
          yield* sql<WorkbenchTicketPreparation>`SELECT d.thread_id AS "threadId", d.draft_id AS "draftId",
      d.workbench_project_id AS "projectId", t.ticket_id AS "ticketId", d.phase
      FROM workbench_ticket_drafts d
      JOIN workbench_projects p ON p.project_id = d.workbench_project_id
      LEFT JOIN workbench_tickets t ON t.ticket_id = d.draft_id AND t.deleted_at IS NULL
      WHERE p.deleted_at IS NULL AND d.phase <> 'working'
      ORDER BY d.draft_id`;
        const preparations = yield* decodePreparations(rows);
        return yield* Effect.filter(preparations, (preparation) =>
          preparation.phase === "planning" || preparation.phase === "starting"
            ? preparation.ticketId === null
              ? Effect.succeed(false)
              : hasLivePreparationThread(preparation.threadId, preparation.ticketId)
            : Effect.succeed(true),
        );
      }),
    )
    .pipe(
      Effect.provideService(WorkbenchNativeAccess, native),
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.mapError(operationError),
    );
  const getTicketDraft = (id: WorkbenchTicketId) =>
    Effect.gen(function* () {
      const rows = yield* sql<{ readonly payload: string }>`
      SELECT d.payload_json AS payload FROM workbench_ticket_drafts d
      JOIN workbench_projects p ON p.project_id = d.workbench_project_id
      WHERE d.draft_id = ${id} AND p.deleted_at IS NULL`;
      if (!rows[0])
        return yield* new WorkbenchOperationError({
          code: "ticket_draft_not_found",
          message: "This ticket draft is no longer available.",
        });
      return yield* decodeDraft(rows[0].payload);
    }).pipe(Effect.mapError(operationError));
  const requireWorkspace = (projectId: WorkbenchProjectId) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        readonly archivedAt: string | null;
      }>`SELECT archived_at AS "archivedAt"
      FROM workbench_projects WHERE project_id = ${projectId} AND deleted_at IS NULL`;
      if (!rows[0])
        return yield* new WorkbenchOperationError({
          code: "project_not_found",
          message: "The Workbench workspace is unavailable.",
        });
      if (rows[0].archivedAt !== null)
        return yield* new WorkbenchOperationError({
          code: "project_archived",
          message: "Restore this Workbench workspace before preparing a ticket.",
        });
      const links = yield* sql<{ readonly id: ProjectId }>`SELECT t3_project_id AS id
      FROM workbench_project_links WHERE workbench_project_id = ${projectId} ORDER BY position`;
      return links.map((link) => link.id);
    });
  const requireActiveDraftTicket = (draft: WorkbenchTicketDraft) =>
    Effect.gen(function* () {
      yield* requireWorkspace(draft.projectId);
      const tickets = yield* sql<{
        readonly archivedAt: string | null;
      }>`SELECT archived_at AS "archivedAt"
        FROM workbench_tickets WHERE ticket_id = ${draft.id}
          AND workbench_project_id = ${draft.projectId} AND deleted_at IS NULL`;
      if (!tickets[0])
        return yield* new WorkbenchOperationError({
          code: "ticket_not_found",
          message: "This Ticket is no longer available for starting work.",
        });
      if (tickets[0].archivedAt !== null)
        return yield* new WorkbenchOperationError({
          code: "ticket_archived",
          message: "Restore this Ticket before starting work.",
        });
    });
  const validateFields = (draft: WorkbenchTicketDraft) =>
    Effect.gen(function* () {
      const linked = yield* requireWorkspace(draft.projectId);
      const selected = draft.fields.repositoryProjectIds;
      if (
        new Set(selected).size !== selected.length ||
        selected.some((id) => !linked.includes(id))
      ) {
        return yield* new WorkbenchOperationError({
          code: "repository_not_linked",
          message: "Choose repositories linked to this Workbench workspace.",
        });
      }
      if (
        draft.fields.primaryT3ProjectId !== null &&
        !selected.includes(draft.fields.primaryT3ProjectId)
      ) {
        return yield* new WorkbenchOperationError({
          code: "primary_repository_not_selected",
          message: "The primary repository must be in the ticket's repository scope.",
        });
      }
      if (draft.fields.epicId !== null) {
        const epics =
          yield* sql`SELECT epic_id FROM workbench_epics WHERE epic_id = ${draft.fields.epicId}
        AND workbench_project_id = ${draft.projectId} AND archived_at IS NULL`;
        if (epics.length === 0)
          return yield* new WorkbenchOperationError({
            code: "epic_project_mismatch",
            message: "Choose an active Epic from this Workbench workspace.",
          });
      }
      for (const id of selected) {
        if (
          Option.isNone(yield* native.findProject(id)) ||
          !(yield* native.isProjectRepository(id))
        ) {
          return yield* new WorkbenchOperationError({
            code: "linked_project_not_repository",
            message: "A selected repository is no longer available.",
          });
        }
      }
    });
  const save = (current: WorkbenchTicketDraft, next: WorkbenchTicketDraft) =>
    Effect.gen(function* () {
      const rows = yield* sql`UPDATE workbench_ticket_drafts SET phase = ${next.phase},
      revision = ${next.revision}, payload_json = ${yield* encodeDraft(next)}
      WHERE draft_id = ${current.id} AND revision = ${current.revision} RETURNING draft_id`;
      if (rows.length === 0) return yield* changed();
      return next;
    });
  const beginTicketDraft = (input: WorkbenchBeginTicketDraftInput) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE workbench_projects SET updated_at = updated_at WHERE project_id = ${input.projectId}`;
          const linked = yield* requireWorkspace(input.projectId);
          const existing = yield* sql<{ readonly payload: string }>`SELECT payload_json AS payload
      FROM workbench_ticket_drafts WHERE draft_id = ${input.id} OR thread_id = ${input.threadId}`;
          if (existing[0]) {
            const draft = yield* decodeDraft(existing[0].payload);
            if (
              draft.id !== input.id ||
              draft.threadId !== input.threadId ||
              draft.projectId !== input.projectId
            ) {
              return yield* new WorkbenchOperationError({
                code: "ticket_draft_invalid",
                message: "This draft or Thread identity already belongs to another preparation.",
              });
            }
            return draft;
          }
          if (
            linked[0] === undefined ||
            Option.isNone(yield* native.findProject(linked[0])) ||
            !(yield* native.isProjectRepository(linked[0]))
          ) {
            return yield* new WorkbenchOperationError({
              code: "linked_project_not_repository",
              message: "This workspace needs an available repository before planning can begin.",
            });
          }
          if (Option.isSome(yield* native.findThread(input.threadId))) {
            return yield* new WorkbenchOperationError({
              code: "assignment_already_exists",
              message: "Choose a new Thread identity for this ticket draft.",
            });
          }
          const usedTicketIds =
            yield* sql`SELECT ticket_id FROM workbench_tickets WHERE ticket_id = ${input.id}`;
          const usedThreadIds =
            yield* sql`SELECT assignment_id FROM workbench_assignments WHERE thread_id = ${input.threadId}`;
          if (usedTicketIds.length > 0 || usedThreadIds.length > 0)
            return yield* new WorkbenchOperationError({
              code: "ticket_draft_invalid",
              message: "Choose a new ticket and Thread identity for this draft.",
            });
          const createdAt = yield* now;
          const draft = WorkbenchTicketDraft.make({
            ...input,
            anchorProjectId: linked[0],
            phase: "creating",
            revision: 0,
            fields: {
              title: "",
              markdown: "",
              kind: "story",
              epicId: null,
              repositoryProjectIds: [],
              primaryT3ProjectId: null,
              localOnly: true,
              jiraSprintId: null,
            },
            createdAt,
            updatedAt: createdAt,
          });
          yield* sql`INSERT INTO workbench_ticket_drafts (draft_id, workbench_project_id, thread_id, phase, revision, payload_json)
      VALUES (${draft.id}, ${draft.projectId}, ${draft.threadId}, ${draft.phase}, ${draft.revision}, ${yield* encodeDraft(draft)})`;
          return draft;
        }),
      )
      .pipe(Effect.mapError(operationError));
  const updateTicketDraft = (input: WorkbenchUpdateTicketDraftInput) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE workbench_ticket_drafts SET revision = revision WHERE draft_id = ${input.id}`;
          const draft = yield* getTicketDraft(input.id);
          if (draft.revision !== input.expectedRevision) return yield* changed();
          if (draft.phase !== "draft") return yield* busy();
          const next = {
            ...draft,
            fields: input.fields,
            revision: draft.revision + 1,
            updatedAt: yield* now,
          };
          yield* validateFields(next);
          return yield* save(draft, next);
        }),
      )
      .pipe(Effect.mapError(operationError));
  const transitionTicketDraft = (
    input: WorkbenchTicketDraftActionInput & {
      readonly from: ReadonlyArray<WorkbenchTicketDraftPhase>;
      readonly phase: WorkbenchTicketDraftPhase;
    },
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE workbench_ticket_drafts SET revision = revision WHERE draft_id = ${input.id}`;
          const draft = yield* getTicketDraft(input.id);
          if (draft.revision !== input.expectedRevision) return yield* changed();
          if (!input.from.includes(draft.phase)) return yield* busy();
          if (input.phase === "discarding" && draft.phase === "promoting") {
            const tickets =
              yield* sql`SELECT ticket_id FROM workbench_tickets WHERE ticket_id = ${draft.id} AND deleted_at IS NULL`;
            if (tickets.length > 0)
              return yield* new WorkbenchOperationError({
                code: "ticket_draft_busy",
                message:
                  "This ticket is already saved. Retry linking its planning Thread before discarding anything.",
              });
          }
          if (input.phase === "starting") yield* requireActiveDraftTicket(draft);
          if (
            input.phase === "starting" &&
            !(yield* hasLivePreparationThread(draft.threadId, draft.id).pipe(
              Effect.provideService(SqlClient.SqlClient, sql),
              Effect.provideService(WorkbenchNativeAccess, native),
            ))
          ) {
            return yield* new WorkbenchOperationError({
              code: "assignment_changed",
              message:
                "The planning conversation no longer owns this Ticket. Open its current conversation before starting work.",
            });
          }
          if (input.phase === "planning") {
            const tickets = yield* sql<{
              readonly primary: ProjectId;
            }>`SELECT primary_t3_project_id AS "primary"
              FROM workbench_tickets WHERE ticket_id = ${draft.id} AND deleted_at IS NULL AND archived_at IS NULL`;
            const thread = yield* native.findThread(draft.threadId);
            const assignments = yield* sql`SELECT assignment_id FROM workbench_assignments
              WHERE ticket_id = ${draft.id} AND thread_id = ${draft.threadId} AND superseded_at IS NULL`;
            if (
              !tickets[0] ||
              Option.isNone(thread) ||
              thread.value.projectId !== tickets[0].primary ||
              thread.value.worktreePath !== null ||
              assignments.length !== 1
            ) {
              return yield* new WorkbenchOperationError({
                code: "ticket_changed",
                message:
                  "The saved ticket or Thread changed during linking. Reload and retry ticket creation.",
              });
            }
          }
          if (input.phase === "draft" || input.phase === "promoting") yield* validateFields(draft);
          return yield* save(draft, {
            ...draft,
            phase: input.phase,
            revision: draft.revision + 1,
            updatedAt: yield* now,
          });
        }),
      )
      .pipe(Effect.mapError(operationError));
  const restoreUncreatedTicketDraft = (input: WorkbenchTicketDraftActionInput) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE workbench_ticket_drafts SET revision = revision WHERE draft_id = ${input.id}`;
          const draft = yield* getTicketDraft(input.id);
          if (draft.revision !== input.expectedRevision || draft.phase !== "promoting") return;
          // Jira records uncertainty before POST. No local ticket and no ledger prove creation never took effect.
          const effects =
            yield* sql`SELECT 1 WHERE EXISTS (SELECT 1 FROM workbench_tickets WHERE ticket_id = ${draft.id})
      OR EXISTS (SELECT 1 FROM workbench_jira_ticket_creations WHERE ticket_id = ${draft.id})`;
          if (effects.length > 0) return;
          yield* save(draft, {
            ...draft,
            phase: "draft",
            revision: draft.revision + 1,
            updatedAt: yield* now,
          });
        }),
      )
      .pipe(Effect.mapError(operationError));
  const completeTicketDraftWork = (
    input: WorkbenchTicketDraftActionInput & {
      readonly expectedTicketRevision: number;
      readonly expectedWorkAreaAttemptId: WorkbenchTicketWorkspaceAttemptId;
    },
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE workbench_ticket_drafts SET revision = revision WHERE draft_id = ${input.id}`;
          const draft = yield* getTicketDraft(input.id);
          if (draft.revision !== input.expectedRevision) return yield* changed();
          if (draft.phase !== "starting") return yield* busy();
          const tickets = yield* sql<{
            readonly revision: number;
            readonly primary: ProjectId;
          }>`SELECT t.revision,
      t.primary_t3_project_id AS "primary" FROM workbench_tickets t
      JOIN workbench_projects p ON p.project_id = t.workbench_project_id
      WHERE t.ticket_id = ${draft.id} AND t.deleted_at IS NULL AND t.archived_at IS NULL
        AND p.deleted_at IS NULL AND p.archived_at IS NULL`;
          const ticket = tickets[0];
          const prepared = yield* sql<{
            readonly projectId: ProjectId;
            readonly worktreePath: string;
            readonly branch: string;
          }>`
            SELECT r.t3_project_id AS "projectId", r.worktree_path AS "worktreePath", r.branch_name AS branch
            FROM workbench_ticket_workspaces w JOIN workbench_ticket_workspace_repositories r ON r.ticket_id = w.ticket_id
            WHERE w.ticket_id = ${draft.id} AND w.attempt_id = ${input.expectedWorkAreaAttemptId}
              AND w.status = 'ready' AND r.status = 'ready' AND r.is_primary = 1`;
          const primary = prepared[0];
          const assignments = yield* sql`SELECT assignment_id FROM workbench_assignments
            WHERE ticket_id = ${draft.id} AND thread_id = ${draft.threadId} AND superseded_at IS NULL`;
          const thread = yield* native.findThread(draft.threadId);
          if (
            !ticket ||
            ticket.revision !== input.expectedTicketRevision ||
            Option.isNone(thread) ||
            thread.value.projectId !== ticket.primary ||
            !primary ||
            primary.projectId !== ticket.primary ||
            thread.value.worktreePath !== primary.worktreePath ||
            thread.value.branch !== primary.branch ||
            assignments.length !== 1
          ) {
            return yield* new WorkbenchOperationError({
              code: "ticket_changed",
              message:
                "The ticket or Thread changed during preparation. Reload and retry Start work.",
            });
          }
          const sequence = yield* native.executionSequence;
          yield* sql`UPDATE workbench_assignments SET execution_after_sequence = ${sequence}
      WHERE ticket_id = ${draft.id} AND thread_id = ${draft.threadId} AND superseded_at IS NULL`;
          yield* sql`UPDATE workbench_tickets SET execution_after_sequence = MAX(execution_after_sequence, ${sequence}) WHERE ticket_id = ${draft.id}`;
          return yield* save(draft, {
            ...draft,
            phase: "working",
            revision: draft.revision + 1,
            updatedAt: yield* now,
          });
        }),
      )
      .pipe(Effect.mapError(operationError));
  const removeTicketDraft = (input: WorkbenchTicketDraftActionInput) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE workbench_ticket_drafts SET revision = revision WHERE draft_id = ${input.id}`;
          const draft = yield* getTicketDraft(input.id);
          if (draft.revision !== input.expectedRevision) return yield* changed();
          if (draft.phase !== "discarding") return yield* busy();
          yield* sql`DELETE FROM workbench_ticket_drafts WHERE draft_id = ${draft.id} AND revision = ${draft.revision}`;
        }),
      )
      .pipe(Effect.mapError(operationError));
  const getTicketDraftForThread = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const rows = yield* sql<{ readonly payload: string }>`SELECT payload_json AS payload
      FROM workbench_ticket_drafts WHERE thread_id = ${threadId}`;
      if (!rows[0]) return null;
      const draft = yield* decodeDraft(rows[0].payload);
      // Keep restrictions even when a parent workspace has been archived or deleted.
      const linked = yield* sql<{ readonly id: ProjectId }>`SELECT t3_project_id AS id
      FROM workbench_project_links WHERE workbench_project_id = ${draft.projectId} ORDER BY position`;
      if (draft.phase === "planning" || draft.phase === "starting" || draft.phase === "working") {
        const tickets = yield* sql<{
          readonly title: string;
          readonly markdown: string;
          readonly primary: ProjectId;
          readonly epicId: WorkbenchTicketDraft["fields"]["epicId"];
          readonly kind: WorkbenchTicketDraft["fields"]["kind"];
        }>`SELECT title, markdown,
        primary_t3_project_id AS "primary", epic_id AS "epicId", kind FROM workbench_tickets
        WHERE ticket_id = ${draft.id} AND deleted_at IS NULL`;
        const ticket = tickets[0];
        if (ticket) {
          const repos = yield* sql<{ readonly id: ProjectId }>`SELECT t3_project_id AS id
          FROM workbench_ticket_repositories WHERE ticket_id = ${draft.id} ORDER BY position`;
          const ids = repos.length > 0 ? repos.map((row) => row.id) : [ticket.primary];
          return {
            ...draft,
            fields: {
              ...draft.fields,
              title: ticket.title,
              markdown: ticket.markdown,
              primaryT3ProjectId: ticket.primary,
              epicId: ticket.epicId,
              kind: ticket.kind,
              repositoryProjectIds: ids,
            },
            planningRepositoryProjectIds: ids,
          };
        }
      }
      return { ...draft, planningRepositoryProjectIds: linked.map((row) => row.id) };
    }).pipe(Effect.mapError(operationError));
  return {
    getTicketPreparations,
    getTicketDraft,
    beginTicketDraft,
    updateTicketDraft,
    transitionTicketDraft,
    restoreUncreatedTicketDraft,
    completeTicketDraftWork,
    removeTicketDraft,
    getTicketDraftForThread,
  };
});
