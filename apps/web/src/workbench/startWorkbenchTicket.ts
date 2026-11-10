import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  CreateThreadInput,
  DeleteThreadInput,
  StartThreadTurnInput,
} from "@t3tools/client-runtime/operations";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  CommandId,
  MessageId,
  workbenchHostRepositoryProjectIds,
  type EnvironmentId,
  type ModelSelection,
  type RuntimeMode,
  type ProjectId,
  type ScopedThreadRef,
  type ThreadId,
  type WorkbenchAssignment,
  type WorkbenchAssignmentId,
  type WorkbenchCreateAssignmentInput,
  type WorkbenchProject,
  type WorkbenchReplaceAssignmentInput,
  type WorkbenchPrepareTicketWorkspaceInput,
  type WorkbenchTicket,
  type WorkbenchTicketContext,
  type WorkbenchTicketWorkspace,
  type WorkbenchUpdateTicketInput,
} from "@t3tools/contracts";

import { DEFAULT_INTERACTION_MODE } from "../types";
import {
  resolveWorkbenchTicketThreadTarget,
  type WorkbenchThreadLookupState,
} from "./workbench.logic";
import {
  isWorkbenchRepositoryScopeEqual,
  resolveWorkbenchThreadRepository,
  type WorkbenchRepositoryScope,
} from "./workbenchRepositoryScope";

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
  /** Whether the assigned Thread's own environment can confirm it is gone. */
  readonly threadLookupState: WorkbenchThreadLookupState;
  /** The Ticket's Board; its repositories on other machines get no Thread or worktree here. */
  readonly board: Pick<WorkbenchProject, "remoteProjects"> | undefined;
}

export type WorkbenchTicketStartStage =
  | "checking-thread"
  | "saving-repositories"
  | "preparing-workspace"
  | "creating-thread"
  | "linking-thread"
  | "reading-context"
  | "launching-thread"
  | "opening-thread";

const WORKBENCH_TICKET_START_STAGE_LABELS: Record<WorkbenchTicketStartStage, string> = {
  "checking-thread": "Checking for an existing Thread…",
  "saving-repositories": "Saving repositories…",
  "preparing-workspace": "Preparing repositories…",
  "creating-thread": "Creating Thread…",
  "linking-thread": "Linking Thread to Ticket…",
  "reading-context": "Reading the Ticket…",
  "launching-thread": "Starting Thread on the other machine…",
  "opening-thread": "Opening Thread…",
};

/** Resolve the visible progress label encoded in the page's pending action. */
export function getWorkbenchTicketStartProgressLabel(
  action: string | null,
  ticketId: WorkbenchTicket["id"],
): string | null {
  if (action === null) return null;
  const prefix = `start:${ticketId}:`;
  if (!action.startsWith(prefix)) return null;
  const stage = action.slice(prefix.length) as WorkbenchTicketStartStage;
  return WORKBENCH_TICKET_START_STAGE_LABELS[stage] ?? "Starting Thread…";
}

export function isWorkbenchTicketStartPending(
  action: string | null,
  ticketId: WorkbenchTicket["id"],
): boolean {
  return getWorkbenchTicketStartProgressLabel(action, ticketId) !== null;
}

/**
 * Controls how a Ticket start is coordinated. A normal start opens an
 * existing active Thread when one is assigned, then creates a replacement
 * when its native Thread is missing. Every new Thread opens and waits for the
 * user to send the first turn; the server tells it about its Ticket.
 */
export interface StartWorkbenchTicketOptions {
  readonly mode?: "additional" | "replace";
  /** Assignment selected by the caller's rendered action. */
  readonly assignment?: WorkbenchAssignment;
  readonly modelSelection?: ModelSelection;
  readonly previousThreadId?: ThreadId;
  readonly repositoryScope?: WorkbenchRepositoryScope;
  /** The repository the new Thread works in; see `resolveWorkbenchThreadRepository`. */
  readonly repositoryProjectId?: ProjectId;
  /** Starts the Thread in a repository on another machine instead of on the Board host. */
  readonly remote?: WorkbenchRemoteThreadStart;
}

/**
 * A Thread in a Board repository on another machine, which runs a stock T3 server: the host
 * prepares nothing there, so the launch carries the worktree and the first turn's instruction.
 */
export interface WorkbenchRemoteThreadStart {
  /** The repository's native Project, on the machine that runs the Thread. */
  readonly project: Pick<EnvironmentProject, "id" | "environmentId" | "workspaceRoot">;
  readonly baseRef: string;
  readonly branch: string;
  readonly startFromOrigin: boolean;
  /** Sent after the Ticket context, since the launch starts a run immediately. */
  readonly instruction: string;
  /** A not-started Assignment to relaunch with its own Thread and command ids. */
  readonly retry?: WorkbenchAssignment;
}

interface StartWorkbenchTicketDependencies {
  readonly updateTicket: (
    input: EnvironmentCommandInput<WorkbenchUpdateTicketInput>,
  ) => Promise<AtomCommandResult<WorkbenchTicket, unknown>>;
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
  /** The Board host's Ticket context; `audience` asks for the text a remote Thread gets. */
  readonly readTicketContext: (
    input: EnvironmentCommandInput<{
      readonly ticketId: WorkbenchTicket["id"];
      readonly audience: "remote-thread";
    }>,
  ) => Promise<AtomCommandResult<WorkbenchTicketContext | null, unknown>>;
  /** Native `orchestration.launchThread` on the Thread's own environment. */
  readonly launchThread: (
    input: EnvironmentCommandInput<StartThreadTurnInput>,
  ) => Promise<CommandResult>;
  readonly waitForThread: (threadRef: ScopedThreadRef) => Promise<void>;
  readonly openThread: (threadId: ThreadId, environmentId: EnvironmentId) => Promise<void>;
  readonly resolveModelSelection: (project: EnvironmentProject) => ModelSelection | null;
  /** From the settings of the Project's own environment. */
  readonly resolveRuntimeMode: (
    project: Pick<EnvironmentProject, "id" | "environmentId">,
  ) => RuntimeMode;
  readonly makeThreadId: () => ThreadId;
  readonly makeAssignmentId: () => WorkbenchAssignmentId;
  readonly now: () => string;
  readonly onStage?: (stage: WorkbenchTicketStartStage) => void;
}

export type StartWorkbenchTicketResult =
  | { readonly state: "opened"; readonly threadId: ThreadId }
  | { readonly state: "navigation-failed"; readonly cause: unknown }
  // These carry the saved Ticket, so the caller can review against its own repository save.
  | { readonly state: "project-unavailable"; readonly ticket: WorkbenchTicket }
  | { readonly state: "provider-unavailable"; readonly ticket: WorkbenchTicket }
  | { readonly state: "thread-status-unavailable" }
  /** The host predates remote Thread context, so its text would name tools the remote lacks. */
  | { readonly state: "host-outdated" }
  | { readonly state: "ticket-unavailable" }
  /**
   * The Assignment was written but its remote launch failed. Retry relaunches it, unless the
   * remote recorded the rejection, which every relaunch with the same command id repeats.
   */
  | {
      readonly state: "not-started" | "launch-rejected";
      readonly assignment: WorkbenchAssignment;
      readonly failure: Extract<CommandResult, { readonly _tag: "Failure" }>;
    }
  | {
      readonly state: "failed";
      readonly stage: "repositories" | "workspace" | "thread" | "assignment" | "context";
      readonly ticket?: WorkbenchTicket;
      readonly failure: Extract<CommandResult, { readonly _tag: "Failure" }>;
      readonly cleanupFailure?: Extract<CommandResult, { readonly _tag: "Failure" }>;
    };

const openExistingWorkbenchThread = async ({
  input,
  dependencies,
  mode,
}: {
  input: StartWorkbenchTicketInput;
  dependencies: StartWorkbenchTicketDependencies;
  mode: StartWorkbenchTicketOptions["mode"];
}): Promise<StartWorkbenchTicketResult | null> => {
  if (mode === "additional") return null;
  // The replaced Thread's machine may have gone offline since the dialog opened.
  if (mode === "replace") {
    return input.threadLookupState === "ready" ? null : { state: "thread-status-unavailable" };
  }
  dependencies.onStage?.("checking-thread");
  const target = resolveWorkbenchTicketThreadTarget(
    input.assignment,
    input.existingThreadIds,
    input.threadLookupState,
  );
  if (target.state === "open") {
    dependencies.onStage?.("opening-thread");
    try {
      await dependencies.openThread(
        target.threadId,
        input.assignment?.environmentId ?? input.environmentId,
      );
    } catch (cause) {
      return { state: "navigation-failed", cause };
    }
    return { state: "opened", threadId: target.threadId };
  }
  if (target.state === "thread-status-unavailable") {
    return { state: "thread-status-unavailable" };
  }

  return null;
};

/**
 * The remote refuses a command id whose receipt it recorded as rejected. The launch error carries
 * the server's error chain as defects, which keep each server error's tag as their `name`.
 */
const isRecordedLaunchRejection = (
  failure: Extract<CommandResult, { readonly _tag: "Failure" }>,
) => {
  let current = squashAtomCommandFailure(failure);
  while (current instanceof Error) {
    if (current.name === "OrchestratorCommandPreviouslyRejectedError") return true;
    current = current.cause;
  }
  return false;
};

/** Ties a relaunch to the first attempt: the remote keeps a receipt per command id. */
const remoteLaunchCommandId = (assignmentId: WorkbenchAssignmentId) =>
  CommandId.make(`workbench-remote-start:${assignmentId}`);

/**
 * Writes the Assignment on the Board host, then launches the Thread on its own machine, so a
 * failed launch or a closed tab leaves a visible Not started row instead of an untracked agent.
 */
const startRemoteWorkbenchThread = async ({
  input,
  remote,
  modelSelection,
  dependencies,
}: {
  input: StartWorkbenchTicketInput;
  remote: WorkbenchRemoteThreadStart;
  modelSelection: ModelSelection;
  dependencies: StartWorkbenchTicketDependencies;
}): Promise<StartWorkbenchTicketResult> => {
  // A relaunch always goes out again, even when its Thread exists: the remote replays the steps it
  // accepted and finishes the rest, such as the first message after a failure past creation.
  const { retry, project } = remote;
  dependencies.onStage?.("reading-context");
  const context = await dependencies.readTicketContext({
    environmentId: input.environmentId,
    input: { ticketId: input.ticket.id, audience: "remote-thread" },
  });
  if (context._tag === "Failure") {
    return { state: "failed", stage: "context", ticket: input.ticket, failure: context };
  }
  if (context.value === null) return { state: "ticket-unavailable" };
  if (context.value.audience !== "remote-thread") return { state: "host-outdated" };

  const createdAt = dependencies.now();
  const assignment: WorkbenchAssignment = retry ?? {
    id: dependencies.makeAssignmentId(),
    ticketId: input.ticket.id,
    threadId: dependencies.makeThreadId(),
    environmentId: project.environmentId,
    projectId: project.id,
    createdAt,
    supersededAt: null,
  };
  if (!retry) {
    dependencies.onStage?.("linking-thread");
    const assignmentResult = await dependencies.createAssignment({
      environmentId: input.environmentId,
      input: {
        id: assignment.id,
        ticketId: assignment.ticketId,
        threadId: assignment.threadId,
        environmentId: project.environmentId,
        projectId: project.id,
        createdAt,
      },
    });
    if (assignmentResult._tag === "Failure") {
      return {
        state: "failed",
        stage: "assignment",
        ticket: input.ticket,
        failure: assignmentResult,
      };
    }
  }

  dependencies.onStage?.("launching-thread");
  const commandId = remoteLaunchCommandId(assignment.id);
  const modes = {
    modelSelection,
    runtimeMode: dependencies.resolveRuntimeMode(project),
    interactionMode: DEFAULT_INTERACTION_MODE,
  };
  const launchResult = await dependencies.launchThread({
    environmentId: project.environmentId,
    input: {
      commandId,
      threadId: assignment.threadId,
      message: {
        messageId: MessageId.make(`${commandId}:message`),
        role: "user",
        text: `${context.value.text}\n\n${remote.instruction}`,
        attachments: [],
      },
      ...modes,
      bootstrap: {
        createThread: {
          ...modes,
          projectId: project.id,
          title: input.ticket.title,
          branch: remote.branch,
          worktreePath: null,
          createdAt,
        },
        prepareWorktree: {
          projectCwd: project.workspaceRoot,
          baseBranch: remote.baseRef,
          branch: remote.branch,
          ...(remote.startFromOrigin ? { startFromOrigin: true } : {}),
        },
      },
      createdAt,
    },
  });
  if (launchResult._tag === "Failure") {
    return {
      state: isRecordedLaunchRejection(launchResult) ? "launch-rejected" : "not-started",
      assignment,
      failure: launchResult,
    };
  }
  return openStartedThread(
    dependencies,
    scopeThreadRef(project.environmentId, assignment.threadId),
  );
};

const getPreparedRepository = ({
  hostRepositoryProjectIds,
  workspace,
  projectId,
}: {
  hostRepositoryProjectIds: ReadonlyArray<ProjectId>;
  workspace: WorkbenchTicketWorkspace;
  projectId: ProjectId;
}) => {
  const readyCheckout = (id: ProjectId) =>
    workspace.repositories.find(
      (repository) => repository.projectId === id && repository.status === "ready",
    );
  const checkout = readyCheckout(projectId);
  if (!checkout || !hostRepositoryProjectIds.every(readyCheckout)) {
    throw new Error(
      "The prepared worktrees do not match the reviewed repositories. Review the repositories and try again.",
    );
  }
  return checkout;
};

const saveReviewedRepositoryScope = async ({
  input,
  dependencies,
  repositoryScope,
}: {
  input: StartWorkbenchTicketInput;
  dependencies: StartWorkbenchTicketDependencies;
  repositoryScope: WorkbenchRepositoryScope | undefined;
}) => {
  if (!repositoryScope || isWorkbenchRepositoryScopeEqual(input.ticket, repositoryScope)) {
    return { state: "saved", ticket: input.ticket } as const;
  }
  dependencies.onStage?.("saving-repositories");
  const saved = await dependencies.updateTicket({
    environmentId: input.environmentId,
    input: {
      id: input.ticket.id,
      expectedRevision: input.ticket.revision,
      ...repositoryScope,
      updatedAt: dependencies.now(),
    },
  });
  if (saved._tag === "Failure") {
    return { state: "failed", stage: "repositories", failure: saved } as const;
  }
  return { state: "saved", ticket: saved.value } as const;
};

export async function coordinateWorkbenchTicketStart(
  originalInput: StartWorkbenchTicketInput,
  dependencies: StartWorkbenchTicketDependencies,
  options: StartWorkbenchTicketOptions = {},
): Promise<StartWorkbenchTicketResult> {
  // A relaunch checks its own Thread on the remote before launching again.
  if (options.remote?.retry === undefined) {
    const existing = await openExistingWorkbenchThread({
      input: originalInput,
      dependencies,
      mode: options.mode,
    });
    if (existing !== null) return existing;
  }

  const saved = await saveReviewedRepositoryScope({
    input: originalInput,
    dependencies,
    repositoryScope: options.repositoryScope,
  });
  if (saved.state === "failed") return saved;
  const input = { ...originalInput, ticket: saved.ticket };
  if (!options.remote) return startHostWorkbenchThread({ input, dependencies, options });
  // The dialog picks a provider enabled on the remote; the host's defaults do not apply there.
  if (!options.modelSelection) return { state: "provider-unavailable", ticket: input.ticket };
  return startRemoteWorkbenchThread({
    input,
    remote: options.remote,
    modelSelection: options.modelSelection,
    dependencies,
  });
}

const startHostWorkbenchThread = async ({
  input,
  dependencies,
  options,
}: {
  input: StartWorkbenchTicketInput;
  dependencies: StartWorkbenchTicketDependencies;
  options: StartWorkbenchTicketOptions;
}): Promise<StartWorkbenchTicketResult> => {
  // Resolved against the saved Ticket, which may no longer link the preferred repository.
  const hostRepositoryProjectIds = workbenchHostRepositoryProjectIds(
    input.board,
    input.ticket.repositoryProjectIds,
  );
  const repositoryProjectId = resolveWorkbenchThreadRepository({
    ticket: { repositoryProjectIds: hostRepositoryProjectIds },
    preferred: options.repositoryProjectId,
  });
  const project = input.projects.find((candidate) => candidate.id === repositoryProjectId);
  if (!project) return { state: "project-unavailable", ticket: input.ticket };
  const modelSelection = options.modelSelection ?? dependencies.resolveModelSelection(project);
  if (modelSelection === null) return { state: "provider-unavailable", ticket: input.ticket };

  const threadId = dependencies.makeThreadId();
  const assignmentId = dependencies.makeAssignmentId();
  const createdAt = dependencies.now();
  dependencies.onStage?.("preparing-workspace");
  const workspaceResult = await dependencies.prepareTicketWorkspace({
    environmentId: input.environmentId,
    input: { ticketId: input.ticket.id, requestedAt: createdAt },
  });
  if (workspaceResult._tag === "Failure") {
    return { state: "failed", stage: "workspace", failure: workspaceResult, ticket: input.ticket };
  }
  const checkout = getPreparedRepository({
    hostRepositoryProjectIds,
    workspace: workspaceResult.value,
    projectId: project.id,
  });
  dependencies.onStage?.("creating-thread");
  const threadResult = await dependencies.createThread({
    environmentId: input.environmentId,
    input: {
      threadId,
      projectId: project.id,
      title: input.ticket.title,
      modelSelection,
      runtimeMode: dependencies.resolveRuntimeMode(project),
      interactionMode: DEFAULT_INTERACTION_MODE,
      branch: checkout.branchName,
      worktreePath: checkout.worktreePath,
      createdAt,
    },
  });
  if (threadResult._tag === "Failure") {
    return { state: "failed", stage: "thread", failure: threadResult, ticket: input.ticket };
  }

  // A host Thread never replaces one on another machine, whose missing Thread is only not started.
  const previousThreadId =
    options.previousThreadId ??
    (input.assignment?.environmentId === undefined ? input.assignment?.threadId : undefined);
  dependencies.onStage?.("linking-thread");
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
      ticket: input.ticket,
      failure: assignmentResult,
      ...(cleanupResult._tag === "Failure" ? { cleanupFailure: cleanupResult } : {}),
    };
  }

  return openStartedThread(dependencies, scopeThreadRef(input.environmentId, threadId));
};

const openStartedThread = async (
  dependencies: StartWorkbenchTicketDependencies,
  { environmentId, threadId }: ScopedThreadRef,
): Promise<StartWorkbenchTicketResult> => {
  try {
    dependencies.onStage?.("opening-thread");
    await dependencies.waitForThread(scopeThreadRef(environmentId, threadId));
    await dependencies.openThread(threadId, environmentId);
  } catch (cause) {
    return { state: "navigation-failed", cause };
  }
  return { state: "opened", threadId };
};
