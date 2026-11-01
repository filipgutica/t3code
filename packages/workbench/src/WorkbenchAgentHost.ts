import type {
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  WorkbenchOperationError,
} from "@t3tools/contracts";
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
    /** Creates an idle native Thread in a Ticket worktree, with the model of the Thread that asked. */
    readonly createThread: (input: {
      readonly callerThreadId: ThreadId;
      readonly projectId: ProjectId;
      readonly title: string;
      readonly branch: string;
      readonly worktreePath: string;
      readonly runtimeMode: RuntimeMode;
      readonly interactionMode: ProviderInteractionMode;
    }) => Effect.Effect<ThreadId, WorkbenchOperationError>;
    readonly deleteThread: (threadId: ThreadId) => Effect.Effect<void, WorkbenchOperationError>;
    readonly sendMessage: (input: {
      readonly threadId: ThreadId;
      readonly senderThreadId: ThreadId;
      readonly text: string;
    }) => Effect.Effect<void, WorkbenchOperationError>;
  }
>()("@t3tools/workbench/WorkbenchAgentHost") {}
