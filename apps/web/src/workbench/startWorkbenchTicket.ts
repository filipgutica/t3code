import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { CreateThreadInput, DeleteThreadInput } from "@t3tools/client-runtime/operations";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ModelSelection,
  ThreadId,
  WorkbenchAssignment,
  WorkbenchAssignmentId,
  WorkbenchCreateAssignmentInput,
  WorkbenchReplaceAssignmentInput,
  WorkbenchPrepareTicketWorkspaceInput,
  WorkbenchTicket,
  WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import { DEFAULT_RUNTIME_MODE } from "@t3tools/contracts";

import type { ComposerThreadTarget } from "../composerDraftStore";
import type { ReviewCommentContext } from "../reviewCommentContext";
import { DEFAULT_INTERACTION_MODE } from "../types";
import { buildTicketReviewComment, resolveWorkbenchTicketThreadTarget } from "./workbench.logic";

type CommandResult = AtomCommandResult<unknown, unknown>;
type PrepareWorkspaceResult = AtomCommandResult<WorkbenchTicketWorkspace, unknown>;

type EnvironmentCommandInput<Input> = {
  readonly environmentId: EnvironmentId;
  readonly input: Input;
};

interface StartWorkbenchTicketInput {
  readonly environmentId: EnvironmentId;
  readonly ticket: WorkbenchTicket;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly assignment: WorkbenchAssignment | undefined;
  readonly existingThreadIds: ReadonlySet<ThreadId>;
  readonly threadLookupReady: boolean;
}

/**
 * Controls how a Ticket start is coordinated. A normal start opens an
 * existing active Thread when one is assigned, then creates a replacement
 * when its native Thread is missing. Every new Thread opens with its Ticket
 * context attached and waits for the user to send the first turn.
 */
export interface StartWorkbenchTicketOptions {
  readonly mode?: "additional" | "replace";
  /** Assignment selected by the caller's rendered action. */
  readonly assignment?: WorkbenchAssignment;
  readonly modelSelection?: ModelSelection;
  readonly previousThreadId?: ThreadId;
}

interface StartWorkbenchTicketDependencies {
  readonly prepareTicketWorkspace: (
    input: EnvironmentCommandInput<WorkbenchPrepareTicketWorkspaceInput>,
  ) => Promise<PrepareWorkspaceResult>;
  readonly createThread: (
    input: EnvironmentCommandInput<CreateThreadInput>,
  ) => Promise<CommandResult>;
  readonly createAssignment: (
    input: EnvironmentCommandInput<WorkbenchCreateAssignmentInput>,
  ) => Promise<CommandResult>;
  readonly replaceAssignment: (
    input: EnvironmentCommandInput<WorkbenchReplaceAssignmentInput>,
  ) => Promise<CommandResult>;
  readonly deleteThread: (
    input: EnvironmentCommandInput<DeleteThreadInput>,
  ) => Promise<CommandResult>;
  readonly addReviewComment: (
    threadRef: ComposerThreadTarget,
    comment: ReviewCommentContext,
  ) => void;
  readonly openThread: (threadId: ThreadId) => Promise<void>;
  readonly resolveModelSelection: (project: EnvironmentProject) => ModelSelection | null;
  readonly makeThreadId: () => ThreadId;
  readonly makeAssignmentId: () => WorkbenchAssignmentId;
  readonly now: () => string;
}

export type StartWorkbenchTicketResult =
  | { readonly state: "opened"; readonly threadId: ThreadId }
  | { readonly state: "navigation-failed"; readonly cause: unknown }
  | { readonly state: "project-unavailable" }
  | { readonly state: "provider-unavailable" }
  | { readonly state: "thread-status-unavailable" }
  | {
      readonly state: "failed";
      readonly stage: "workspace" | "thread" | "assignment";
      readonly failure: Extract<CommandResult, { readonly _tag: "Failure" }>;
      readonly cleanupFailure?: Extract<CommandResult, { readonly _tag: "Failure" }>;
    };

export async function coordinateWorkbenchTicketStart(
  input: StartWorkbenchTicketInput,
  dependencies: StartWorkbenchTicketDependencies,
  options: StartWorkbenchTicketOptions = {},
): Promise<StartWorkbenchTicketResult> {
  if (options.mode === undefined) {
    const target = resolveWorkbenchTicketThreadTarget(
      input.ticket,
      input.projects,
      input.assignment,
      input.existingThreadIds,
      input.threadLookupReady,
    );
    if (target.state === "open") {
      try {
        await dependencies.openThread(target.threadId);
      } catch (cause) {
        return { state: "navigation-failed", cause };
      }
      return { state: "opened", threadId: target.threadId };
    }
    if (target.state === "project-unavailable") return { state: "project-unavailable" };
    if (target.state === "thread-status-unavailable") {
      return { state: "thread-status-unavailable" };
    }
  }

  const project = input.projects.find(
    (candidate) => candidate.id === input.ticket.primaryT3ProjectId,
  );
  if (!project) return { state: "project-unavailable" };
  const modelSelection = options.modelSelection ?? dependencies.resolveModelSelection(project);
  if (modelSelection === null) return { state: "provider-unavailable" };

  const threadId = dependencies.makeThreadId();
  const assignmentId = dependencies.makeAssignmentId();
  const createdAt = dependencies.now();
  const workspaceResult = await dependencies.prepareTicketWorkspace({
    environmentId: input.environmentId,
    input: { ticketId: input.ticket.id, requestedAt: createdAt },
  });
  if (workspaceResult._tag === "Failure") {
    return { state: "failed", stage: "workspace", failure: workspaceResult };
  }
  const primaryWorkspace = workspaceResult.value.repositories.find(
    (repository) => repository.isPrimary && repository.status === "ready",
  );
  if (!primaryWorkspace) {
    throw new Error("The prepared Ticket Workspace has no ready primary repository.");
  }
  const threadResult = await dependencies.createThread({
    environmentId: input.environmentId,
    input: {
      threadId,
      projectId: project.id,
      title: input.ticket.title,
      modelSelection,
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: DEFAULT_INTERACTION_MODE,
      branch: primaryWorkspace.branchName,
      worktreePath: primaryWorkspace.worktreePath,
      createdAt,
    },
  });
  if (threadResult._tag === "Failure") {
    return { state: "failed", stage: "thread", failure: threadResult };
  }

  const previousThreadId = options.previousThreadId ?? input.assignment?.threadId;
  const assignmentResult =
    options.mode !== "additional" && previousThreadId
      ? await dependencies.replaceAssignment({
          environmentId: input.environmentId,
          input: {
            id: assignmentId,
            ticketId: input.ticket.id,
            previousThreadId,
            threadId,
            replacedAt: createdAt,
          },
        })
      : await dependencies.createAssignment({
          environmentId: input.environmentId,
          input: {
            id: assignmentId,
            ticketId: input.ticket.id,
            threadId,
            createdAt,
          },
        });
  if (assignmentResult._tag === "Failure") {
    const cleanupResult = await dependencies.deleteThread({
      environmentId: input.environmentId,
      input: { threadId },
    });
    return {
      state: "failed",
      stage: "assignment",
      failure: assignmentResult,
      ...(cleanupResult._tag === "Failure" ? { cleanupFailure: cleanupResult } : {}),
    };
  }

  const preparedPaths = new Map(
    workspaceResult.value.repositories
      .filter((repository) => repository.status === "ready")
      .map((repository) => [repository.projectId, repository.worktreePath]),
  );
  const ticketContext = buildTicketReviewComment(
    input.ticket,
    input.projects.map((repository) => ({
      ...repository,
      workspaceRoot: preparedPaths.get(repository.id) ?? repository.workspaceRoot,
    })),
  );
  dependencies.addReviewComment(scopeThreadRef(input.environmentId, threadId), ticketContext);

  try {
    await dependencies.openThread(threadId);
  } catch (cause) {
    return { state: "navigation-failed", cause };
  }
  return { state: "opened", threadId };
}
