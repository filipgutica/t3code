import {
  WorkbenchAssignment,
  WorkbenchAssignmentId,
  WorkbenchEpic,
  WorkbenchEpicId,
  WorkbenchOperationError,
  WorkbenchProject,
  WorkbenchProjectId,
  WorkbenchSnapshot,
  WorkbenchTicket,
  WorkbenchTicketGeneratedSummary,
  WorkbenchTicketGeneratedSummaryStatus,
  WorkbenchTicketId,
  WorkbenchTicketWorkspace,
  WorkbenchTicketWorkspaceAttemptId,
  WorkbenchTicketWorkspaceRepository,
  IsoDateTime,
  type WorkbenchUpdateJiraTicketFieldsInput,
  ThreadId,
  ProjectId,
  type WorkbenchArchiveTicketInput,
  type WorkbenchCreateAssignmentInput,
  type WorkbenchArchiveEpicInput,
  type WorkbenchCreateEpicInput,
  type WorkbenchCreateProjectInput,
  type WorkbenchCreateTicketInput,
  type WorkbenchDeleteTicketInput,
  type WorkbenchReplaceAssignmentInput,
  type WorkbenchUpdateEpicInput,
  type WorkbenchUpdateProjectInput,
  type WorkbenchUpdateTicketInput,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { WorkbenchNativeAccess } from "./WorkbenchNativeAccess.ts";
import { ensureWorkbenchSchema } from "./WorkbenchSchema.ts";

const WorkbenchProjectRow = Schema.Struct({
  id: WorkbenchProjectId,
  title: WorkbenchProject.fields.title,
  createdAt: WorkbenchProject.fields.createdAt,
  updatedAt: WorkbenchProject.fields.updatedAt,
});
const WorkbenchProjectLinkRow = Schema.Struct({
  projectId: WorkbenchProjectId,
  linkedProjectId: ProjectId,
  position: Schema.Number,
});
const WorkbenchEpicRow = WorkbenchEpic;
const WorkbenchTicketRepositoryRow = Schema.Struct({
  ticketId: WorkbenchTicketId,
  repositoryProjectId: ProjectId,
  position: Schema.Number,
});
const WorkbenchTicketWorkspaceRow = Schema.Struct({
  ticketId: WorkbenchTicketWorkspace.fields.ticketId,
  attemptId: WorkbenchTicketWorkspace.fields.attemptId,
  status: WorkbenchTicketWorkspace.fields.status,
  branchName: WorkbenchTicketWorkspace.fields.branchName,
  errorMessage: WorkbenchTicketWorkspace.fields.errorMessage,
  createdAt: WorkbenchTicketWorkspace.fields.createdAt,
  updatedAt: WorkbenchTicketWorkspace.fields.updatedAt,
});
const WorkbenchTicketWorkspaceRepositoryRow = Schema.Struct({
  ticketId: WorkbenchTicketId,
  projectId: ProjectId,
  isPrimary: Schema.Number,
  sourcePath: WorkbenchTicketWorkspaceRepository.fields.sourcePath,
  worktreePath: WorkbenchTicketWorkspaceRepository.fields.worktreePath,
  branchName: WorkbenchTicketWorkspaceRepository.fields.branchName,
  status: WorkbenchTicketWorkspaceRepository.fields.status,
  errorMessage: WorkbenchTicketWorkspaceRepository.fields.errorMessage,
  createdAt: WorkbenchTicketWorkspaceRepository.fields.createdAt,
  updatedAt: WorkbenchTicketWorkspaceRepository.fields.updatedAt,
});
const FindProjectLinkInput = Schema.Struct({
  projectId: WorkbenchProjectId,
  linkedProjectId: ProjectId,
});
const FindTicketInput = Schema.Struct({ ticketId: WorkbenchTicketId });
const FindEpicInput = Schema.Struct({ epicId: WorkbenchEpicId });
const WorkbenchTicketRow = Schema.Struct({
  id: WorkbenchTicketId,
  projectId: WorkbenchProjectId,
  epicId: Schema.NullOr(WorkbenchEpicId),
  title: WorkbenchTicket.fields.title,
  kind: WorkbenchTicket.fields.kind,
  markdown: WorkbenchTicket.fields.markdown,
  primaryT3ProjectId: ProjectId,
  status: WorkbenchTicket.fields.status,
  blocked: Schema.Number,
  revision: Schema.Number,
  generatedSummaryText: Schema.NullOr(Schema.String),
  generatedSummaryStatus: WorkbenchTicketGeneratedSummaryStatus,
  generatedSummaryStale: Schema.Number,
  generatedSummaryError: Schema.NullOr(Schema.String),
  generatedSummarySourceHash: Schema.NullOr(Schema.String),
  generatedSummaryRequestId: Schema.NullOr(Schema.String),
  archivedAt: Schema.NullOr(IsoDateTime),
  createdAt: WorkbenchTicket.fields.createdAt,
  updatedAt: WorkbenchTicket.fields.updatedAt,
});

const generatedSummaryFromRow = (
  row: Pick<
    typeof WorkbenchTicketRow.Type,
    | "generatedSummaryText"
    | "generatedSummaryStatus"
    | "generatedSummaryStale"
    | "generatedSummaryError"
  >,
): WorkbenchTicketGeneratedSummary => ({
  text: row.generatedSummaryText,
  status: row.generatedSummaryStatus,
  stale: row.generatedSummaryStale === 1,
  error: row.generatedSummaryError,
});

type WorkbenchTicketSummaryRow = Pick<
  typeof WorkbenchTicketRow.Type,
  | "generatedSummaryText"
  | "generatedSummaryStatus"
  | "generatedSummaryStale"
  | "generatedSummaryError"
  | "generatedSummarySourceHash"
  | "generatedSummaryRequestId"
>;

const summaryUpdate = ({
  row,
  contentChanged,
}: {
  readonly row: WorkbenchTicketSummaryRow;
  readonly contentChanged: boolean;
}) => {
  if (!contentChanged) {
    return {
      generatedSummaryStatus: row.generatedSummaryStatus,
      generatedSummaryStale: row.generatedSummaryStale,
      generatedSummaryError: row.generatedSummaryError,
      generatedSummarySourceHash: row.generatedSummarySourceHash,
      generatedSummaryRequestId: row.generatedSummaryRequestId,
      generatedSummary: generatedSummaryFromRow(row),
    };
  }
  const stale = row.generatedSummaryText !== null;
  return {
    generatedSummaryStatus: "pending" as const,
    generatedSummaryStale: stale ? 1 : 0,
    generatedSummaryError: null,
    generatedSummarySourceHash: null,
    generatedSummaryRequestId: null,
    generatedSummary: {
      text: row.generatedSummaryText,
      status: "pending" as const,
      stale,
      error: null,
    },
  };
};

const ticketFromRow = (
  row: typeof WorkbenchTicketRow.Type,
  repositoryProjectIds: ReadonlyArray<ProjectId>,
): WorkbenchTicket =>
  WorkbenchTicket.make({
    id: row.id,
    projectId: row.projectId,
    epicId: row.epicId,
    title: row.title,
    kind: row.kind,
    markdown: row.markdown,
    primaryT3ProjectId: row.primaryT3ProjectId,
    repositoryProjectIds,
    status: row.status,
    blocked: row.blocked === 1,
    revision: row.revision,
    generatedSummary: generatedSummaryFromRow(row),
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

const ticketSummarySourceHash = (title: string, markdown: string): string =>
  NodeCrypto.createHash("sha256")
    .update(JSON.stringify([title, markdown]))
    .digest("hex");

const normalizeSummaryText = (text: string): string =>
  Array.from(text.trim()).slice(0, 500).join("");
const normalizeSummaryError = (error: string): string =>
  Array.from(error.trim()).slice(0, 4_000).join("");

export interface WorkbenchTicketChange {
  readonly ticketId: WorkbenchTicketId;
}

export interface WorkbenchRequestTicketSummaryInput {
  readonly ticketId: WorkbenchTicketId;
  readonly requestId: string;
}

export interface WorkbenchCompleteTicketSummaryInput {
  readonly ticketId: WorkbenchTicketId;
  readonly requestId: string;
  readonly summary: string;
}

export interface WorkbenchFailTicketSummaryInput {
  readonly ticketId: WorkbenchTicketId;
  readonly requestId: string;
  readonly error: string;
}

export interface WorkbenchClaimTicketWorkspaceInput {
  readonly ticketId: WorkbenchTicketId;
  readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
  readonly branchName: string;
  readonly repositories: ReadonlyArray<{
    readonly projectId: ProjectId;
    readonly isPrimary: boolean;
    readonly sourcePath: string;
    readonly worktreePath: string;
  }>;
  readonly claimedAt: string;
}

export interface WorkbenchTicketWorkspaceRepositoryReadyInput {
  readonly ticketId: WorkbenchTicketId;
  readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
  readonly projectId: ProjectId;
  readonly worktreePath: string;
  readonly branchName: string;
  readonly updatedAt: string;
}

export interface WorkbenchFailTicketWorkspaceInput {
  readonly ticketId: WorkbenchTicketId;
  readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
  readonly projectId: ProjectId | null;
  readonly errorMessage: string;
  readonly failedAt: string;
}

export interface WorkbenchReleaseTicketWorkspaceRepositoryInput {
  readonly ticketId: WorkbenchTicketId;
  readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
  readonly projectId: ProjectId;
  readonly releasedAt: string;
}

export interface WorkbenchCompleteTicketWorkspaceInput {
  readonly ticketId: WorkbenchTicketId;
  readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
  readonly completedAt: string;
}

export interface WorkbenchClaimTicketWorkspaceReleaseInput {
  readonly ticketId: WorkbenchTicketId;
  readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
  readonly claimedAt: string;
  readonly requireActiveTicket?: boolean;
}

interface WorkbenchStoreShape {
  readonly getSnapshot: Effect.Effect<WorkbenchSnapshot, WorkbenchOperationError>;
  readonly listTicketsNeedingSummary: Effect.Effect<
    ReadonlyArray<WorkbenchTicket>,
    WorkbenchOperationError
  >;
  readonly getTicketSummaryCandidate: (
    ticketId: WorkbenchTicketId,
  ) => Effect.Effect<Option.Option<WorkbenchTicket>, WorkbenchOperationError>;
  readonly recheckTicketSummary: (ticketId: WorkbenchTicketId) => Effect.Effect<void>;
  readonly ticketChanges: Stream.Stream<WorkbenchTicketChange>;
  readonly createProject: (
    input: WorkbenchCreateProjectInput,
  ) => Effect.Effect<WorkbenchProject, WorkbenchOperationError>;
  readonly updateProject: (
    input: WorkbenchUpdateProjectInput,
  ) => Effect.Effect<WorkbenchProject, WorkbenchOperationError>;
  readonly createEpic: (
    input: WorkbenchCreateEpicInput,
  ) => Effect.Effect<WorkbenchEpic, WorkbenchOperationError>;
  readonly updateEpic: (
    input: WorkbenchUpdateEpicInput,
  ) => Effect.Effect<WorkbenchEpic, WorkbenchOperationError>;
  readonly archiveEpic: (
    input: WorkbenchArchiveEpicInput,
  ) => Effect.Effect<WorkbenchEpic, WorkbenchOperationError>;
  readonly createTicket: (
    input: WorkbenchCreateTicketInput,
  ) => Effect.Effect<WorkbenchTicket, WorkbenchOperationError>;
  readonly updateTicket: (
    input: WorkbenchUpdateTicketInput,
  ) => Effect.Effect<WorkbenchTicket, WorkbenchOperationError>;
  readonly updateJiraTicketFields: (
    input: WorkbenchUpdateJiraTicketFieldsInput,
  ) => Effect.Effect<WorkbenchTicket, WorkbenchOperationError>;
  readonly requestTicketSummary: (
    input: WorkbenchRequestTicketSummaryInput,
  ) => Effect.Effect<WorkbenchTicket, WorkbenchOperationError>;
  readonly completeTicketSummary: (
    input: WorkbenchCompleteTicketSummaryInput,
  ) => Effect.Effect<Option.Option<WorkbenchTicket>, WorkbenchOperationError>;
  readonly failTicketSummary: (
    input: WorkbenchFailTicketSummaryInput,
  ) => Effect.Effect<Option.Option<WorkbenchTicket>, WorkbenchOperationError>;
  readonly archiveTicket: (
    input: WorkbenchArchiveTicketInput,
  ) => Effect.Effect<WorkbenchTicket, WorkbenchOperationError>;
  readonly deleteTicket: (
    input: WorkbenchDeleteTicketInput,
  ) => Effect.Effect<void, WorkbenchOperationError>;
  readonly createAssignment: (
    input: WorkbenchCreateAssignmentInput,
  ) => Effect.Effect<WorkbenchAssignment, WorkbenchOperationError>;
  readonly replaceAssignment: (
    input: WorkbenchReplaceAssignmentInput,
  ) => Effect.Effect<WorkbenchAssignment, WorkbenchOperationError>;
  readonly getTicketWorkspace: (
    ticketId: WorkbenchTicketId,
  ) => Effect.Effect<Option.Option<WorkbenchTicketWorkspace>, WorkbenchOperationError>;
  readonly claimTicketWorkspace: (
    input: WorkbenchClaimTicketWorkspaceInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
  readonly markTicketWorkspaceRepositoryReady: (
    input: WorkbenchTicketWorkspaceRepositoryReadyInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
  readonly completeTicketWorkspace: (
    input: WorkbenchCompleteTicketWorkspaceInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
  readonly failTicketWorkspace: (
    input: WorkbenchFailTicketWorkspaceInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
  readonly releaseTicketWorkspaceRepository: (
    input: WorkbenchReleaseTicketWorkspaceRepositoryInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
  readonly claimTicketWorkspaceRelease: (
    input: WorkbenchClaimTicketWorkspaceReleaseInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
  readonly completeTicketWorkspaceRelease: (
    input: WorkbenchCompleteTicketWorkspaceInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
}

export class WorkbenchStore extends Context.Service<WorkbenchStore, WorkbenchStoreShape>()(
  "@t3tools/workbench/WorkbenchStore",
) {}

const persistenceError = (_cause: unknown) =>
  new WorkbenchOperationError({
    code: "persistence_failed",
    message: "Workbench data could not be saved or loaded.",
  });
const isWorkbenchOperationError = Schema.is(WorkbenchOperationError);
const workbenchStoreError = (cause: unknown) =>
  isWorkbenchOperationError(cause) ? cause : persistenceError(cause);

const makeWorkbenchStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const native = yield* WorkbenchNativeAccess;
  const ticketChangesPubSub = yield* PubSub.unbounded<WorkbenchTicketChange>();
  const ticketChanges = Stream.fromPubSub(ticketChangesPubSub);

  const publishTicketChange = (ticketId: WorkbenchTicketId) =>
    PubSub.publish(ticketChangesPubSub, { ticketId });
  const recheckTicketSummary = (ticketId: WorkbenchTicketId) => publishTicketChange(ticketId);

  const listProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchProjectRow,
    execute: () => sql`
      SELECT
        project_id AS "id",
        title,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_projects
      ORDER BY created_at ASC, project_id ASC
    `,
  });
  const listProjectLinkRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchProjectLinkRow,
    execute: () => sql`
      SELECT
        workbench_project_id AS "projectId",
        t3_project_id AS "linkedProjectId",
        position
      FROM workbench_project_links
      ORDER BY workbench_project_id ASC, position ASC
    `,
  });
  const listEpicRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchEpicRow,
    execute: () => sql`
      SELECT
        epic_id AS "id",
        workbench_project_id AS "projectId",
        title,
        markdown,
        archived_at AS "archivedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_epics
      ORDER BY created_at ASC, epic_id ASC
    `,
  });
  const listTicketRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchTicketRow,
    execute: () => sql`
      SELECT
        ticket_id AS "id",
        workbench_project_id AS "projectId",
        epic_id AS "epicId",
        title,
        kind,
        markdown,
        primary_t3_project_id AS "primaryT3ProjectId",
        status,
        blocked,
        revision,
        generated_summary AS "generatedSummaryText",
        generated_summary_status AS "generatedSummaryStatus",
        generated_summary_stale AS "generatedSummaryStale",
        generated_summary_error AS "generatedSummaryError",
        generated_summary_source_hash AS "generatedSummarySourceHash",
        generated_summary_request_id AS "generatedSummaryRequestId",
        archived_at AS "archivedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_tickets
      WHERE deleted_at IS NULL
      ORDER BY created_at ASC, ticket_id ASC
    `,
  });
  const listTicketSummaryCandidateIds = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({ ticketId: WorkbenchTicketId }),
    execute: () => sql`
      SELECT ticket.ticket_id AS "ticketId"
      FROM workbench_tickets AS ticket
      WHERE ticket.deleted_at IS NULL
        AND ticket.archived_at IS NULL
        AND ticket.generated_summary_status = 'pending'
        AND (
          NOT EXISTS (
            SELECT 1
            FROM workbench_jira_issue_links AS jira_link
            WHERE jira_link.ticket_id = ticket.ticket_id
          )
          OR EXISTS (
            SELECT 1
            FROM workbench_jira_issue_links AS jira_link
            WHERE jira_link.ticket_id = ticket.ticket_id
              AND jira_link.active = 1
          )
        )
      ORDER BY ticket.created_at ASC, ticket.ticket_id ASC
    `,
  });
  const listTicketRepositoryRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchTicketRepositoryRow,
    execute: () => sql`
      SELECT
        ticket_id AS "ticketId",
        t3_project_id AS "repositoryProjectId",
        position
      FROM workbench_ticket_repositories
      ORDER BY ticket_id ASC, position ASC
    `,
  });
  const listTicketRepositoryRowsByTicket = SqlSchema.findAll({
    Request: FindTicketInput,
    Result: WorkbenchTicketRepositoryRow,
    execute: ({ ticketId }) => sql`
      SELECT
        ticket_id AS "ticketId",
        t3_project_id AS "repositoryProjectId",
        position
      FROM workbench_ticket_repositories
      WHERE ticket_id = ${ticketId}
      ORDER BY position ASC
    `,
  });
  const listAssignmentRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchAssignment,
    execute: () => sql`
      SELECT
        assignment_id AS "id",
        ticket_id AS "ticketId",
        thread_id AS "threadId",
        created_at AS "createdAt",
        superseded_at AS "supersededAt"
      FROM workbench_assignments
      WHERE ticket_id IN (
        SELECT ticket_id
        FROM workbench_tickets
        WHERE deleted_at IS NULL
      )
      ORDER BY created_at ASC, assignment_id ASC
    `,
  });
  const listReservedThreadIds = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({ id: ThreadId }),
    execute: () => sql`
      SELECT DISTINCT assignment.thread_id AS "id"
      FROM workbench_assignments AS assignment
      INNER JOIN workbench_tickets AS ticket
        ON ticket.ticket_id = assignment.ticket_id
      WHERE ticket.deleted_at IS NOT NULL
      ORDER BY assignment.thread_id ASC
    `,
  });
  const listTicketWorkspaceRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchTicketWorkspaceRow,
    execute: () => sql`
      SELECT
        ticket_id AS "ticketId",
        attempt_id AS "attemptId",
        status,
        branch_name AS "branchName",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_ticket_workspaces
      ORDER BY created_at ASC, ticket_id ASC
    `,
  });
  const listTicketWorkspaceRepositoryRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchTicketWorkspaceRepositoryRow,
    execute: () => sql`
      SELECT
        ticket_id AS "ticketId",
        t3_project_id AS "projectId",
        is_primary AS "isPrimary",
        source_path AS "sourcePath",
        worktree_path AS "worktreePath",
        branch_name AS "branchName",
        status,
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_ticket_workspace_repositories
      ORDER BY ticket_id ASC, is_primary DESC, t3_project_id ASC
    `,
  });
  const findTicketWorkspaceRow = SqlSchema.findOneOption({
    Request: FindTicketInput,
    Result: WorkbenchTicketWorkspaceRow,
    execute: ({ ticketId }) => sql`
      SELECT
        ticket_id AS "ticketId",
        attempt_id AS "attemptId",
        status,
        branch_name AS "branchName",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_ticket_workspaces
      WHERE ticket_id = ${ticketId}
    `,
  });
  const findJiraIssueLinkByTicket = SqlSchema.findOneOption({
    Request: FindTicketInput,
    Result: Schema.Struct({ ticketId: WorkbenchTicketId }),
    execute: ({ ticketId }) => sql`
      SELECT ticket_id AS "ticketId"
      FROM workbench_jira_issue_links
      WHERE ticket_id = ${ticketId}
      LIMIT 1
    `,
  });
  const isJiraManagedTicket = Effect.fn("WorkbenchStore.isJiraManagedTicket")(function* (
    ticketId: WorkbenchTicketId,
  ) {
    return (
      (ticketId.startsWith("jira:") && ticketId.includes(":issue:")) ||
      Option.isSome(yield* findJiraIssueLinkByTicket({ ticketId }))
    );
  });
  const listTicketWorkspaceRepositoriesByTicket = SqlSchema.findAll({
    Request: FindTicketInput,
    Result: WorkbenchTicketWorkspaceRepositoryRow,
    execute: ({ ticketId }) => sql`
      SELECT
        ticket_id AS "ticketId",
        t3_project_id AS "projectId",
        is_primary AS "isPrimary",
        source_path AS "sourcePath",
        worktree_path AS "worktreePath",
        branch_name AS "branchName",
        status,
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_ticket_workspace_repositories
      WHERE ticket_id = ${ticketId}
      ORDER BY is_primary DESC, t3_project_id ASC
    `,
  });
  const findT3Project = Effect.fn("WorkbenchStore.findT3Project")(function* ({
    linkedProjectId,
  }: {
    readonly linkedProjectId: ProjectId;
  }) {
    return yield* native.findProject(linkedProjectId);
  });
  const findProject = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: WorkbenchProjectId }),
    Result: WorkbenchProjectRow,
    execute: ({ id }) => sql`
      SELECT
        project_id AS "id",
        title,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_projects
      WHERE project_id = ${id}
    `,
  });
  const findProjectLink = SqlSchema.findOneOption({
    Request: FindProjectLinkInput,
    Result: WorkbenchProjectLinkRow,
    execute: ({ projectId, linkedProjectId }) => sql`
      SELECT
        workbench_project_id AS "projectId",
        t3_project_id AS "linkedProjectId",
        position
      FROM workbench_project_links
      WHERE workbench_project_id = ${projectId}
        AND t3_project_id = ${linkedProjectId}
    `,
  });
  const findTicket = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: WorkbenchTicketId }),
    Result: WorkbenchTicketRow,
    execute: ({ id }) => sql`
      SELECT
        ticket_id AS "id",
        workbench_project_id AS "projectId",
        epic_id AS "epicId",
        title,
        kind,
        markdown,
        primary_t3_project_id AS "primaryT3ProjectId",
        status,
        blocked,
        revision,
        generated_summary AS "generatedSummaryText",
        generated_summary_status AS "generatedSummaryStatus",
        generated_summary_stale AS "generatedSummaryStale",
        generated_summary_error AS "generatedSummaryError",
        generated_summary_source_hash AS "generatedSummarySourceHash",
        generated_summary_request_id AS "generatedSummaryRequestId",
        archived_at AS "archivedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_tickets
      WHERE ticket_id = ${id}
        AND deleted_at IS NULL
    `,
  });
  const listJiraIssueLinkActivity = (ticketId: WorkbenchTicketId) => sql<{
    readonly active: number;
  }>`
    SELECT active
    FROM workbench_jira_issue_links
    WHERE ticket_id = ${ticketId}
  `;
  const lockAndFindTicket = Effect.fn("WorkbenchStore.lockAndFindTicket")(function* ({
    ticketId,
    activeOnly,
  }: {
    readonly ticketId: WorkbenchTicketId;
    readonly activeOnly: boolean;
  }) {
    // SQLite's no-op UPDATE acquires the writer lock. Callers must invoke this
    // helper from their existing transaction before checking ticket invariants.
    const predicates = [sql`ticket_id = ${ticketId}`];
    if (activeOnly) predicates.push(sql`deleted_at IS NULL`);
    yield* sql`
      UPDATE workbench_tickets
      SET updated_at = updated_at
      WHERE ${sql.and(predicates)}
    `;
    return yield* findTicket({ id: ticketId });
  });
  const requireTicketRevision = Effect.fn("WorkbenchStore.requireTicketRevision")(function* ({
    ticketId,
    expectedRevision,
    revisionMessage,
    activeOnly,
  }: {
    readonly ticketId: WorkbenchTicketId;
    readonly expectedRevision: number;
    readonly revisionMessage: string;
    readonly activeOnly: boolean;
  }) {
    const ticket = yield* lockAndFindTicket({ ticketId, activeOnly });
    if (Option.isNone(ticket)) {
      return yield* new WorkbenchOperationError({
        code: "ticket_not_found",
        message: "The Workbench Ticket does not exist.",
      });
    }
    if (ticket.value.revision !== expectedRevision) {
      return yield* new WorkbenchOperationError({
        code: "ticket_changed",
        message: revisionMessage,
      });
    }
    return ticket.value;
  });
  const requireActiveTicket = Effect.fn("WorkbenchStore.requireActiveTicket")(function* ({
    ticketId,
    archivedMessage,
  }: {
    readonly ticketId: WorkbenchTicketId;
    readonly archivedMessage: string;
  }) {
    const ticket = yield* lockAndFindTicket({ ticketId, activeOnly: false });
    if (Option.isNone(ticket)) {
      return yield* new WorkbenchOperationError({
        code: "ticket_not_found",
        message: "The Workbench Ticket does not exist.",
      });
    }
    if (ticket.value.archivedAt !== null) {
      return yield* new WorkbenchOperationError({
        code: "ticket_archived",
        message: archivedMessage,
      });
    }
    return ticket.value;
  });
  const findEpic = SqlSchema.findOneOption({
    Request: FindEpicInput,
    Result: WorkbenchEpicRow,
    execute: ({ epicId }) => sql`
      SELECT
        epic_id AS "id",
        workbench_project_id AS "projectId",
        title,
        markdown,
        archived_at AS "archivedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_epics
      WHERE epic_id = ${epicId}
    `,
  });
  const findNativeThread = Effect.fn("WorkbenchStore.findNativeThread")(function* ({
    threadId,
  }: {
    readonly threadId: ThreadId;
  }) {
    return yield* native.findThread(threadId);
  });
  const findActiveAssignmentByTicket = SqlSchema.findOneOption({
    Request: Schema.Struct({ ticketId: WorkbenchTicketId }),
    Result: WorkbenchAssignment,
    execute: ({ ticketId }) => sql`
      SELECT
        assignment_id AS "id",
        ticket_id AS "ticketId",
        thread_id AS "threadId",
        created_at AS "createdAt",
        superseded_at AS "supersededAt"
      FROM workbench_assignments
      WHERE ticket_id = ${ticketId}
      AND superseded_at IS NULL
    `,
  });
  const listActiveAssignmentsByTicket = SqlSchema.findAll({
    Request: Schema.Struct({ ticketId: WorkbenchTicketId }),
    Result: WorkbenchAssignment,
    execute: ({ ticketId }) => sql`
      SELECT
        assignment_id AS "id",
        ticket_id AS "ticketId",
        thread_id AS "threadId",
        created_at AS "createdAt",
        superseded_at AS "supersededAt"
      FROM workbench_assignments
      WHERE ticket_id = ${ticketId}
        AND superseded_at IS NULL
      ORDER BY created_at ASC, assignment_id ASC
    `,
  });
  const findActiveAssignmentByTicketAndThread = SqlSchema.findOneOption({
    Request: Schema.Struct({ ticketId: WorkbenchTicketId, threadId: ThreadId }),
    Result: WorkbenchAssignment,
    execute: ({ ticketId, threadId }) => sql`
      SELECT
        assignment_id AS "id",
        ticket_id AS "ticketId",
        thread_id AS "threadId",
        created_at AS "createdAt",
        superseded_at AS "supersededAt"
      FROM workbench_assignments
      WHERE ticket_id = ${ticketId}
        AND thread_id = ${threadId}
        AND superseded_at IS NULL
    `,
  });
  const findAssignmentByThread = SqlSchema.findOneOption({
    Request: Schema.Struct({ threadId: ThreadId }),
    Result: WorkbenchAssignment,
    execute: ({ threadId }) => sql`
      SELECT assignment_id AS "id", ticket_id AS "ticketId", thread_id AS "threadId",
        created_at AS "createdAt", superseded_at AS "supersededAt"
      FROM workbench_assignments
      WHERE thread_id = ${threadId}
    `,
  });
  const findActiveLiveAssignmentByTicket = Effect.fn(
    "WorkbenchStore.findActiveLiveAssignmentByTicket",
  )(function* ({ ticketId }: { readonly ticketId: WorkbenchTicketId }) {
    // Keep the assignment read and native existence checks in the caller's
    // transaction. The native adapter uses the same SqlClient connection.
    const assignments = yield* listActiveAssignmentsByTicket({ ticketId });
    for (const assignment of assignments) {
      const thread = yield* native.findThread(assignment.threadId);
      if (Option.isSome(thread)) return Option.some(assignment);
    }
    return Option.none<WorkbenchAssignment>();
  });
  const findAnyAssignmentByTicket = SqlSchema.findOneOption({
    Request: FindTicketInput,
    Result: Schema.Struct({ id: WorkbenchAssignment.fields.id }),
    execute: ({ ticketId }) => sql`
      SELECT assignment_id AS "id"
      FROM workbench_assignments
      WHERE ticket_id = ${ticketId}
      LIMIT 1
    `,
  });
  const supersedeAssignmentRow = SqlSchema.findOneOption({
    Request: Schema.Struct({
      ticketId: WorkbenchTicketId,
      previousThreadId: ThreadId,
      replacedAt: WorkbenchAssignment.fields.createdAt,
    }),
    Result: WorkbenchAssignment,
    execute: ({ ticketId, previousThreadId, replacedAt }) => sql`
      UPDATE workbench_assignments
      SET superseded_at = ${replacedAt}
      WHERE ticket_id = ${ticketId}
        AND thread_id = ${previousThreadId}
        AND superseded_at IS NULL
      RETURNING
        assignment_id AS "id",
        ticket_id AS "ticketId",
        thread_id AS "threadId",
        created_at AS "createdAt",
        superseded_at AS "supersededAt"
    `,
  });

  const hydrateTicketWorkspace = ({
    workspace,
    repositories,
  }: {
    workspace: typeof WorkbenchTicketWorkspaceRow.Type;
    repositories: ReadonlyArray<typeof WorkbenchTicketWorkspaceRepositoryRow.Type>;
  }) =>
    WorkbenchTicketWorkspace.make({
      ...workspace,
      repositories: repositories.map((repository) => ({
        projectId: repository.projectId,
        sourcePath: repository.sourcePath,
        worktreePath: repository.worktreePath,
        branchName: repository.branchName,
        status: repository.status,
        errorMessage: repository.errorMessage,
        createdAt: repository.createdAt,
        updatedAt: repository.updatedAt,
        isPrimary: repository.isPrimary === 1,
      })),
    });

  const loadTicketWorkspace = Effect.fn("WorkbenchStore.loadTicketWorkspace")(function* (
    ticketId: WorkbenchTicketId,
  ) {
    const workspace = yield* findTicketWorkspaceRow({ ticketId });
    if (Option.isNone(workspace)) return Option.none<WorkbenchTicketWorkspace>();
    const repositories = yield* listTicketWorkspaceRepositoriesByTicket({ ticketId });
    return Option.some(hydrateTicketWorkspace({ workspace: workspace.value, repositories }));
  });

  const requireTicketWorkspaceAttempt = Effect.fn("WorkbenchStore.requireTicketWorkspaceAttempt")(
    function* ({
      ticketId,
      attemptId,
    }: {
      ticketId: WorkbenchTicketId;
      attemptId: WorkbenchTicketWorkspaceAttemptId;
    }) {
      const workspace = yield* findTicketWorkspaceRow({ ticketId });
      if (Option.isNone(workspace)) {
        return yield* new WorkbenchOperationError({
          code: "ticket_workspace_not_found",
          message: "The Ticket Workspace does not exist.",
        });
      }
      if (workspace.value.attemptId !== attemptId) {
        return yield* new WorkbenchOperationError({
          code: "ticket_workspace_preparation_changed",
          message: "The Ticket Workspace preparation changed before it could be updated.",
        });
      }
      return workspace.value;
    },
  );

  const getSnapshot = Effect.fn("WorkbenchStore.getSnapshot")(function* () {
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const [
          projectRows,
          linkRows,
          epicRows,
          ticketRows,
          ticketRepositoryRows,
          assignments,
          reservedThreadRows,
          ticketWorkspaceRows,
          ticketWorkspaceRepositoryRows,
        ] = yield* Effect.all([
          listProjectRows(),
          listProjectLinkRows(),
          listEpicRows(),
          listTicketRows(),
          listTicketRepositoryRows(),
          listAssignmentRows(),
          listReservedThreadIds(),
          listTicketWorkspaceRows(),
          listTicketWorkspaceRepositoryRows(),
        ]);
        const linksByProject = new Map<
          string,
          Array<(typeof WorkbenchProjectLinkRow.Type)["linkedProjectId"]>
        >();
        for (const link of linkRows) {
          const links = linksByProject.get(link.projectId) ?? [];
          links.push(link.linkedProjectId);
          linksByProject.set(link.projectId, links);
        }
        const repositoriesByTicket = new Map<string, Array<ProjectId>>();
        for (const repository of ticketRepositoryRows) {
          const repositories = repositoriesByTicket.get(repository.ticketId) ?? [];
          repositories.push(repository.repositoryProjectId);
          repositoriesByTicket.set(repository.ticketId, repositories);
        }
        const workspaceRepositoriesByTicket = new Map<
          string,
          Array<typeof WorkbenchTicketWorkspaceRepositoryRow.Type>
        >();
        for (const repository of ticketWorkspaceRepositoryRows) {
          const repositories = workspaceRepositoriesByTicket.get(repository.ticketId) ?? [];
          repositories.push(repository);
          workspaceRepositoriesByTicket.set(repository.ticketId, repositories);
        }
        return WorkbenchSnapshot.make({
          projects: projectRows.map((project) => ({
            ...project,
            linkedProjectIds: linksByProject.get(project.id) ?? [],
          })),
          epics: epicRows,
          tickets: ticketRows.map((ticket) =>
            ticketFromRow(
              ticket,
              repositoriesByTicket.get(ticket.id) ?? [ticket.primaryT3ProjectId],
            ),
          ),
          assignments,
          reservedThreadIds: reservedThreadRows.map((row) => row.id),
          ticketWorkspaces: ticketWorkspaceRows.map((workspace) =>
            hydrateTicketWorkspace({
              workspace,
              repositories: workspaceRepositoriesByTicket.get(workspace.ticketId) ?? [],
            }),
          ),
        });
      }),
    );
  }, Effect.mapError(persistenceError));

  const listTicketsNeedingSummary = Effect.fn("WorkbenchStore.listTicketsNeedingSummary")(
    function* () {
      const candidateRows = yield* listTicketSummaryCandidateIds().pipe(
        Effect.mapError(persistenceError),
      );
      const candidateIds = new Set(candidateRows.map(({ ticketId }) => ticketId));
      const snapshot = yield* getSnapshot();
      return snapshot.tickets.filter((ticket) => candidateIds.has(ticket.id));
    },
  );

  const getTicketSummaryCandidate = Effect.fn("WorkbenchStore.getTicketSummaryCandidate")(
    (ticketId: WorkbenchTicketId) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const ticket = yield* findTicket({ id: ticketId });
            if (
              Option.isNone(ticket) ||
              ticket.value.archivedAt !== null ||
              ticket.value.generatedSummaryStatus !== "pending"
            ) {
              return Option.none<WorkbenchTicket>();
            }
            const jiraLinks = yield* listJiraIssueLinkActivity(ticketId);
            if (jiraLinks.length > 0 && !jiraLinks.some((link) => link.active === 1)) {
              return Option.none<WorkbenchTicket>();
            }
            const repositories = yield* listTicketRepositoryRowsByTicket({ ticketId });
            return Option.some(
              ticketFromRow(
                ticket.value,
                repositories.length > 0
                  ? repositories.map((repository) => repository.repositoryProjectId)
                  : [ticket.value.primaryT3ProjectId],
              ),
            );
          }),
        )
        .pipe(Effect.mapError(persistenceError)),
  );

  const getTicketWorkspace: WorkbenchStoreShape["getTicketWorkspace"] = Effect.fn(
    "WorkbenchStore.getTicketWorkspace",
  )((ticketId) =>
    sql.withTransaction(loadTicketWorkspace(ticketId)).pipe(Effect.mapError(persistenceError)),
  );

  const claimTicketWorkspace: WorkbenchStoreShape["claimTicketWorkspace"] = Effect.fn(
    "WorkbenchStore.claimTicketWorkspace",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const ticket = yield* requireActiveTicket({
            ticketId: input.ticketId,
            archivedMessage: "Archived Workbench Tickets cannot receive a Workspace.",
          });
          const ticketRepositories = yield* listTicketRepositoryRowsByTicket({
            ticketId: input.ticketId,
          });
          const expectedProjectIds = ticketRepositories.map(
            (repository) => repository.repositoryProjectId,
          );
          const suppliedProjectIds = input.repositories.map((repository) => repository.projectId);
          const hasDuplicateRepositories =
            new Set(suppliedProjectIds).size !== suppliedProjectIds.length;
          const repositoryScopeMatches =
            !hasDuplicateRepositories &&
            suppliedProjectIds.length === expectedProjectIds.length &&
            suppliedProjectIds.every((projectId) => expectedProjectIds.includes(projectId));
          const primaryRepositories = input.repositories.filter(
            (repository) => repository.isPrimary,
          );
          if (
            !repositoryScopeMatches ||
            primaryRepositories.length !== 1 ||
            primaryRepositories[0]?.projectId !== ticket.primaryT3ProjectId
          ) {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_preparation_changed",
              message:
                "The Ticket repository scope changed before its Workspace could be prepared.",
            });
          }

          const existing = yield* findTicketWorkspaceRow({ ticketId: input.ticketId });
          if (Option.isSome(existing) && existing.value.status === "preparing") {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_preparation_in_progress",
              message: "The Ticket Workspace is already being prepared.",
            });
          }
          if (Option.isSome(existing) && existing.value.status === "ready") {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_already_ready",
              message: "The Ticket Workspace is already ready.",
            });
          }
          if (Option.isSome(existing)) {
            const existingRepositories = yield* listTicketWorkspaceRepositoriesByTicket({
              ticketId: input.ticketId,
            });
            if (existingRepositories.some((repository) => repository.status === "ready")) {
              return yield* new WorkbenchOperationError({
                code: "ticket_workspace_preparation_failed",
                message:
                  "The previous Ticket Workspace must release its prepared repositories before retrying.",
              });
            }
          }

          if (Option.isSome(existing)) {
            yield* sql`
              DELETE FROM workbench_ticket_workspace_repositories
              WHERE ticket_id = ${input.ticketId}
            `;
            yield* sql`
              UPDATE workbench_ticket_workspaces
              SET
                attempt_id = ${input.attemptId},
                status = 'preparing',
                branch_name = ${input.branchName},
                error_message = NULL,
                created_at = ${input.claimedAt},
                updated_at = ${input.claimedAt}
              WHERE ticket_id = ${input.ticketId}
            `;
          } else {
            yield* sql`
              INSERT INTO workbench_ticket_workspaces (
                ticket_id,
                attempt_id,
                status,
                branch_name,
                error_message,
                created_at,
                updated_at
              ) VALUES (
                ${input.ticketId},
                ${input.attemptId},
                'preparing',
                ${input.branchName},
                NULL,
                ${input.claimedAt},
                ${input.claimedAt}
              )
            `;
          }
          for (const repository of input.repositories) {
            yield* sql`
              INSERT INTO workbench_ticket_workspace_repositories (
                ticket_id,
                t3_project_id,
                is_primary,
                source_path,
                worktree_path,
                branch_name,
                status,
                error_message,
                created_at,
                updated_at
              ) VALUES (
                ${input.ticketId},
                ${repository.projectId},
                ${repository.isPrimary ? 1 : 0},
                ${repository.sourcePath},
                ${repository.worktreePath},
                ${input.branchName},
                'pending',
                NULL,
                ${input.claimedAt},
                ${input.claimedAt}
              )
            `;
          }
          return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const markTicketWorkspaceRepositoryReady: WorkbenchStoreShape["markTicketWorkspaceRepositoryReady"] =
    Effect.fn("WorkbenchStore.markTicketWorkspaceRepositoryReady")(function* (input) {
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const workspace = yield* requireTicketWorkspaceAttempt(input);
            if (workspace.status !== "preparing") {
              return yield* new WorkbenchOperationError({
                code: "ticket_workspace_preparation_changed",
                message: "The Ticket Workspace is no longer being prepared.",
              });
            }
            const updated = yield* sql<{
              readonly projectId: ProjectId;
            }>`
              UPDATE workbench_ticket_workspace_repositories
              SET
                worktree_path = ${input.worktreePath},
                branch_name = ${input.branchName},
                status = 'ready',
                error_message = NULL,
                updated_at = ${input.updatedAt}
              WHERE ticket_id = ${input.ticketId}
                AND t3_project_id = ${input.projectId}
              RETURNING t3_project_id AS "projectId"
            `;
            if (updated.length === 0) {
              return yield* new WorkbenchOperationError({
                code: "ticket_workspace_repository_not_found",
                message: "The Ticket Workspace repository does not exist.",
              });
            }
            yield* sql`
              UPDATE workbench_ticket_workspaces
              SET updated_at = ${input.updatedAt}
              WHERE ticket_id = ${input.ticketId}
            `;
            return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
          }),
        )
        .pipe(Effect.mapError(workbenchStoreError));
    });

  const completeTicketWorkspace: WorkbenchStoreShape["completeTicketWorkspace"] = Effect.fn(
    "WorkbenchStore.completeTicketWorkspace",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const workspace = yield* requireTicketWorkspaceAttempt(input);
          if (workspace.status !== "preparing") {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_preparation_changed",
              message: "The Ticket Workspace is no longer being prepared.",
            });
          }
          const repositories = yield* listTicketWorkspaceRepositoriesByTicket({
            ticketId: input.ticketId,
          });
          if (
            repositories.length === 0 ||
            repositories.some((repository) => repository.status !== "ready")
          ) {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_preparation_failed",
              message: "Every Ticket repository must be ready before its Workspace is ready.",
            });
          }
          yield* sql`
            UPDATE workbench_ticket_workspaces
            SET status = 'ready', error_message = NULL, updated_at = ${input.completedAt}
            WHERE ticket_id = ${input.ticketId}
          `;
          return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const failTicketWorkspace: WorkbenchStoreShape["failTicketWorkspace"] = Effect.fn(
    "WorkbenchStore.failTicketWorkspace",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* requireTicketWorkspaceAttempt(input);
          if (input.projectId !== null) {
            const updated = yield* sql<{ readonly projectId: ProjectId }>`
              UPDATE workbench_ticket_workspace_repositories
              SET status = 'failed', error_message = ${input.errorMessage}, updated_at = ${input.failedAt}
              WHERE ticket_id = ${input.ticketId}
                AND t3_project_id = ${input.projectId}
              RETURNING t3_project_id AS "projectId"
            `;
            if (updated.length === 0) {
              return yield* new WorkbenchOperationError({
                code: "ticket_workspace_repository_not_found",
                message: "The Ticket Workspace repository does not exist.",
              });
            }
          }
          yield* sql`
            UPDATE workbench_ticket_workspaces
            SET status = 'failed', error_message = ${input.errorMessage}, updated_at = ${input.failedAt}
            WHERE ticket_id = ${input.ticketId}
          `;
          return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const releaseTicketWorkspaceRepository: WorkbenchStoreShape["releaseTicketWorkspaceRepository"] =
    Effect.fn("WorkbenchStore.releaseTicketWorkspaceRepository")(function* (input) {
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* requireTicketWorkspaceAttempt(input);
            const updated = yield* sql<{ readonly projectId: ProjectId }>`
              UPDATE workbench_ticket_workspace_repositories
              SET status = 'released', updated_at = ${input.releasedAt}
              WHERE ticket_id = ${input.ticketId}
                AND t3_project_id = ${input.projectId}
              RETURNING t3_project_id AS "projectId"
            `;
            if (updated.length === 0) {
              return yield* new WorkbenchOperationError({
                code: "ticket_workspace_repository_not_found",
                message: "The Ticket Workspace repository does not exist.",
              });
            }
            yield* sql`
              UPDATE workbench_ticket_workspaces
              SET updated_at = ${input.releasedAt}
              WHERE ticket_id = ${input.ticketId}
            `;
            return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
          }),
        )
        .pipe(Effect.mapError(workbenchStoreError));
    });

  const claimTicketWorkspaceRelease: WorkbenchStoreShape["claimTicketWorkspaceRelease"] = Effect.fn(
    "WorkbenchStore.claimTicketWorkspaceRelease",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
            UPDATE workbench_tickets
            SET updated_at = updated_at
            WHERE ticket_id = ${input.ticketId}
          `;
          if (input.requireActiveTicket === true) {
            const ticket = yield* findTicket({ id: input.ticketId });
            if (Option.isNone(ticket)) {
              return yield* new WorkbenchOperationError({
                code: "ticket_not_found",
                message: "The Workbench Ticket does not exist.",
              });
            }
            if (ticket.value.archivedAt !== null) {
              return yield* new WorkbenchOperationError({
                code: "ticket_archived",
                message: "Archived Workbench Tickets cannot release a Workspace.",
              });
            }
          }
          const workspace = yield* requireTicketWorkspaceAttempt(input);
          if (workspace.status === "released") {
            return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
          }
          if (workspace.status === "preparing") {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_preparation_in_progress",
              message: "The Ticket Workspace is still being prepared.",
            });
          }
          const assignment = yield* findActiveLiveAssignmentByTicket({ ticketId: input.ticketId });
          if (Option.isSome(assignment)) {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_in_use",
              message:
                "The Ticket Workspace cannot be released while it has an active Agent Thread.",
            });
          }
          yield* sql`
            UPDATE workbench_ticket_workspaces
            SET status = 'releasing', updated_at = ${input.claimedAt}
            WHERE ticket_id = ${input.ticketId}
          `;
          return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const completeTicketWorkspaceRelease: WorkbenchStoreShape["completeTicketWorkspaceRelease"] =
    Effect.fn("WorkbenchStore.completeTicketWorkspaceRelease")(function* (input) {
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* requireTicketWorkspaceAttempt(input);
            const repositories = yield* listTicketWorkspaceRepositoriesByTicket({
              ticketId: input.ticketId,
            });
            if (repositories.some((repository) => repository.status === "ready")) {
              return yield* new WorkbenchOperationError({
                code: "ticket_workspace_preparation_failed",
                message: "Every prepared repository must be removed before release completes.",
              });
            }
            yield* sql`
              UPDATE workbench_ticket_workspace_repositories
              SET status = 'released', updated_at = ${input.completedAt}
              WHERE ticket_id = ${input.ticketId}
            `;
            yield* sql`
              UPDATE workbench_ticket_workspaces
              SET status = 'released', updated_at = ${input.completedAt}
              WHERE ticket_id = ${input.ticketId}
            `;
            return Option.getOrThrow(yield* loadTicketWorkspace(input.ticketId));
          }),
        )
        .pipe(Effect.mapError(workbenchStoreError));
    });

  const createProject: WorkbenchStoreShape["createProject"] = Effect.fn(
    "WorkbenchStore.createProject",
  )(function* (input) {
    const linkedProjectIds = [...new Set(input.linkedProjectIds)];
    for (const linkedProjectId of linkedProjectIds) {
      const project = yield* findT3Project({ linkedProjectId }).pipe(
        Effect.mapError(persistenceError),
      );
      if (Option.isNone(project)) {
        return yield* new WorkbenchOperationError({
          code: "linked_project_not_found",
          message: "A linked T3 Project does not exist on this environment.",
        });
      }
    }

    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
          INSERT INTO workbench_projects (project_id, title, created_at, updated_at)
          VALUES (${input.id}, ${input.title}, ${input.createdAt}, ${input.createdAt})
        `;
          for (const [position, linkedProjectId] of linkedProjectIds.entries()) {
            yield* sql`
            INSERT INTO workbench_project_links (
              workbench_project_id,
              t3_project_id,
              position
            ) VALUES (${input.id}, ${linkedProjectId}, ${position})
          `;
          }
        }),
      )
      .pipe(Effect.mapError(persistenceError));

    return WorkbenchProject.make({
      ...input,
      linkedProjectIds,
      updatedAt: input.createdAt,
    });
  });

  const updateProject: WorkbenchStoreShape["updateProject"] = Effect.fn(
    "WorkbenchStore.updateProject",
  )(function* (input) {
    const linkedProjectIds = [...new Set(input.linkedProjectIds)];
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          // Acquire SQLite's writer lock before reading links. This serializes
          // additive link updates from concurrent clients.
          yield* sql`
            UPDATE workbench_projects
            SET updated_at = updated_at
            WHERE project_id = ${input.id}
          `;
          const current = yield* findProject({ id: input.id });
          if (Option.isNone(current)) {
            return yield* new WorkbenchOperationError({
              code: "project_not_found",
              message: "The Workbench Workspace does not exist.",
            });
          }

          const currentLinks = (yield* listProjectLinkRows()).filter(
            (link) => link.projectId === input.id,
          );
          const existingProjectIds = currentLinks.map((link) => link.linkedProjectId);
          const existingProjectIdSet = new Set(existingProjectIds);
          const additions = linkedProjectIds.filter(
            (linkedProjectId) => !existingProjectIdSet.has(linkedProjectId),
          );
          for (const linkedProjectId of additions) {
            const project = yield* findT3Project({ linkedProjectId });
            if (Option.isNone(project)) {
              return yield* new WorkbenchOperationError({
                code: "linked_project_not_found",
                message: "A linked T3 Project does not exist on this environment.",
              });
            }
          }

          yield* sql`
            UPDATE workbench_projects
            SET title = ${input.title}, updated_at = ${input.updatedAt}
            WHERE project_id = ${input.id}
          `;
          const nextPosition = currentLinks.reduce(
            (position, link) => Math.max(position, link.position + 1),
            0,
          );
          for (const [offset, linkedProjectId] of additions.entries()) {
            yield* sql`
              INSERT INTO workbench_project_links (
                workbench_project_id,
                t3_project_id,
                position
              ) VALUES (${input.id}, ${linkedProjectId}, ${nextPosition + offset})
            `;
          }

          return WorkbenchProject.make({
            ...current.value,
            title: input.title,
            linkedProjectIds: [...existingProjectIds, ...additions],
            updatedAt: input.updatedAt,
          });
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const createEpic: WorkbenchStoreShape["createEpic"] = Effect.fn("WorkbenchStore.createEpic")(
    function* (input) {
      const project = yield* findProject({ id: input.projectId }).pipe(
        Effect.mapError(persistenceError),
      );
      if (Option.isNone(project)) {
        return yield* new WorkbenchOperationError({
          code: "project_not_found",
          message: "The Workbench Workspace does not exist.",
        });
      }
      yield* sql`
      INSERT INTO workbench_epics (
        epic_id,
        workbench_project_id,
        title,
        markdown,
        archived_at,
        created_at,
        updated_at
      ) VALUES (
        ${input.id},
        ${input.projectId},
        ${input.title},
        ${input.markdown},
        NULL,
        ${input.createdAt},
        ${input.createdAt}
      )
    `.pipe(Effect.mapError(persistenceError));
      return WorkbenchEpic.make({
        ...input,
        archivedAt: null,
        updatedAt: input.createdAt,
      });
    },
  );

  const updateEpic: WorkbenchStoreShape["updateEpic"] = Effect.fn("WorkbenchStore.updateEpic")(
    function* (input) {
      const current = yield* findEpic({ epicId: input.id }).pipe(Effect.mapError(persistenceError));
      if (Option.isNone(current)) {
        return yield* new WorkbenchOperationError({
          code: "epic_not_found",
          message: "The Workbench Epic does not exist.",
        });
      }
      yield* sql`
      UPDATE workbench_epics
      SET
        title = CASE
          WHEN EXISTS (
            SELECT 1
            FROM workbench_jira_bindings AS jira_binding
            WHERE jira_binding.workbench_project_id = workbench_epics.workbench_project_id
              AND instr(
                workbench_epics.epic_id,
                'jira:' || jira_binding.binding_id || ':epic:'
              ) = 1
          ) THEN title
          ELSE ${input.title}
        END,
        markdown = ${input.markdown},
        updated_at = ${input.updatedAt}
      WHERE epic_id = ${input.id}
    `.pipe(Effect.mapError(persistenceError));
      const updated = yield* findEpic({ epicId: input.id }).pipe(Effect.mapError(persistenceError));
      return Option.getOrThrow(updated);
    },
  );

  const archiveEpic: WorkbenchStoreShape["archiveEpic"] = Effect.fn("WorkbenchStore.archiveEpic")(
    function* (input) {
      const current = yield* findEpic({ epicId: input.id }).pipe(Effect.mapError(persistenceError));
      if (Option.isNone(current)) {
        return yield* new WorkbenchOperationError({
          code: "epic_not_found",
          message: "The Workbench Epic does not exist.",
        });
      }
      yield* sql`
      UPDATE workbench_epics
      SET archived_at = ${input.archivedAt}, updated_at = ${input.archivedAt}
      WHERE epic_id = ${input.id}
    `.pipe(Effect.mapError(persistenceError));
      return WorkbenchEpic.make({
        ...current.value,
        archivedAt: input.archivedAt,
        updatedAt: input.archivedAt,
      });
    },
  );

  const validateTicketRepositoryScope = Effect.fn("WorkbenchStore.validateTicketRepositoryScope")(
    function* ({
      projectId,
      primaryT3ProjectId,
      repositoryProjectIds,
    }: {
      projectId: WorkbenchProjectId;
      primaryT3ProjectId: ProjectId;
      repositoryProjectIds: ReadonlyArray<ProjectId>;
    }) {
      const normalizedRepositoryProjectIds = [...new Set(repositoryProjectIds)];
      if (!normalizedRepositoryProjectIds.includes(primaryT3ProjectId)) {
        return yield* new WorkbenchOperationError({
          code: "primary_repository_not_selected",
          message: "The primary Ticket repository must be included in its repository scope.",
        });
      }
      for (const linkedProjectId of normalizedRepositoryProjectIds) {
        const link = yield* findProjectLink({ projectId, linkedProjectId }).pipe(
          Effect.mapError(persistenceError),
        );
        if (Option.isNone(link)) {
          return yield* new WorkbenchOperationError({
            code:
              linkedProjectId === primaryT3ProjectId
                ? "primary_project_not_linked"
                : "repository_not_linked",
            message: "A Ticket repository is not linked to its Workbench Workspace.",
          });
        }
      }
      return normalizedRepositoryProjectIds;
    },
  );

  const validateTicketEpic = Effect.fn("WorkbenchStore.validateTicketEpic")(function* ({
    projectId,
    epicId,
    allowArchived = false,
  }: {
    projectId: WorkbenchProjectId;
    epicId: WorkbenchEpicId | null;
    allowArchived?: boolean;
  }) {
    if (epicId === null) return null;
    const epic = yield* findEpic({ epicId }).pipe(Effect.mapError(persistenceError));
    if (Option.isNone(epic)) {
      return yield* new WorkbenchOperationError({
        code: "epic_not_found",
        message: "The Workbench Epic does not exist.",
      });
    }
    if (epic.value.projectId !== projectId) {
      return yield* new WorkbenchOperationError({
        code: "epic_project_mismatch",
        message: "The Workbench Epic belongs to a different Workspace.",
      });
    }
    if (epic.value.archivedAt !== null && !allowArchived) {
      return yield* new WorkbenchOperationError({
        code: "epic_archived",
        message: "Archived Workbench Epics cannot receive Tickets.",
      });
    }
    return epicId;
  });

  const createTicket: WorkbenchStoreShape["createTicket"] = Effect.fn(
    "WorkbenchStore.createTicket",
  )(function* (input) {
    const project = yield* findProject({ id: input.projectId }).pipe(
      Effect.mapError(persistenceError),
    );
    if (Option.isNone(project)) {
      return yield* new WorkbenchOperationError({
        code: "project_not_found",
        message: "The Workbench Workspace does not exist.",
      });
    }
    const epicId = yield* validateTicketEpic({
      projectId: input.projectId,
      epicId: input.epicId ?? null,
    });
    const repositoryProjectIds = yield* validateTicketRepositoryScope({
      projectId: input.projectId,
      primaryT3ProjectId: input.primaryT3ProjectId,
      repositoryProjectIds: input.repositoryProjectIds ?? [input.primaryT3ProjectId],
    });
    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO workbench_tickets (
              ticket_id,
              workbench_project_id,
              epic_id,
              title,
              kind,
              markdown,
              primary_t3_project_id,
              status,
              blocked,
              revision,
              generated_summary,
              generated_summary_status,
              generated_summary_stale,
              generated_summary_error,
              generated_summary_source_hash,
              generated_summary_request_id,
              created_at,
              updated_at
            ) VALUES (
              ${input.id},
              ${input.projectId},
              ${epicId},
              ${input.title},
              ${input.kind},
              ${input.markdown},
              ${input.primaryT3ProjectId},
              'todo',
              0,
              0,
              NULL,
              'pending',
              0,
              NULL,
              NULL,
              NULL,
              ${input.createdAt},
              ${input.createdAt}
            )
          `;
          for (const [position, repositoryProjectId] of repositoryProjectIds.entries()) {
            yield* sql`
              INSERT INTO workbench_ticket_repositories (
                ticket_id,
                t3_project_id,
                position
              ) VALUES (${input.id}, ${repositoryProjectId}, ${position})
            `;
          }
        }),
      )
      .pipe(Effect.mapError(persistenceError));

    const ticket = WorkbenchTicket.make({
      ...input,
      epicId,
      repositoryProjectIds,
      status: "todo",
      blocked: false,
      revision: 0,
      generatedSummary: {
        text: null,
        status: "pending",
        stale: false,
        error: null,
      },
      archivedAt: null,
      updatedAt: input.createdAt,
    });
    yield* publishTicketChange(ticket.id);
    return ticket;
  });

  const resolveTicketUpdateFields = ({
    input,
    current,
    jiraManaged,
  }: {
    readonly input: WorkbenchUpdateTicketInput;
    readonly current: typeof WorkbenchTicketRow.Type;
    readonly jiraManaged: boolean;
  }) => {
    let epicId = current.epicId;
    if (!jiraManaged && input.epicId !== undefined) {
      epicId = input.epicId;
    }
    return {
      epicId,
      title: jiraManaged ? current.title : (input.title ?? current.title),
      kind: jiraManaged ? current.kind : (input.kind ?? current.kind),
      markdown: jiraManaged ? current.markdown : (input.markdown ?? current.markdown),
      status: jiraManaged ? current.status : (input.status ?? current.status),
      blocked: jiraManaged ? current.blocked === 1 : (input.blocked ?? current.blocked === 1),
    };
  };

  const updateTicket: WorkbenchStoreShape["updateTicket"] = Effect.fn(
    "WorkbenchStore.updateTicket",
  )(function* (input) {
    const { ticket, contentChanged } = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* requireTicketRevision({
            ticketId: input.id,
            expectedRevision: input.expectedRevision,
            revisionMessage: "The Workbench Ticket changed before it could be updated.",
            activeOnly: false,
          });
          if (current.archivedAt !== null) {
            return yield* new WorkbenchOperationError({
              code: "ticket_archived",
              message: "Archived Workbench Tickets cannot be modified.",
            });
          }
          const currentRepositories = yield* listTicketRepositoryRowsByTicket({
            ticketId: input.id,
          });
          const jiraManaged = yield* isJiraManagedTicket(input.id);
          const {
            epicId: requestedEpicId,
            title,
            kind,
            markdown,
            status,
            blocked,
          } = resolveTicketUpdateFields({ input, current, jiraManaged });
          const epicId = yield* validateTicketEpic({
            projectId: current.projectId,
            epicId: requestedEpicId,
            allowArchived: requestedEpicId === current.epicId,
          });
          const currentRepositoryProjectIds = currentRepositories.map(
            (repository) => repository.repositoryProjectId,
          );
          const primaryT3ProjectId = input.primaryT3ProjectId ?? current.primaryT3ProjectId;
          const repositoryProjectIds = yield* validateTicketRepositoryScope({
            projectId: current.projectId,
            primaryT3ProjectId,
            repositoryProjectIds:
              input.repositoryProjectIds ??
              (currentRepositoryProjectIds.length > 0
                ? currentRepositoryProjectIds
                : [current.primaryT3ProjectId]),
          });
          const existingAssignment = yield* findAnyAssignmentByTicket({ ticketId: input.id });
          const existingTicketWorkspace = yield* loadTicketWorkspace(input.id);
          const ticketWorkspaceLocksScope =
            Option.isSome(existingTicketWorkspace) &&
            (existingTicketWorkspace.value.status === "preparing" ||
              existingTicketWorkspace.value.status === "ready" ||
              existingTicketWorkspace.value.status === "releasing" ||
              existingTicketWorkspace.value.repositories.some(
                (repository) => repository.status === "ready",
              ));
          const repositoryScopeChanged =
            primaryT3ProjectId !== current.primaryT3ProjectId ||
            repositoryProjectIds.length !== currentRepositoryProjectIds.length ||
            repositoryProjectIds.some(
              (repositoryProjectId) => !currentRepositoryProjectIds.includes(repositoryProjectId),
            );
          if (
            repositoryScopeChanged &&
            (Option.isSome(existingAssignment) || ticketWorkspaceLocksScope)
          ) {
            return yield* new WorkbenchOperationError({
              code: "ticket_repository_scope_locked",
              message: "Ticket repository scope cannot change after Agent work has started.",
            });
          }
          const contentChanged = title !== current.title || markdown !== current.markdown;
          const summary = summaryUpdate({ row: current, contentChanged });
          yield* sql`
            UPDATE workbench_tickets
            SET
              title = ${title},
              epic_id = ${epicId},
              kind = ${kind},
              markdown = ${markdown},
              primary_t3_project_id = ${primaryT3ProjectId},
              status = ${status},
              blocked = ${blocked ? 1 : 0},
              generated_summary_status = ${summary.generatedSummaryStatus},
              generated_summary_stale = ${summary.generatedSummaryStale},
              generated_summary_error = ${summary.generatedSummaryError},
              generated_summary_source_hash = ${summary.generatedSummarySourceHash},
              generated_summary_request_id = ${summary.generatedSummaryRequestId},
              revision = revision + 1,
              updated_at = ${input.updatedAt}
            WHERE ticket_id = ${input.id}
              AND revision = ${input.expectedRevision}
          `;
          if (repositoryScopeChanged) {
            yield* sql`
              DELETE FROM workbench_ticket_repositories
              WHERE ticket_id = ${input.id}
            `;
            for (const [position, repositoryProjectId] of repositoryProjectIds.entries()) {
              yield* sql`
                INSERT INTO workbench_ticket_repositories (
                  ticket_id,
                  t3_project_id,
                  position
                ) VALUES (${input.id}, ${repositoryProjectId}, ${position})
              `;
            }
          }
          return {
            ticket: WorkbenchTicket.make({
              id: current.id,
              projectId: current.projectId,
              epicId,
              title,
              kind,
              markdown,
              primaryT3ProjectId,
              repositoryProjectIds,
              status,
              blocked,
              revision: current.revision + 1,
              generatedSummary: summary.generatedSummary,
              archivedAt: current.archivedAt,
              createdAt: current.createdAt,
              updatedAt: input.updatedAt,
            }),
            contentChanged,
          };
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
    if (contentChanged) yield* publishTicketChange(ticket.id);
    return ticket;
  });

  const updateJiraTicketFields: WorkbenchStoreShape["updateJiraTicketFields"] = Effect.fn(
    "WorkbenchStore.updateJiraTicketFields",
  )(function* (input) {
    const { ticket, contentChanged } = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* requireTicketRevision({
            ticketId: input.id,
            expectedRevision: input.expectedRevision,
            revisionMessage: "The Workbench Ticket changed before Jira could update it.",
            activeOnly: true,
          });
          if (current.archivedAt !== null) {
            return yield* new WorkbenchOperationError({
              code: "ticket_archived",
              message: "Archived Workbench Tickets cannot be updated from Jira.",
            });
          }

          const repositories = yield* listTicketRepositoryRowsByTicket({ ticketId: input.id });
          const epicId = input.epicId === undefined ? current.epicId : input.epicId;
          const title = input.title === undefined ? current.title : input.title;
          const kind = input.kind === undefined ? current.kind : input.kind;
          const status = input.status === undefined ? current.status : input.status;
          const blocked = input.blocked === undefined ? current.blocked === 1 : input.blocked;
          const markdown = input.markdown === undefined ? current.markdown : input.markdown;
          const changed =
            epicId !== current.epicId ||
            title !== current.title ||
            kind !== current.kind ||
            status !== current.status ||
            blocked !== (current.blocked === 1) ||
            markdown !== current.markdown;
          if (!changed) {
            return {
              ticket: ticketFromRow(
                current,
                repositories.length > 0
                  ? repositories.map((repository) => repository.repositoryProjectId)
                  : [current.primaryT3ProjectId],
              ),
              contentChanged: false,
            };
          }
          const contentChanged = title !== current.title || markdown !== current.markdown;
          const summary = summaryUpdate({ row: current, contentChanged });

          const updated = yield* sql<{ readonly id: string; readonly updatedAt: string }>`
            UPDATE workbench_tickets
            SET
              epic_id = ${epicId},
              title = ${title},
              kind = ${kind},
              status = ${status},
              blocked = ${blocked ? 1 : 0},
              markdown = ${markdown},
              generated_summary_status = ${summary.generatedSummaryStatus},
              generated_summary_stale = ${summary.generatedSummaryStale},
              generated_summary_error = ${summary.generatedSummaryError},
              generated_summary_source_hash = ${summary.generatedSummarySourceHash},
              generated_summary_request_id = ${summary.generatedSummaryRequestId},
              revision = revision + 1,
              updated_at = MAX(updated_at, ${input.updatedAt})
            WHERE ticket_id = ${input.id}
              AND deleted_at IS NULL
              AND revision = ${input.expectedRevision}
            RETURNING ticket_id AS id, updated_at AS "updatedAt"
          `;
          const persisted = updated[0];
          if (persisted === undefined) {
            return yield* new WorkbenchOperationError({
              code: "ticket_changed",
              message: "The Workbench Ticket changed before Jira could update it.",
            });
          }
          return {
            ticket: WorkbenchTicket.make({
              id: current.id,
              projectId: current.projectId,
              epicId,
              title,
              kind,
              status,
              blocked,
              markdown,
              primaryT3ProjectId: current.primaryT3ProjectId,
              revision: current.revision + 1,
              generatedSummary: summary.generatedSummary,
              repositoryProjectIds:
                repositories.length > 0
                  ? repositories.map((repository) => repository.repositoryProjectId)
                  : [current.primaryT3ProjectId],
              createdAt: current.createdAt,
              updatedAt: persisted.updatedAt,
            }),
            contentChanged,
          };
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
    if (contentChanged) yield* publishTicketChange(ticket.id);
    return ticket;
  });

  const requestTicketSummary: WorkbenchStoreShape["requestTicketSummary"] = Effect.fn(
    "WorkbenchStore.requestTicketSummary",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* findTicket({ id: input.ticketId });
          if (Option.isNone(current)) {
            return yield* new WorkbenchOperationError({
              code: "ticket_not_found",
              message: "The Workbench Ticket does not exist.",
            });
          }
          if (current.value.archivedAt !== null) {
            return yield* new WorkbenchOperationError({
              code: "ticket_archived",
              message: "Archived Workbench Tickets cannot generate a summary.",
            });
          }
          const jiraLinks = yield* listJiraIssueLinkActivity(input.ticketId);
          if (jiraLinks.length > 0 && !jiraLinks.some((link) => link.active === 1)) {
            return yield* new WorkbenchOperationError({
              code: "ticket_summary_generation_failed",
              message: "This Jira Ticket is no longer active and cannot generate a summary.",
            });
          }
          const sourceHash = ticketSummarySourceHash(current.value.title, current.value.markdown);
          yield* sql`
            UPDATE workbench_tickets
            SET
              generated_summary_status = 'pending',
              generated_summary_stale = ${current.value.generatedSummaryStale},
              generated_summary_error = NULL,
              generated_summary_source_hash = ${sourceHash},
              generated_summary_request_id = ${input.requestId}
            WHERE ticket_id = ${input.ticketId}
              AND deleted_at IS NULL
          `;
          const repositories = yield* listTicketRepositoryRowsByTicket({
            ticketId: input.ticketId,
          });
          return ticketFromRow(
            {
              ...current.value,
              generatedSummaryStatus: "pending",
              generatedSummaryStale: current.value.generatedSummaryStale,
              generatedSummaryError: null,
              generatedSummarySourceHash: sourceHash,
              generatedSummaryRequestId: input.requestId,
            },
            repositories.length > 0
              ? repositories.map((repository) => repository.repositoryProjectId)
              : [current.value.primaryT3ProjectId],
          );
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const completeTicketSummary: WorkbenchStoreShape["completeTicketSummary"] = Effect.fn(
    "WorkbenchStore.completeTicketSummary",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* findTicket({ id: input.ticketId });
          if (Option.isNone(current) || current.value.archivedAt !== null) {
            return Option.none<WorkbenchTicket>();
          }
          const sourceHash = ticketSummarySourceHash(current.value.title, current.value.markdown);
          if (
            current.value.generatedSummaryRequestId !== input.requestId ||
            current.value.generatedSummarySourceHash !== sourceHash
          ) {
            return Option.none<WorkbenchTicket>();
          }
          const summary = normalizeSummaryText(input.summary);
          const updated = yield* sql<{ readonly ticketId: string }>`
            UPDATE workbench_tickets
            SET
              generated_summary = ${summary},
              generated_summary_status = 'ready',
              generated_summary_stale = 0,
              generated_summary_error = NULL,
              generated_summary_request_id = NULL,
              generated_summary_source_hash = ${sourceHash}
            WHERE ticket_id = ${input.ticketId}
              AND deleted_at IS NULL
              AND generated_summary_request_id = ${input.requestId}
              AND generated_summary_source_hash = ${sourceHash}
            RETURNING ticket_id AS "ticketId"
          `;
          if (updated.length === 0) return Option.none<WorkbenchTicket>();
          const repositories = yield* listTicketRepositoryRowsByTicket({
            ticketId: input.ticketId,
          });
          return Option.some(
            ticketFromRow(
              {
                ...current.value,
                generatedSummaryText: summary,
                generatedSummaryStatus: "ready",
                generatedSummaryStale: 0,
                generatedSummaryError: null,
                generatedSummarySourceHash: sourceHash,
                generatedSummaryRequestId: null,
              },
              repositories.length > 0
                ? repositories.map((repository) => repository.repositoryProjectId)
                : [current.value.primaryT3ProjectId],
            ),
          );
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const failTicketSummary: WorkbenchStoreShape["failTicketSummary"] = Effect.fn(
    "WorkbenchStore.failTicketSummary",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* findTicket({ id: input.ticketId });
          if (Option.isNone(current) || current.value.archivedAt !== null) {
            return Option.none<WorkbenchTicket>();
          }
          const sourceHash = ticketSummarySourceHash(current.value.title, current.value.markdown);
          if (
            current.value.generatedSummaryRequestId !== input.requestId ||
            current.value.generatedSummarySourceHash !== sourceHash
          ) {
            return Option.none<WorkbenchTicket>();
          }
          const error = normalizeSummaryError(input.error);
          const updated = yield* sql<{ readonly ticketId: string }>`
            UPDATE workbench_tickets
            SET
              generated_summary_status = 'error',
              generated_summary_stale = ${current.value.generatedSummaryStale},
              generated_summary_error = ${error},
              generated_summary_request_id = NULL,
              generated_summary_source_hash = ${sourceHash}
            WHERE ticket_id = ${input.ticketId}
              AND deleted_at IS NULL
              AND generated_summary_request_id = ${input.requestId}
              AND generated_summary_source_hash = ${sourceHash}
            RETURNING ticket_id AS "ticketId"
          `;
          if (updated.length === 0) return Option.none<WorkbenchTicket>();
          const repositories = yield* listTicketRepositoryRowsByTicket({
            ticketId: input.ticketId,
          });
          return Option.some(
            ticketFromRow(
              {
                ...current.value,
                generatedSummaryStatus: "error",
                generatedSummaryStale: current.value.generatedSummaryStale,
                generatedSummaryError: error,
                generatedSummarySourceHash: sourceHash,
                generatedSummaryRequestId: null,
              },
              repositories.length > 0
                ? repositories.map((repository) => repository.repositoryProjectId)
                : [current.value.primaryT3ProjectId],
            ),
          );
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const archiveTicket: WorkbenchStoreShape["archiveTicket"] = Effect.fn(
    "WorkbenchStore.archiveTicket",
  )(function* (input) {
    const { ticket, shouldPublishChange } = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* requireTicketRevision({
            ticketId: input.ticketId,
            expectedRevision: input.expectedRevision,
            revisionMessage:
              "The Workbench Ticket changed before its lifecycle state could be updated.",
            activeOnly: true,
          });
          if (yield* isJiraManagedTicket(input.ticketId)) {
            return yield* new WorkbenchOperationError({
              code: "jira_managed_ticket",
              message: "Jira-managed Tickets cannot be archived.",
            });
          }
          const workspace = yield* findTicketWorkspaceRow({ ticketId: input.ticketId });
          if (
            Option.isSome(workspace) &&
            (workspace.value.status === "preparing" || workspace.value.status === "releasing")
          ) {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_in_use",
              message: "The Ticket Workspace is changing and cannot be archived.",
            });
          }
          yield* sql`
            UPDATE workbench_tickets
            SET archived_at = ${input.archivedAt},
                revision = revision + 1,
                updated_at = ${input.updatedAt}
            WHERE ticket_id = ${input.ticketId}
              AND deleted_at IS NULL
              AND revision = ${input.expectedRevision}
          `;
          const repositories = yield* listTicketRepositoryRowsByTicket({
            ticketId: input.ticketId,
          });
          return {
            ticket: ticketFromRow(
              {
                ...current,
                archivedAt: input.archivedAt,
                revision: current.revision + 1,
                updatedAt: input.updatedAt,
              },
              repositories.length > 0
                ? repositories.map((repository) => repository.repositoryProjectId)
                : [current.primaryT3ProjectId],
            ),
            shouldPublishChange: input.archivedAt === null,
          };
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
    if (shouldPublishChange) yield* publishTicketChange(ticket.id);
    return ticket;
  });

  const deleteTicket: WorkbenchStoreShape["deleteTicket"] = Effect.fn(
    "WorkbenchStore.deleteTicket",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* requireTicketRevision({
            ticketId: input.ticketId,
            expectedRevision: input.expectedRevision,
            revisionMessage: "The Workbench Ticket changed before it could be deleted.",
            activeOnly: true,
          });
          if (yield* isJiraManagedTicket(input.ticketId)) {
            return yield* new WorkbenchOperationError({
              code: "jira_managed_ticket",
              message: "Jira-managed Tickets cannot be deleted.",
            });
          }
          const workspace = yield* findTicketWorkspaceRow({ ticketId: input.ticketId });
          if (
            Option.isSome(workspace) &&
            (workspace.value.status === "preparing" || workspace.value.status === "releasing")
          ) {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_in_use",
              message: "The Ticket Workspace is changing and cannot be deleted.",
            });
          }
          yield* sql`
            UPDATE workbench_tickets
            SET deleted_at = ${input.deletedAt},
                revision = revision + 1,
                updated_at = ${input.deletedAt}
            WHERE ticket_id = ${input.ticketId}
              AND deleted_at IS NULL
              AND revision = ${input.expectedRevision}
          `;
          return undefined;
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const requireAssignableThread = Effect.fn("WorkbenchStore.requireAssignableThread")(function* ({
    ticketId,
    threadId,
  }: {
    ticketId: WorkbenchTicketId;
    threadId: ThreadId;
  }) {
    const ticket = yield* findTicket({ id: ticketId }).pipe(Effect.mapError(persistenceError));
    if (Option.isNone(ticket)) {
      return yield* new WorkbenchOperationError({
        code: "ticket_not_found",
        message: "The Workbench Ticket does not exist.",
      });
    }
    if (ticket.value.archivedAt !== null) {
      return yield* new WorkbenchOperationError({
        code: "ticket_archived",
        message: "Archived Workbench Tickets cannot receive Agent Threads.",
      });
    }
    const nativeThread = yield* findNativeThread({ threadId }).pipe(
      Effect.mapError(persistenceError),
    );
    if (Option.isNone(nativeThread)) {
      return yield* new WorkbenchOperationError({
        code: "thread_not_found",
        message: "The native T3 Thread does not exist.",
      });
    }
    if (nativeThread.value.projectId !== ticket.value.primaryT3ProjectId) {
      return yield* new WorkbenchOperationError({
        code: "thread_project_mismatch",
        message: "The native T3 Thread belongs to a different T3 Project.",
      });
    }
    return ticket.value;
  });

  const createAssignment: WorkbenchStoreShape["createAssignment"] = Effect.fn(
    "WorkbenchStore.createAssignment",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
            UPDATE workbench_tickets
            SET updated_at = updated_at
            WHERE ticket_id = ${input.ticketId}
          `;
          const existingAssignment = yield* findAssignmentByThread({ threadId: input.threadId });
          if (Option.isSome(existingAssignment)) {
            return yield* new WorkbenchOperationError({
              code: "assignment_already_exists",
              message: "This native T3 Thread already belongs to a Workbench Ticket.",
            });
          }
          const ticketWorkspace = yield* findTicketWorkspaceRow({ ticketId: input.ticketId });
          if (
            Option.isSome(ticketWorkspace) &&
            (ticketWorkspace.value.status === "preparing" ||
              ticketWorkspace.value.status === "releasing")
          ) {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_in_use",
              message: "The Ticket Workspace is changing and cannot receive an Assignment.",
            });
          }
          yield* requireAssignableThread({
            ticketId: input.ticketId,
            threadId: input.threadId,
          });
          yield* sql`
            INSERT INTO workbench_assignments (assignment_id, ticket_id, thread_id, created_at)
            VALUES (${input.id}, ${input.ticketId}, ${input.threadId}, ${input.createdAt})
          `;
          return WorkbenchAssignment.make({ ...input, supersededAt: null });
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  const replaceAssignment: WorkbenchStoreShape["replaceAssignment"] = Effect.fn(
    "WorkbenchStore.replaceAssignment",
  )(function* (input) {
    const replacement = WorkbenchAssignment.make({
      id: input.id ?? WorkbenchAssignmentId.make(NodeCrypto.randomUUID()),
      ticketId: input.ticketId,
      threadId: input.threadId,
      createdAt: input.replacedAt,
      supersededAt: null,
    });
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* requireActiveTicket({
            ticketId: input.ticketId,
            archivedMessage: "Archived Workbench Tickets cannot replace an Agent Thread.",
          });
          const ticketWorkspace = yield* loadTicketWorkspace(input.ticketId);
          if (
            Option.isSome(ticketWorkspace) &&
            (ticketWorkspace.value.status === "preparing" ||
              ticketWorkspace.value.status === "releasing")
          ) {
            return yield* new WorkbenchOperationError({
              code: "ticket_workspace_in_use",
              message: "The Ticket Workspace is changing and cannot replace an Agent Thread.",
            });
          }
          const assignment = yield* findActiveAssignmentByTicketAndThread({
            ticketId: input.ticketId,
            threadId: input.previousThreadId,
          });
          if (Option.isNone(assignment)) {
            const activeAssignment = yield* findActiveAssignmentByTicket({
              ticketId: input.ticketId,
            });
            if (Option.isSome(activeAssignment)) {
              return yield* new WorkbenchOperationError({
                code: "assignment_changed",
                message: "The Workbench Assignment changed before it could be replaced.",
              });
            }
            return yield* new WorkbenchOperationError({
              code: "assignment_not_found",
              message: "The Workbench Assignment does not exist.",
            });
          }
          const existingReplacement = yield* findAssignmentByThread({ threadId: input.threadId });
          if (Option.isSome(existingReplacement)) {
            return yield* new WorkbenchOperationError({
              code: "assignment_already_exists",
              message: "This native T3 Thread already belongs to a Workbench Ticket.",
            });
          }
          yield* requireAssignableThread({ ticketId: input.ticketId, threadId: input.threadId });
          const superseded = yield* supersedeAssignmentRow(input);
          if (Option.isNone(superseded)) {
            return yield* new WorkbenchOperationError({
              code: "assignment_changed",
              message: "The Workbench Assignment changed before it could be replaced.",
            });
          }
          yield* sql`
            INSERT INTO workbench_assignments (
              assignment_id,
              ticket_id,
              thread_id,
              created_at,
              superseded_at
            ) VALUES (
              ${replacement.id},
              ${replacement.ticketId},
              ${replacement.threadId},
              ${replacement.createdAt},
              NULL
            )
          `;
          return replacement;
        }),
      )
      .pipe(Effect.mapError(workbenchStoreError));
  });

  return WorkbenchStore.of({
    getSnapshot: getSnapshot(),
    listTicketsNeedingSummary: listTicketsNeedingSummary(),
    getTicketSummaryCandidate,
    recheckTicketSummary,
    ticketChanges,
    createProject,
    updateProject,
    createEpic,
    updateEpic,
    archiveEpic,
    createTicket,
    updateTicket,
    updateJiraTicketFields,
    requestTicketSummary,
    completeTicketSummary,
    failTicketSummary,
    archiveTicket,
    deleteTicket,
    createAssignment,
    replaceAssignment,
    getTicketWorkspace,
    claimTicketWorkspace,
    markTicketWorkspaceRepositoryReady,
    completeTicketWorkspace,
    failTicketWorkspace,
    releaseTicketWorkspaceRepository,
    claimTicketWorkspaceRelease,
    completeTicketWorkspaceRelease,
  });
});

export const WorkbenchStoreLive = Layer.effect(
  WorkbenchStore,
  ensureWorkbenchSchema.pipe(Effect.flatMap(() => makeWorkbenchStore)),
);
