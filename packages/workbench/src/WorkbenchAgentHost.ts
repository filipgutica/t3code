import type { ProjectId, ThreadId, WorkbenchOperationError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/** Environment capabilities the agent-facing Workbench operations read. */
export class WorkbenchAgentHost extends Context.Service<
  WorkbenchAgentHost,
  {
    /** Creates the owner's artifacts folder on first use and returns its absolute path. */
    readonly ensureArtifactsDir: (
      ownerId: string,
    ) => Effect.Effect<string, WorkbenchOperationError>;
    readonly describeProjects: (
      projectIds: ReadonlyArray<ProjectId>,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly id: ProjectId; readonly title: string }>,
      WorkbenchOperationError
    >;
    readonly describeThreads: (threadIds: ReadonlyArray<ThreadId>) => Effect.Effect<
      ReadonlyArray<{
        readonly id: ThreadId;
        readonly title: string;
        readonly pullRequests: ReadonlyArray<{
          readonly url: string;
          readonly state: string | null;
        }>;
      }>,
      WorkbenchOperationError
    >;
  }
>()("@t3tools/workbench/WorkbenchAgentHost") {}
