import type {
  ModelSelection,
  ProjectId,
  ThreadId,
  WorkbenchCreateTicketInput,
  WorkbenchTicket,
  WorkbenchOperationError,
  WorkbenchTicketDraft,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/** Native conversation and ticket-creation effects owned by the environment. */
export class TicketDraftHost extends Context.Service<
  TicketDraftHost,
  {
    readonly validatePlanningModel: (
      model: ModelSelection,
    ) => Effect.Effect<void, WorkbenchOperationError>;
    readonly createThread: (
      draft: WorkbenchTicketDraft,
    ) => Effect.Effect<void, WorkbenchOperationError>;
    readonly requireIdle: (threadId: ThreadId) => Effect.Effect<void, WorkbenchOperationError>;
    readonly requireDiscardable: (
      draft: WorkbenchTicketDraft,
    ) => Effect.Effect<void, WorkbenchOperationError>;
    readonly bindThread: (input: {
      readonly draft: WorkbenchTicketDraft;
      readonly projectId: ProjectId;
      readonly branch: string | null;
      readonly worktreePath: string | null;
    }) => Effect.Effect<void, WorkbenchOperationError>;
    readonly startExecutionMode: (
      draft: WorkbenchTicketDraft,
    ) => Effect.Effect<void, WorkbenchOperationError>;
    readonly deleteThread: (
      draft: WorkbenchTicketDraft,
    ) => Effect.Effect<void, WorkbenchOperationError>;
    readonly createTicket: (
      input: WorkbenchCreateTicketInput & { readonly updatedByThreadId?: ThreadId | null },
    ) => Effect.Effect<WorkbenchTicket, WorkbenchOperationError>;
  }
>()("@t3tools/workbench/TicketDraftHost") {}
