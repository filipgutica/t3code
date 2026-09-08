import type {
  GitCommandError,
  GitManagerServiceError,
  ProjectId,
  ThreadId,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsListRefsInput,
  VcsListRefsResult,
  VcsStatusInput,
  VcsStatusLocalResult,
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
    readonly generateBranchName: (input: {
      readonly cwd: string;
      readonly title: string;
      readonly description: string;
    }) => Effect.Effect<string, WorkbenchOperationError>;
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
      readonly localStatus: (
        input: VcsStatusInput,
      ) => Effect.Effect<VcsStatusLocalResult, GitManagerServiceError>;
      readonly invalidateLocalStatus: (cwd: string) => Effect.Effect<void, never>;
    };
    readonly projections: {
      readonly getProjectShellById: (
        projectId: ProjectId,
      ) => Effect.Effect<
        Option.Option<{ readonly title: string; readonly workspaceRoot: string }>,
        WorkbenchOperationError
      >;
      readonly getThreadShellById: (threadId: ThreadId) => Effect.Effect<
        Option.Option<{
          readonly id: ThreadId;
          readonly worktreePath: string | null;
        }>,
        WorkbenchOperationError
      >;
    };
  }
>()("@t3tools/workbench/TicketWorkspaceHost") {}
