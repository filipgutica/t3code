import { ProjectId, ThreadId, WorkbenchOperationError } from "@t3tools/contracts";
import { WorkbenchNativeAccess } from "@t3tools/workbench/WorkbenchNativeAccess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";

const NativeProjectRow = Schema.Struct({ id: ProjectId, workspaceRoot: Schema.String });
const NativeThreadRow = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
});

const persistenceError = (_cause: unknown) =>
  new WorkbenchOperationError({
    code: "persistence_failed",
    message: "Workbench data could not be saved or loaded.",
  });

const makeWorkbenchNativeAccess = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const git = yield* GitWorkflowService.GitWorkflowService;
  const findProjectRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ projectId: ProjectId }),
    Result: NativeProjectRow,
    execute: ({ projectId }) => sql`
      SELECT
        project_id AS "id",
        workspace_root AS "workspaceRoot"
      FROM projection_projects
      WHERE project_id = ${projectId}
        AND deleted_at IS NULL
    `,
  });
  const findThreadRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ threadId: ThreadId }),
    Result: NativeThreadRow,
    execute: ({ threadId }) => sql`
      SELECT thread_id AS "id", project_id AS "projectId"
      FROM projection_threads
      WHERE thread_id = ${threadId}
        AND deleted_at IS NULL
    `,
  });
  const findThreadAtWorktreePathRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ worktreePath: Schema.String }),
    Result: Schema.Struct({ id: ThreadId }),
    execute: ({ worktreePath }) => sql`
      SELECT thread_id AS "id"
      FROM projection_threads
      WHERE worktree_path = ${worktreePath}
        AND deleted_at IS NULL
      LIMIT 1
    `,
  });

  const findProject = Effect.fn("WorkbenchNativeAccess.findProject")(function* (
    projectId: ProjectId,
  ) {
    return yield* findProjectRow({ projectId }).pipe(
      Effect.map(Option.map(({ id }) => ({ id }))),
      Effect.mapError(persistenceError),
    );
  });
  const isProjectRepository = Effect.fn("WorkbenchNativeAccess.isProjectRepository")(function* (
    projectId: ProjectId,
  ) {
    const project = yield* findProjectRow({ projectId }).pipe(Effect.mapError(persistenceError));
    if (Option.isNone(project)) return false;
    return yield* git
      .isRepository(project.value.workspaceRoot)
      .pipe(Effect.mapError(persistenceError));
  });
  const findThread = Effect.fn("WorkbenchNativeAccess.findThread")(function* (threadId: ThreadId) {
    return yield* findThreadRow({ threadId }).pipe(Effect.mapError(persistenceError));
  });
  const hasThreadAtWorktreePath = Effect.fn("WorkbenchNativeAccess.hasThreadAtWorktreePath")(
    function* (worktreePath: string) {
      return yield* findThreadAtWorktreePathRow({ worktreePath }).pipe(
        Effect.map(Option.isSome),
        Effect.mapError(persistenceError),
      );
    },
  );

  return WorkbenchNativeAccess.of({
    findProject,
    isProjectRepository,
    findThread,
    hasThreadAtWorktreePath,
  });
});

export const WorkbenchNativeAccessLive = Layer.effect(
  WorkbenchNativeAccess,
  makeWorkbenchNativeAccess,
);
