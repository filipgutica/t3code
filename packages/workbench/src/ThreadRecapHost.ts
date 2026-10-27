import type { RunId, ThreadId, WorkbenchOperationError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/** The application reads the run's native messages and supplies its configured text writer. */
export class ThreadRecapHost extends Context.Service<
  ThreadRecapHost,
  {
    readonly generate: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId;
    }) => Effect.Effect<string, WorkbenchOperationError>;
  }
>()("@t3tools/workbench/ThreadRecapHost") {}
