import type {
  GitCommandError,
  ProjectId,
  ThreadId,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsListRefsInput,
  VcsListRefsResult,
  VcsRemoveWorktreeInput,
  WorkbenchOperationError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

/** Environment capabilities needed to manage a Ticket's native worktrees. */
export class TicketWorkspaceHost extends Context.Service<
  TicketWorkspaceHost,
  {
    readonly worktreesDir: string;
    readonly git: {
      readonly listRefs: (
        input: VcsListRefsInput,
      ) => Effect.Effect<VcsListRefsResult, GitCommandError>;
      readonly createWorktree: (
        input: VcsCreateWorktreeInput,
      ) => Effect.Effect<VcsCreateWorktreeResult, GitCommandError>;
      readonly removeWorktree: (
        input: VcsRemoveWorktreeInput,
      ) => Effect.Effect<void, GitCommandError>;
    };
    readonly projections: {
      readonly getProjectShellById: (
        projectId: ProjectId,
      ) => Effect.Effect<
        Option.Option<{ readonly title: string; readonly workspaceRoot: string }>,
        WorkbenchOperationError
      >;
      readonly getThreadShellById: (
        threadId: ThreadId,
      ) => Effect.Effect<Option.Option<{ readonly id: ThreadId }>, WorkbenchOperationError>;
    };
  }
>()("@t3tools/workbench/TicketWorkspaceHost") {}
