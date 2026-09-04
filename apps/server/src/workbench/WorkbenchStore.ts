import {
  WorkbenchAssignment,
  WorkbenchAssignmentId,
  WorkbenchOperationError,
  WorkbenchProject,
  WorkbenchProjectId,
  WorkbenchSnapshot,
  WorkbenchTicket,
  WorkbenchTicketId,
  ThreadId,
  ProjectId,
  type WorkbenchCreateAssignmentInput,
  type WorkbenchCreateProjectInput,
  type WorkbenchCreateTicketInput,
  type WorkbenchReplaceAssignmentInput,
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
const WorkbenchTicketRepositoryRow = Schema.Struct({
  ticketId: WorkbenchTicketId,
  repositoryProjectId: ProjectId,
  position: Schema.Number,
});
const FindT3ProjectInput = Schema.Struct({ linkedProjectId: ProjectId });
const FindProjectLinkInput = Schema.Struct({
  projectId: WorkbenchProjectId,
  linkedProjectId: ProjectId,
});
const FindThreadInput = Schema.Struct({ threadId: ThreadId });
const FindTicketInput = Schema.Struct({ ticketId: WorkbenchTicketId });
const NativeThreadRow = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
});
const WorkbenchTicketRow = Schema.Struct({
  id: WorkbenchTicketId,
  projectId: WorkbenchProjectId,
  title: WorkbenchTicket.fields.title,
  kind: WorkbenchTicket.fields.kind,
  markdown: WorkbenchTicket.fields.markdown,
  primaryT3ProjectId: ProjectId,
  status: WorkbenchTicket.fields.status,
  blocked: Schema.Number,
  createdAt: WorkbenchTicket.fields.createdAt,
  updatedAt: WorkbenchTicket.fields.updatedAt,
});

interface WorkbenchStoreShape {
  readonly getSnapshot: Effect.Effect<WorkbenchSnapshot, WorkbenchOperationError>;
  readonly createProject: (
    input: WorkbenchCreateProjectInput,
  ) => Effect.Effect<WorkbenchProject, WorkbenchOperationError>;
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
  const listTicketRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchTicketRow,
    execute: () => sql`
      SELECT
        ticket_id AS "id",
        workbench_project_id AS "projectId",
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

  const getSnapshot = Effect.fn("WorkbenchStore.getSnapshot")(function* () {
    const [projectRows, linkRows, ticketRows, ticketRepositoryRows, assignments] =
      yield* Effect.all([
        listProjectRows(),
        listProjectLinkRows(),
        listTicketRows(),
        listTicketRepositoryRows(),
        listAssignmentRows(),
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
    return WorkbenchSnapshot.make({
      projects: projectRows.map((project) => ({
        ...project,
        linkedProjectIds: linksByProject.get(project.id) ?? [],
      })),
      tickets: ticketRows.map((ticket) => ({
        ...ticket,
        repositoryProjectIds: repositoriesByTicket.get(ticket.id) ?? [ticket.primaryT3ProjectId],
        blocked: ticket.blocked === 1,
      })),
      assignments,
    });
  }, Effect.mapError(persistenceError));

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
          const repositoryScopeChanged =
            primaryT3ProjectId !== current.value.primaryT3ProjectId ||
            repositoryProjectIds.length !== currentRepositoryProjectIds.length ||
            repositoryProjectIds.some(
              (repositoryProjectId) => !currentRepositoryProjectIds.includes(repositoryProjectId),
            );
          if (repositoryScopeChanged && Option.isSome(existingAssignment)) {
            return yield* new WorkbenchOperationError({
              code: "ticket_repository_scope_locked",
              message: "Ticket repository scope cannot change after Agent work has started.",
            });
          }
          yield* sql`
            UPDATE workbench_tickets
            SET
              title = ${input.title},
              kind = ${input.kind ?? current.value.kind},
              markdown = ${input.markdown},
              primary_t3_project_id = ${primaryT3ProjectId},
              status = ${input.status},
              blocked = ${input.blocked ? 1 : 0},
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
            title: input.title,
            kind: input.kind ?? current.value.kind,
            markdown: input.markdown,
            primaryT3ProjectId,
            repositoryProjectIds,
            status: input.status,
            blocked: input.blocked,
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
          const ticket = yield* requireAssignableThread({
            ticketId: input.ticketId,
            threadId: input.threadId,
          });
          yield* sql`
            INSERT INTO workbench_assignments (assignment_id, ticket_id, thread_id, created_at)
            VALUES (${input.id}, ${input.ticketId}, ${input.threadId}, ${input.createdAt})
          `;
          if (ticket.status === "todo") {
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
    createTicket,
    updateTicket,
    createAssignment,
    replaceAssignment,
  });
});

export const WorkbenchStoreLive = Layer.effect(
  WorkbenchStore,
  ensureWorkbenchSchema.pipe(Effect.flatMap(() => makeWorkbenchStore)),
);
