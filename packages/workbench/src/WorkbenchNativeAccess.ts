import { RunId, ProjectId, ThreadId, WorkbenchOperationError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

/** Native T3 projection capabilities required by Workbench domain operations. */
export class WorkbenchNativeAccess extends Context.Service<
  WorkbenchNativeAccess,
  {
    /** Read through the caller's SQL transaction to establish a durable execution boundary. */
    readonly executionSequence: Effect.Effect<number, WorkbenchOperationError>;
    readonly startedExecutionRunIds: Effect.Effect<ReadonlyArray<RunId>, WorkbenchOperationError>;
    readonly findProject: (
      projectId: ProjectId,
    ) => Effect.Effect<
      Option.Option<{ readonly id: ProjectId; readonly workspaceRoot: string }>,
      WorkbenchOperationError
    >;
    /** Validate the captured native root without re-reading the Project during Git I/O. */
    readonly isRepository: (
      workspaceRoot: string,
    ) => Effect.Effect<boolean, WorkbenchOperationError>;
    /** Pending/active native work must keep the planning policy record until provider startup settles. */
    readonly hasPendingThreadWork: (
      threadId: ThreadId,
    ) => Effect.Effect<boolean, WorkbenchOperationError>;
    readonly findThread: (threadId: ThreadId) => Effect.Effect<
      Option.Option<{
        readonly id: ThreadId;
        readonly projectId: ProjectId;
        readonly worktreePath?: string | null;
        readonly branch?: string | null;
        readonly archivedAt?: string | null;
      }>,
      WorkbenchOperationError
    >;
    /** Whether a non-deleted native Thread still owns the given worktree path. */
    readonly hasThreadAtWorktreePath: (
      worktreePath: string,
    ) => Effect.Effect<boolean, WorkbenchOperationError>;
    /** The Thread's run whose provider turn is being started, if any. */
    readonly findStartingRunId: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<RunId>, WorkbenchOperationError>;
    /** Position of the Thread's latest completed compaction or context handoff, or 0. */
    readonly contextMarker: (threadId: ThreadId) => Effect.Effect<number, WorkbenchOperationError>;
    /** The user message text that started a run. */
    readonly findRunMessageText: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId;
    }) => Effect.Effect<Option.Option<string>, WorkbenchOperationError>;
  }
>()("@t3tools/workbench/WorkbenchNativeAccess") {}
