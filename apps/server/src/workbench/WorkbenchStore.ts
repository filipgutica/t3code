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
  WorkbenchTicketId,
  WorkbenchTicketWorkspace,
  WorkbenchTicketWorkspaceAttemptId,
  WorkbenchTicketWorkspaceRepository,
  ThreadId,
  ProjectId,
  type WorkbenchCreateAssignmentInput,
  type WorkbenchArchiveEpicInput,
  type WorkbenchCreateEpicInput,
  type WorkbenchCreateProjectInput,
  type WorkbenchCreateTicketInput,
  type WorkbenchReplaceAssignmentInput,
  type WorkbenchUpdateEpicInput,
  type WorkbenchUpdateTicketInput,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

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
const FindT3ProjectInput = Schema.Struct({ linkedProjectId: ProjectId });
const FindProjectLinkInput = Schema.Struct({
  projectId: WorkbenchProjectId,
  linkedProjectId: ProjectId,
});
const FindThreadInput = Schema.Struct({ threadId: ThreadId });
const FindTicketInput = Schema.Struct({ ticketId: WorkbenchTicketId });
const FindEpicInput = Schema.Struct({ epicId: WorkbenchEpicId });
const NativeThreadRow = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
});
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
  createdAt: WorkbenchTicket.fields.createdAt,
  updatedAt: WorkbenchTicket.fields.updatedAt,
});

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
}

interface WorkbenchStoreShape {
  readonly getSnapshot: Effect.Effect<WorkbenchSnapshot, WorkbenchOperationError>;
  readonly createProject: (
    input: WorkbenchCreateProjectInput,
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
  "t3/workbench/WorkbenchStore",
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
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_tickets
      ORDER BY created_at ASC, ticket_id ASC
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
      ORDER BY created_at ASC, assignment_id ASC
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
  const findT3Project = SqlSchema.findOneOption({
    Request: FindT3ProjectInput,
    Result: Schema.Struct({ id: ProjectId }),
    execute: ({ linkedProjectId }) => sql`
      SELECT project_id AS "id"
      FROM projection_projects
      WHERE project_id = ${linkedProjectId}
        AND deleted_at IS NULL
    `,
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
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workbench_tickets
      WHERE ticket_id = ${id}
    `,
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
  const findNativeThread = SqlSchema.findOneOption({
    Request: FindThreadInput,
    Result: NativeThreadRow,
    execute: ({ threadId }) => sql`
      SELECT thread_id AS "id", project_id AS "projectId"
      FROM projection_threads
      WHERE thread_id = ${threadId}
        AND deleted_at IS NULL
    `,
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
  const findActiveLiveAssignmentByTicket = SqlSchema.findOneOption({
    Request: Schema.Struct({ ticketId: WorkbenchTicketId }),
    Result: WorkbenchAssignment,
    execute: ({ ticketId }) => sql`
      SELECT
        assignment.assignment_id AS "id",
        assignment.ticket_id AS "ticketId",
        assignment.thread_id AS "threadId",
        assignment.created_at AS "createdAt",
        assignment.superseded_at AS "supersededAt"
      FROM workbench_assignments AS assignment
      INNER JOIN projection_threads AS thread
        ON thread.thread_id = assignment.thread_id
       AND thread.deleted_at IS NULL
      WHERE assignment.ticket_id = ${ticketId}
        AND assignment.superseded_at IS NULL
    `,
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
          ticketWorkspaceRows,
          ticketWorkspaceRepositoryRows,
        ] = yield* Effect.all([
          listProjectRows(),
          listProjectLinkRows(),
          listEpicRows(),
          listTicketRows(),
          listTicketRepositoryRows(),
          listAssignmentRows(),
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
          tickets: ticketRows.map((ticket) => ({
            ...ticket,
            repositoryProjectIds: repositoriesByTicket.get(ticket.id) ?? [
              ticket.primaryT3ProjectId,
            ],
            blocked: ticket.blocked === 1,
          })),
          assignments,
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
          yield* sql`
            UPDATE workbench_tickets
            SET updated_at = updated_at
            WHERE ticket_id = ${input.ticketId}
          `;
          const ticket = yield* findTicket({ id: input.ticketId });
          if (Option.isNone(ticket)) {
            return yield* new WorkbenchOperationError({
              code: "ticket_not_found",
              message: "The Workbench Ticket does not exist.",
            });
          }
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
            primaryRepositories[0]?.projectId !== ticket.value.primaryT3ProjectId
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

    return WorkbenchTicket.make({
      ...input,
      epicId,
      repositoryProjectIds,
      status: "todo",
      blocked: false,
      updatedAt: input.createdAt,
    });
  });

  const updateTicket: WorkbenchStoreShape["updateTicket"] = Effect.fn(
    "WorkbenchStore.updateTicket",
  )(function* (input) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          // Acquire SQLite's writer lock before reading the Assignment invariant. This serializes
          // scope edits with Assignment creation across connections.
          yield* sql`
            UPDATE workbench_tickets
            SET updated_at = updated_at
            WHERE ticket_id = ${input.id}
          `;
          const current = yield* findTicket({ id: input.id });
          if (Option.isNone(current)) {
            return yield* new WorkbenchOperationError({
              code: "ticket_not_found",
              message: "The Workbench Ticket does not exist.",
            });
          }
          const currentRepositories = yield* listTicketRepositoryRowsByTicket({
            ticketId: input.id,
          });
          const jiraManaged = yield* isJiraManagedTicket(input.id);
          const title = jiraManaged ? current.value.title : input.title;
          const kind = jiraManaged ? current.value.kind : (input.kind ?? current.value.kind);
          const status = jiraManaged ? current.value.status : input.status;
          const blocked = jiraManaged ? current.value.blocked === 1 : input.blocked;
          const epicId = yield* validateTicketEpic({
            projectId: current.value.projectId,
            epicId: jiraManaged
              ? current.value.epicId
              : input.epicId === undefined
                ? current.value.epicId
                : input.epicId,
            allowArchived:
              (jiraManaged
                ? current.value.epicId
                : input.epicId === undefined
                  ? current.value.epicId
                  : input.epicId) === current.value.epicId,
          });
          const currentRepositoryProjectIds = currentRepositories.map(
            (repository) => repository.repositoryProjectId,
          );
          const primaryT3ProjectId = input.primaryT3ProjectId ?? current.value.primaryT3ProjectId;
          const repositoryProjectIds = yield* validateTicketRepositoryScope({
            projectId: current.value.projectId,
            primaryT3ProjectId,
            repositoryProjectIds:
              input.repositoryProjectIds ??
              (currentRepositoryProjectIds.length > 0
                ? currentRepositoryProjectIds
                : [current.value.primaryT3ProjectId]),
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
            primaryT3ProjectId !== current.value.primaryT3ProjectId ||
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
          yield* sql`
            UPDATE workbench_tickets
            SET
              title = ${title},
              epic_id = ${epicId},
              kind = ${kind},
              markdown = ${input.markdown},
              primary_t3_project_id = ${primaryT3ProjectId},
              status = ${status},
              blocked = ${blocked ? 1 : 0},
              updated_at = ${input.updatedAt}
            WHERE ticket_id = ${input.id}
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
          return WorkbenchTicket.make({
            ...current.value,
            epicId,
            title,
            kind,
            markdown: input.markdown,
            primaryT3ProjectId,
            repositoryProjectIds,
            status,
            blocked,
            updatedAt: input.updatedAt,
          });
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
          const existingAssignment = yield* findActiveAssignmentByTicket({
            ticketId: input.ticketId,
          });
          if (Option.isSome(existingAssignment)) {
            return yield* new WorkbenchOperationError({
              code: "assignment_already_exists",
              message: "The Workbench Ticket already has an Assignment.",
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
          const ticket = yield* requireAssignableThread({
            ticketId: input.ticketId,
            threadId: input.threadId,
          });
          yield* sql`
            INSERT INTO workbench_assignments (assignment_id, ticket_id, thread_id, created_at)
            VALUES (${input.id}, ${input.ticketId}, ${input.threadId}, ${input.createdAt})
          `;
          if (ticket.status === "todo" && !(yield* isJiraManagedTicket(input.ticketId))) {
            yield* sql`
              UPDATE workbench_tickets
              SET status = 'in_progress', updated_at = ${input.createdAt}
              WHERE ticket_id = ${input.ticketId}
            `;
          }
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
          yield* sql`
            UPDATE workbench_tickets
            SET updated_at = updated_at
            WHERE ticket_id = ${input.ticketId}
          `;
          const assignment = yield* findActiveAssignmentByTicket({ ticketId: input.ticketId });
          if (Option.isNone(assignment)) {
            return yield* new WorkbenchOperationError({
              code: "assignment_not_found",
              message: "The Workbench Assignment does not exist.",
            });
          }
          if (assignment.value.threadId !== input.previousThreadId) {
            return yield* new WorkbenchOperationError({
              code: "assignment_changed",
              message: "The Workbench Assignment changed before it could be replaced.",
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
    createProject,
    createEpic,
    updateEpic,
    archiveEpic,
    createTicket,
    updateTicket,
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
