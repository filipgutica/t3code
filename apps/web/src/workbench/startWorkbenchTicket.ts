import type { CreateThreadInput, DeleteThreadInput } from "@t3tools/client-runtime/operations";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ModelSelection,
  RuntimeMode,
  ProjectId,
  ThreadId,
  WorkbenchAssignment,
  WorkbenchAssignmentId,
  WorkbenchCreateAssignmentInput,
  WorkbenchReplaceAssignmentInput,
  WorkbenchPrepareTicketWorkspaceInput,
  WorkbenchTicket,
  WorkbenchTicketWorkspace,
  WorkbenchRemoteProject,
  WorkbenchUpdateTicketInput,
} from "@t3tools/contracts";

import { getWorkbenchBoardRepositories } from "./workbenchRemoteProjects";
import { DEFAULT_INTERACTION_MODE } from "../types";
import { resolveWorkbenchTicketThreadTarget } from "./workbench.logic";
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
  readonly remoteProjects?: ReadonlyArray<WorkbenchRemoteProject> | undefined;
  readonly existingThreadIds: ReadonlySet<ThreadId>;
  readonly threadLookupReady: boolean;
}

export type WorkbenchTicketStartStage =
  | "checking-thread"
  | "saving-repositories"
  | "preparing-workspace"
  | "creating-thread"
  | "linking-thread"
  | "opening-thread";

const WORKBENCH_TICKET_START_STAGE_LABELS: Record<WorkbenchTicketStartStage, string> = {
  "checking-thread": "Checking for an existing Thread…",
  "saving-repositories": "Saving repositories…",
  "preparing-workspace": "Preparing repositories…",
  "creating-thread": "Creating Thread…",
  "linking-thread": "Linking Thread to Ticket…",
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
  readonly waitForThread: (threadId: ThreadId, environmentId: EnvironmentId) => Promise<void>;
  readonly openThread: (threadId: ThreadId, environmentId: EnvironmentId) => Promise<void>;
  readonly resolveModelSelection: (project: EnvironmentProject) => ModelSelection | null;
  readonly resolveRuntimeMode: (project: EnvironmentProject) => RuntimeMode;
  readonly makeThreadId: () => ThreadId;
  readonly makeAssignmentId: () => WorkbenchAssignmentId;
  readonly now: () => string;
  readonly seedRemotePrompt?: (
    threadId: ThreadId,
    environmentId: EnvironmentId,
    ticket: WorkbenchTicket,
  ) => Promise<void>;
  readonly onStage?: (stage: WorkbenchTicketStartStage) => void;
}

export type StartWorkbenchTicketResult =
  | { readonly state: "opened"; readonly threadId: ThreadId }
  | { readonly state: "navigation-failed"; readonly cause: unknown }
  // These carry the saved Ticket, so the caller can review against its own repository save.
  | { readonly state: "project-unavailable"; readonly ticket: WorkbenchTicket }
  | { readonly state: "provider-unavailable"; readonly ticket: WorkbenchTicket }
  | { readonly state: "thread-status-unavailable" }
  | {
      readonly state: "failed";
      readonly stage: "repositories" | "workspace" | "thread" | "assignment";
      readonly ticket?: WorkbenchTicket;
      readonly failure: Extract<CommandResult, { readonly _tag: "Failure" }>;
      readonly cleanupFailure?: Extract<CommandResult, { readonly _tag: "Failure" }>;
    };

const openExistingWorkbenchThread = async ({
  input,
  dependencies,
}: {
  input: StartWorkbenchTicketInput;
  dependencies: StartWorkbenchTicketDependencies;
}): Promise<StartWorkbenchTicketResult | null> => {
  dependencies.onStage?.("checking-thread");
  const target = resolveWorkbenchTicketThreadTarget(
    input.assignment,
    input.existingThreadIds,
    input.threadLookupReady,
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

const getPreparedRepository = ({
  ticket,
  workspace,
  projectId,
}: {
  ticket: WorkbenchTicket;
  workspace: WorkbenchTicketWorkspace;
  projectId: ProjectId;
}) => {
  const readyCheckout = (id: ProjectId) =>
    workspace.repositories.find(
      (repository) => repository.projectId === id && repository.status === "ready",
    );
  const checkout = readyCheckout(projectId);
  if (!checkout || !ticket.repositoryProjectIds.every(readyCheckout)) {
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

const prepareWorkbenchThreadCheckout = async ({
  input,
  dependencies,
  project,
  createdAt,
  remote,
}: {
  input: StartWorkbenchTicketInput;
  dependencies: StartWorkbenchTicketDependencies;
  project: EnvironmentProject;
  createdAt: string;
  remote: boolean;
}) => {
  if (remote)
    return { state: "ready", checkout: { branchName: null, worktreePath: null } } as const;
  dependencies.onStage?.("preparing-workspace");
  const result = await dependencies.prepareTicketWorkspace({
    environmentId: input.environmentId,
    input: { ticketId: input.ticket.id, requestedAt: createdAt },
  });
  if (result._tag === "Failure")
    return { state: "failed", stage: "workspace", failure: result, ticket: input.ticket } as const;
  return {
    state: "ready",
    checkout: getPreparedRepository({
      ticket: input.ticket,
      workspace: result.value,
      projectId: project.id,
    }),
  } as const;
};

const assignWorkbenchThread = ({
  input,
  dependencies,
  options,
  threadId,
  assignmentId,
  createdAt,
  remote,
}: {
  input: StartWorkbenchTicketInput;
  dependencies: StartWorkbenchTicketDependencies;
  options: StartWorkbenchTicketOptions;
  threadId: ThreadId;
  assignmentId: WorkbenchAssignmentId;
  createdAt: string;
  remote: WorkbenchCreateAssignmentInput["remote"];
}) => {
  const previousThreadId = options.previousThreadId ?? input.assignment?.threadId;
  const assignment = {
    id: assignmentId,
    ticketId: input.ticket.id,
    threadId,
    ...(remote ? { remote } : {}),
  };
  return options.mode !== "additional" && previousThreadId
    ? dependencies.replaceAssignment({
        environmentId: input.environmentId,
        input: { ...assignment, previousThreadId, replacedAt: createdAt },
      })
    : dependencies.createAssignment({
        environmentId: input.environmentId,
        input: { ...assignment, createdAt },
      });
};

export async function coordinateWorkbenchTicketStart(
  originalInput: StartWorkbenchTicketInput,
  dependencies: StartWorkbenchTicketDependencies,
  options: StartWorkbenchTicketOptions = {},
): Promise<StartWorkbenchTicketResult> {
  if (options.mode === undefined) {
    const existing = await openExistingWorkbenchThread({ input: originalInput, dependencies });
    if (existing !== null) return existing;
  }

  const saved = await saveReviewedRepositoryScope({
    input: originalInput,
    dependencies,
    repositoryScope: options.repositoryScope,
  });
  if (saved.state === "failed") return saved;
  const input = { ...originalInput, ticket: saved.ticket };

  // Resolved against the saved Ticket, which may no longer link the preferred repository.
  const repositoryProjectId = resolveWorkbenchThreadRepository({
    ticket: input.ticket,
    preferred: options.repositoryProjectId,
  });
  const project = getWorkbenchBoardRepositories({
    board: {
      linkedProjectIds: input.ticket.repositoryProjectIds,
      remoteProjects: input.remoteProjects ?? [],
    },
    projects: input.projects,
    environmentId: input.environmentId,
  }).find((candidate) => candidate.id === repositoryProjectId);
  if (!project) return { state: "project-unavailable", ticket: input.ticket };
  const modelSelection = options.modelSelection ?? dependencies.resolveModelSelection(project);
  if (modelSelection === null) return { state: "provider-unavailable", ticket: input.ticket };

  const threadId = dependencies.makeThreadId();
  const assignmentId = dependencies.makeAssignmentId();
  const createdAt = dependencies.now();
  const threadEnvironmentId = project.environmentId;
  const remote =
    threadEnvironmentId !== input.environmentId
      ? { environmentId: threadEnvironmentId, projectId: project.id }
      : undefined;
  const preparation = await prepareWorkbenchThreadCheckout({
    input,
    dependencies,
    project,
    createdAt,
    remote: remote !== undefined,
  });
  if (preparation.state === "failed") return preparation;
  const { checkout } = preparation;
  dependencies.onStage?.("creating-thread");
  const threadResult = await dependencies.createThread({
    environmentId: threadEnvironmentId,
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

  dependencies.onStage?.("linking-thread");
  const assignmentResult = await assignWorkbenchThread({
    input,
    dependencies,
    options,
    threadId,
    assignmentId,
    createdAt,
    remote,
  });
  if (assignmentResult._tag === "Failure") {
    const cleanupResult = await dependencies.deleteThread({
      environmentId: threadEnvironmentId,
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

  if (remote) await dependencies.seedRemotePrompt?.(threadId, threadEnvironmentId, input.ticket);
  return openStartedThread(dependencies, threadId, threadEnvironmentId);
}

const openStartedThread = async (
  dependencies: StartWorkbenchTicketDependencies,
  threadId: ThreadId,
  environmentId: EnvironmentId,
): Promise<StartWorkbenchTicketResult> => {
  try {
    dependencies.onStage?.("opening-thread");
    await dependencies.waitForThread(threadId, environmentId);
    await dependencies.openThread(threadId, environmentId);
  } catch (cause) {
    return { state: "navigation-failed", cause };
  }
  return { state: "opened", threadId };
};
