import {
  WorkbenchAssignment,
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
const FindT3ProjectInput = Schema.Struct({ linkedProjectId: ProjectId });
const FindProjectLinkInput = Schema.Struct({
  projectId: WorkbenchProjectId,
  linkedProjectId: ProjectId,
});
const FindThreadInput = Schema.Struct({ threadId: ThreadId });
const NativeThreadRow = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
});
const WorkbenchTicketRow = Schema.Struct({
  id: WorkbenchTicketId,
  projectId: WorkbenchProjectId,
  title: WorkbenchTicket.fields.title,
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
  const listAssignmentRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorkbenchAssignment,
    execute: () => sql`
      SELECT
        assignment_id AS "id",
        ticket_id AS "ticketId",
        thread_id AS "threadId",
        created_at AS "createdAt"
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
  const findAssignmentByTicket = SqlSchema.findOneOption({
    Request: Schema.Struct({ ticketId: WorkbenchTicketId }),
    Result: WorkbenchAssignment,
    execute: ({ ticketId }) => sql`
      SELECT
        assignment_id AS "id",
        ticket_id AS "ticketId",
        thread_id AS "threadId",
        created_at AS "createdAt"
      FROM workbench_assignments
      WHERE ticket_id = ${ticketId}
    `,
  });
  const replaceAssignmentRow = SqlSchema.findOneOption({
    Request: Schema.Struct({
      ticketId: WorkbenchTicketId,
      previousThreadId: ThreadId,
      threadId: ThreadId,
      replacedAt: WorkbenchAssignment.fields.createdAt,
    }),
    Result: WorkbenchAssignment,
    execute: ({ ticketId, previousThreadId, threadId, replacedAt }) => sql`
      UPDATE workbench_assignments
      SET thread_id = ${threadId}, created_at = ${replacedAt}
      WHERE ticket_id = ${ticketId}
        AND thread_id = ${previousThreadId}
      RETURNING
        assignment_id AS "id",
        ticket_id AS "ticketId",
        thread_id AS "threadId",
        created_at AS "createdAt"
    `,
  });

  const getSnapshot = Effect.fn("WorkbenchStore.getSnapshot")(function* () {
    const [projectRows, linkRows, ticketRows, assignments] = yield* Effect.all([
      listProjectRows(),
      listProjectLinkRows(),
      listTicketRows(),
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
    return WorkbenchSnapshot.make({
      projects: projectRows.map((project) => ({
        ...project,
        linkedProjectIds: linksByProject.get(project.id) ?? [],
      })),
      tickets: ticketRows.map((ticket) => ({ ...ticket, blocked: ticket.blocked === 1 })),
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
    const link = yield* findProjectLink({
      projectId: input.projectId,
      linkedProjectId: input.primaryT3ProjectId,
    }).pipe(Effect.mapError(persistenceError));
    if (Option.isNone(link)) {
      return yield* new WorkbenchOperationError({
        code: "primary_project_not_linked",
        message: "The Ticket repository is not linked to its Workbench Workspace.",
      });
    }

    yield* sql`
      INSERT INTO workbench_tickets (
        ticket_id,
        workbench_project_id,
        title,
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
        ${input.markdown},
        ${input.primaryT3ProjectId},
        'todo',
        0,
        ${input.createdAt},
        ${input.createdAt}
      )
    `.pipe(Effect.mapError(persistenceError));

    return WorkbenchTicket.make({
      ...input,
      status: "todo",
      blocked: false,
      updatedAt: input.createdAt,
    });
  });

  const updateTicket: WorkbenchStoreShape["updateTicket"] = Effect.fn(
    "WorkbenchStore.updateTicket",
  )(function* (input) {
    const current = yield* findTicket({ id: input.id }).pipe(Effect.mapError(persistenceError));
    if (Option.isNone(current)) {
      return yield* new WorkbenchOperationError({
        code: "ticket_not_found",
        message: "The Workbench Ticket does not exist.",
      });
    }
    yield* sql`
      UPDATE workbench_tickets
      SET
        title = ${input.title},
        markdown = ${input.markdown},
        status = ${input.status},
        blocked = ${input.blocked ? 1 : 0},
        updated_at = ${input.updatedAt}
      WHERE ticket_id = ${input.id}
    `.pipe(Effect.mapError(persistenceError));
    return WorkbenchTicket.make({
      ...current.value,
      ...input,
    });
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
    const existingAssignment = yield* findAssignmentByTicket({ ticketId: input.ticketId }).pipe(
      Effect.mapError(persistenceError),
    );
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
    yield* sql
      .withTransaction(
        Effect.gen(function* () {
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
        }),
      )
      .pipe(Effect.mapError(persistenceError));
    return WorkbenchAssignment.make(input);
  });

  const replaceAssignment: WorkbenchStoreShape["replaceAssignment"] = Effect.fn(
    "WorkbenchStore.replaceAssignment",
  )(function* (input) {
    const assignment = yield* findAssignmentByTicket({ ticketId: input.ticketId }).pipe(
      Effect.mapError(persistenceError),
    );
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
    const replaced = yield* replaceAssignmentRow(input).pipe(Effect.mapError(persistenceError));
    if (Option.isNone(replaced)) {
      return yield* new WorkbenchOperationError({
        code: "assignment_changed",
        message: "The Workbench Assignment changed before it could be replaced.",
      });
    }
    return replaced.value;
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
