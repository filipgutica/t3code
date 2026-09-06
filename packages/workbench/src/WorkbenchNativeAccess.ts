import { ProjectId, ThreadId, WorkbenchOperationError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

/** Native T3 projection capabilities required by Workbench domain operations. */
export class WorkbenchNativeAccess extends Context.Service<
  WorkbenchNativeAccess,
  {
    readonly findProject: (
      projectId: ProjectId,
    ) => Effect.Effect<Option.Option<{ readonly id: ProjectId }>, WorkbenchOperationError>;
    readonly findThread: (
      threadId: ThreadId,
    ) => Effect.Effect<
      Option.Option<{ readonly id: ThreadId; readonly projectId: ProjectId }>,
      WorkbenchOperationError
    >;
  }
>()("@t3tools/workbench/WorkbenchNativeAccess") {}
