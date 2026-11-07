import type { ProjectId, ThreadId, WorkbenchOperationError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/** Where a native Thread runs. */
export interface ThreadBinding {
  readonly projectId: ProjectId;
  readonly branch: string | null;
  readonly worktreePath: string | null;
}

/** Native Thread commands that linking a Thread from elsewhere needs. */
export class ThreadLinkHost extends Context.Service<
  ThreadLinkHost,
  {
    /** Forks the Thread's latest stable point into a new Thread with the same binding. */
    readonly forkThread: (
      sourceThreadId: ThreadId,
    ) => Effect.Effect<ThreadId, WorkbenchOperationError>;
    /** Moves a Thread that has no messages or runs yet, if it is still bound to `from`. */
    readonly rebindThread: (input: {
      readonly threadId: ThreadId;
      readonly from: ThreadBinding;
      readonly to: ThreadBinding;
    }) => Effect.Effect<void, WorkbenchOperationError>;
    readonly deleteThread: (threadId: ThreadId) => Effect.Effect<void, WorkbenchOperationError>;
  }
>()("@t3tools/workbench/ThreadLinkHost") {}
