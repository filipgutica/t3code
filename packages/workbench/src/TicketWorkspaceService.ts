import * as NodeCrypto from "node:crypto";

import {
  WorkbenchOperationError,
  WorkbenchTicketWorkspaceAttemptId,
  type ProjectId,
  type WorkbenchTicketId,
  type WorkbenchPrepareTicketWorkspaceInput,
  type WorkbenchReleaseTicketWorkspaceInput,
  type WorkbenchSnapshot,
  type WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Semaphore from "effect/Semaphore";

import { TicketWorkspaceHost } from "./TicketWorkspaceHost.ts";
import { WorkbenchStore, type WorkbenchTicketWorkspaceRepositoryState } from "./WorkbenchStore.ts";

const shortStableSuffix = (value: string) =>
  NodeCrypto.createHash("sha256").update(value).digest("hex").slice(0, 8);

const slugSegment = (value: string, fallback: string) => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || fallback;
};

export interface TicketWorkspaceNamingInput {
  readonly ticketId: string;
  readonly jiraIssueKey?: string | null;
  readonly title?: string;
}

/** Human-readable identity used for new workspace directories and branches. */
export const ticketWorkspaceDirectoryName = ({
  ticketId,
  jiraIssueKey,
  title,
}: TicketWorkspaceNamingInput) => {
  const readable = jiraIssueKey?.trim() || title?.trim() || ticketId;
  return `${slugSegment(readable, "ticket")}-${shortStableSuffix(ticketId)}`;
};

/** String input remains supported for existing callers that lack Ticket metadata. */
export const ticketWorkspaceBranchName = (input: string | TicketWorkspaceNamingInput) =>
  typeof input === "string"
    ? `workbench/${slugSegment(input, "ticket")}-${shortStableSuffix(input)}`
    : `workbench/${ticketWorkspaceDirectoryName(input)}`;

const preparationError = (message: string) =>
  new WorkbenchOperationError({
    code: "ticket_workspace_preparation_failed",
    message: message.trim().slice(0, 4_000) || "The Ticket Workspace could not be prepared.",
  });

const uniqueRepositoryDirectoryName = ({
  repositoryName,
  projectId,
  usedNames,
}: {
  readonly repositoryName: string;
  readonly projectId: ProjectId;
  readonly usedNames: Set<string>;
}) => {
  const baseName = slugSegment(repositoryName, "repository");
  let candidate = baseName;
  if (usedNames.has(candidate)) {
    let attempt = 0;
    do {
      candidate = `${baseName}-${shortStableSuffix(`${projectId}:${attempt}`)}`;
      attempt += 1;
    } while (usedNames.has(candidate));
  }
  usedNames.add(candidate);
  return candidate;
};

const interruptedPreparationThresholdMs = 5 * 60 * 1_000;

interface TicketWorkspaceServiceShape {
  readonly prepare: (
    input: WorkbenchPrepareTicketWorkspaceInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
  readonly release: (
    input: WorkbenchReleaseTicketWorkspaceInput,
  ) => Effect.Effect<WorkbenchTicketWorkspace, WorkbenchOperationError>;
}

export class TicketWorkspaceService extends Context.Service<
  TicketWorkspaceService,
  TicketWorkspaceServiceShape
>()("@t3tools/workbench/TicketWorkspaceService") {}

interface ValidatedRepository {
  readonly projectId: ProjectId;
  readonly isPrimary: boolean;
  readonly sourcePath: string;
  readonly worktreePath: string;
  /** The branch currently observed at an existing registered worktree. */
  readonly branchName: string | undefined;
  readonly refName: string;
  readonly newRefName: string | undefined;
  readonly needsCreation: boolean;
}

const makeTicketWorkspaceService = Effect.gen(function* () {
  const store = yield* WorkbenchStore;
  const { git, projections, worktreesDir } = yield* TicketWorkspaceHost;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const clock = yield* Clock.Clock;
  const workspaceLocks = yield* Ref.make<ReadonlyMap<string, Semaphore.Semaphore>>(new Map());
  const repositoryLabel = ({
    sourcePath,
    worktreePath,
  }: Pick<WorkbenchTicketWorkspace["repositories"][number], "sourcePath" | "worktreePath">) =>
    `${path.basename(sourcePath)} at ${worktreePath}`;

  const getWorkspaceLock = Effect.fn("TicketWorkspaceService.getWorkspaceLock")(function* (
    ticketId: string,
  ) {
    const existing = (yield* Ref.get(workspaceLocks)).get(ticketId);
    if (existing) return existing;
    const proposed = yield* Semaphore.make(1);
    return yield* Ref.modify(workspaceLocks, (locks) => {
      const current = locks.get(ticketId);
      if (current) return [current, locks] as const;
      const next = new Map(locks);
      next.set(ticketId, proposed);
      return [proposed, next] as const;
    });
  });

  const findRegisteredWorktree = Effect.fn("TicketWorkspaceService.findRegisteredWorktree")(
    function* ({
      sourcePath,
      worktreePath,
    }: {
      readonly sourcePath: string;
      readonly worktreePath: string;
    }) {
      const refs = yield* git
        .listRefs({ cwd: sourcePath, limit: 200, refresh: true })
        .pipe(
          Effect.mapError((cause) =>
            preparationError(`Could not inspect a Ticket Workspace repository: ${cause.detail}`),
          ),
        );
      const expectedPath = path.resolve(worktreePath);
      const registered = refs.refs.find(
        (ref) =>
          ref.isRemote !== true &&
          ref.worktreePath !== null &&
          path.resolve(ref.worktreePath) === expectedPath,
      );
      return registered === undefined ? Option.none<string>() : Option.some(registered.name);
    },
  );

  const worktreePathExists = Effect.fn("TicketWorkspaceService.worktreePathExists")(function* (
    worktreePath: string,
  ) {
    return yield* fileSystem
      .exists(path.resolve(worktreePath))
      .pipe(
        Effect.mapError(() =>
          preparationError("Could not inspect a Ticket Workspace repository path."),
        ),
      );
  });

  const cleanupWorktree = Effect.fn("TicketWorkspaceService.cleanupWorktree")(function* ({
    repository,
    force,
    operation,
  }: {
    readonly repository: WorkbenchTicketWorkspace["repositories"][number];
    readonly force: boolean;
    readonly operation: "recover" | "release";
  }) {
    const observedBranch = yield* findRegisteredWorktree(repository);
    if (!(yield* worktreePathExists(repository.worktreePath))) {
      if (Option.isNone(observedBranch)) return Option.none();
      yield* git
        .removeWorktree({
          cwd: repository.sourcePath,
          path: repository.worktreePath,
          force,
        })
        .pipe(
          Effect.mapError((cause) =>
            preparationError(
              `Could not ${operation} repository ${repository.projectId}: ${cause.detail}`,
            ),
          ),
        );
      return observedBranch;
    }
    if (Option.isNone(observedBranch)) {
      return yield* preparationError(
        `Could not ${operation} repository ${repository.projectId}: its worktree path exists but is detached or no longer registered on a branch. Restore its branch checkout before retrying.`,
      );
    }
    yield* git
      .removeWorktree({
        cwd: repository.sourcePath,
        path: repository.worktreePath,
        force,
      })
      .pipe(
        Effect.mapError((cause) =>
          preparationError(
            `Could not ${operation} repository ${repository.projectId}: ${cause.detail}`,
          ),
        ),
      );
    return observedBranch;
  });

  const recoverInterruptedPreparation = Effect.fn(
    "TicketWorkspaceService.recoverInterruptedPreparation",
  )(function* ({
    workspace,
    repositoryStates,
    recoveredAt,
  }: {
    readonly workspace: WorkbenchTicketWorkspace;
    readonly repositoryStates: ReadonlyArray<WorkbenchTicketWorkspaceRepositoryState>;
    readonly recoveredAt: string;
  }) {
    const currentAttemptProjectIds = new Set(
      repositoryStates
        .filter((repository) => repository.attemptId === workspace.attemptId)
        .map((repository) => repository.projectId),
    );
    const retainedReadyRepositories = workspace.repositories.filter(
      (repository) =>
        repository.status === "ready" && !currentAttemptProjectIds.has(repository.projectId),
    );
    for (const repository of workspace.repositories) {
      if (repository.status === "released" || !currentAttemptProjectIds.has(repository.projectId)) {
        continue;
      }
      const observedBranch = yield* cleanupWorktree({
        repository,
        force: true,
        operation: "recover",
      });
      yield* store.releaseTicketWorkspaceRepository({
        ticketId: workspace.ticketId,
        attemptId: workspace.attemptId,
        projectId: repository.projectId,
        releasedAt: recoveredAt,
        ...(Option.isSome(observedBranch) ? { branchName: observedBranch.value } : {}),
      });
    }
    if (retainedReadyRepositories.length > 0) {
      return yield* store.failTicketWorkspaceExtension({
        ticketId: workspace.ticketId,
        attemptId: workspace.attemptId,
        projectId: null,
        errorMessage: "An interrupted Ticket Workspace extension was recovered.",
        failedAt: recoveredAt,
      });
    }
    return yield* store.completeTicketWorkspaceRelease({
      ticketId: workspace.ticketId,
      attemptId: workspace.attemptId,
      completedAt: recoveredAt,
    });
  });

  const preflightCleanWorktrees = Effect.fn("TicketWorkspaceService.preflightCleanWorktrees")(
    function* ({ workspace }: { readonly workspace: WorkbenchTicketWorkspace }) {
      const observedBranches = new Map<ProjectId, string>();
      for (const repository of workspace.repositories) {
        if (repository.status === "released") continue;
        if (!(yield* worktreePathExists(repository.worktreePath))) continue;
        yield* git.invalidateLocalStatus(repository.worktreePath);
        const status = yield* git
          .localStatus({ cwd: repository.worktreePath })
          .pipe(
            Effect.mapError((cause) =>
              preparationError(
                `Could not inspect Ticket Workspace repository ${repositoryLabel(repository)}: ${cause.message}`,
              ),
            ),
          );
        if (!status.isRepo) {
          return yield* preparationError(
            `Could not reset Ticket Workspace repository ${repositoryLabel(repository)}: its worktree path is not a Git repository.`,
          );
        }
        const observedBranch = yield* findRegisteredWorktree(repository);
        if (Option.isNone(observedBranch)) {
          return yield* preparationError(
            `Could not reset Ticket Workspace repository ${repositoryLabel(repository)}: its worktree path is detached or no longer registered on a branch. Restore its branch checkout before retrying.`,
          );
        }
        observedBranches.set(repository.projectId, observedBranch.value);
        if (status.hasWorkingTreeChanges) {
          return yield* preparationError(
            `The Ticket Workspace repository ${repositoryLabel(repository)} has local changes. Commit or remove them before resetting the Workspace.`,
          );
        }
      }
      return observedBranches;
    },
  );

  const releaseClaimedWorkspace = Effect.fn("TicketWorkspaceService.releaseClaimedWorkspace")(
    function* ({
      workspace,
      releasedAt,
    }: {
      readonly workspace: WorkbenchTicketWorkspace;
      readonly releasedAt: string;
    }) {
      yield* preflightCleanWorktrees({ workspace });
      for (const repository of workspace.repositories) {
        if (repository.status === "released") continue;
        const observedBranch = yield* cleanupWorktree({
          repository,
          force: false,
          operation: "release",
        });
        yield* store.releaseTicketWorkspaceRepository({
          ticketId: workspace.ticketId,
          attemptId: workspace.attemptId,
          projectId: repository.projectId,
          releasedAt,
          ...(Option.isSome(observedBranch) ? { branchName: observedBranch.value } : {}),
        });
      }
      return yield* store.completeTicketWorkspaceRelease({
        ticketId: workspace.ticketId,
        attemptId: workspace.attemptId,
        completedAt: releasedAt,
      });
    },
  );

  const ensureNoActiveAssignment = Effect.fn("TicketWorkspaceService.ensureNoActiveAssignment")(
    function* ({
      snapshot,
      ticketId,
      message,
      worktreePaths,
    }: {
      readonly snapshot: WorkbenchSnapshot;
      readonly ticketId: string;
      readonly message: string;
      readonly worktreePaths: ReadonlyArray<string>;
    }) {
      const protectedWorktreePaths = new Set(
        worktreePaths.map((worktreePath) => path.resolve(worktreePath)),
      );
      const activeAssignments = snapshot.assignments.filter(
        (assignment) => assignment.ticketId === ticketId && assignment.supersededAt === null,
      );
      for (const activeAssignment of activeAssignments) {
        const thread = yield* projections
          .getThreadShellById(activeAssignment.threadId)
          .pipe(
            Effect.mapError(() =>
              preparationError("The assigned Agent Thread could not be loaded."),
            ),
          );
        if (
          Option.isSome(thread) &&
          thread.value.worktreePath !== null &&
          protectedWorktreePaths.has(path.resolve(thread.value.worktreePath))
        ) {
          return yield* new WorkbenchOperationError({
            code: "ticket_workspace_in_use",
            message,
          });
        }
      }
    },
  );

  const handleReadyWorkspace = Effect.fn("TicketWorkspaceService.handleReadyWorkspace")(function* ({
    workspace,
    ticket,
    snapshot,
  }: {
    readonly workspace: WorkbenchTicketWorkspace;
    readonly ticket: WorkbenchSnapshot["tickets"][number];
    readonly snapshot: WorkbenchSnapshot;
  }) {
    const staleRepositories: Array<WorkbenchTicketWorkspace["repositories"][number]> = [];
    for (const projectId of ticket.repositoryProjectIds) {
      const repository = workspace.repositories.find(
        (candidate) => candidate.projectId === projectId,
      );
      if (repository?.status !== "ready") continue;
      if (Option.isNone(yield* findRegisteredWorktree(repository))) {
        staleRepositories.push(repository);
      }
    }
    if (staleRepositories.length === 0) return;
    yield* ensureNoActiveAssignment({
      snapshot,
      ticketId: workspace.ticketId,
      message: "The Ticket Workspace cannot be prepared while it has an active Agent Thread.",
      worktreePaths: staleRepositories.map((repository) => repository.worktreePath),
    });
    const repository = staleRepositories[0]!;
    return yield* preparationError(
      `Could not prepare repository ${repositoryLabel(repository)}: its worktree path is missing or no longer registered on a branch. If it is detached, check out a branch and retry. Otherwise restore the registered worktree, or delete linked Threads and use Reset Workspace after the path is removed.`,
    );
  });

  const recoverPreparingWorkspace = Effect.fn("TicketWorkspaceService.recoverPreparingWorkspace")(
    function* ({
      workspace,
      repositoryStates,
      snapshot,
      nowMillis,
      operationAt,
    }: {
      readonly workspace: WorkbenchTicketWorkspace;
      readonly repositoryStates: ReadonlyArray<WorkbenchTicketWorkspaceRepositoryState>;
      readonly snapshot: WorkbenchSnapshot;
      readonly nowMillis: number;
      readonly operationAt: string;
    }) {
      const preparationAge = nowMillis - Date.parse(workspace.updatedAt);
      if (!Number.isFinite(preparationAge) || preparationAge < interruptedPreparationThresholdMs) {
        return yield* new WorkbenchOperationError({
          code: "ticket_workspace_preparation_in_progress",
          message: "The Ticket Workspace is already being prepared.",
        });
      }
      yield* ensureNoActiveAssignment({
        snapshot,
        ticketId: workspace.ticketId,
        message: "The interrupted Ticket Workspace is still used by an active Agent Thread.",
        worktreePaths: workspace.repositories
          .filter((repository) =>
            repositoryStates.some(
              (state) =>
                state.projectId === repository.projectId &&
                state.attemptId === workspace.attemptId &&
                state.status !== "released",
            ),
          )
          .map((repository) => repository.worktreePath),
      });
      return yield* recoverInterruptedPreparation({
        workspace,
        repositoryStates,
        recoveredAt: operationAt,
      });
    },
  );

  const recoverFailedWorkspace = Effect.fn("TicketWorkspaceService.recoverFailedWorkspace")(
    function* ({
      workspace,
      repositoryStates,
      operationAt,
      expectedRevision,
    }: {
      readonly workspace: WorkbenchTicketWorkspace;
      readonly repositoryStates: ReadonlyArray<WorkbenchTicketWorkspaceRepositoryState>;
      readonly operationAt: string;
      readonly expectedRevision: number;
    }) {
      const claimed = yield* store.claimTicketWorkspaceRecovery({
        ticketId: workspace.ticketId,
        attemptId: workspace.attemptId,
        claimedAt: operationAt,
        expectedRevision,
      });
      const restoreFailed = store.failTicketWorkspaceExtension({
        ticketId: workspace.ticketId,
        attemptId: workspace.attemptId,
        projectId: null,
        errorMessage: workspace.errorMessage ?? "The Ticket Workspace could not be prepared.",
        failedAt: operationAt,
      });
      yield* Effect.gen(function* () {
        const currentAttemptRepositories = claimed.repositories.filter(
          (repository) =>
            repository.status !== "released" &&
            repositoryStates.some(
              (state) =>
                state.projectId === repository.projectId && state.attemptId === claimed.attemptId,
            ),
        );
        yield* ensureNoActiveAssignment({
          snapshot: yield* store.getSnapshot,
          ticketId: workspace.ticketId,
          message: "The failed Ticket Workspace is still used by an active Agent Thread.",
          worktreePaths: currentAttemptRepositories.map((repository) => repository.worktreePath),
        });
        for (const repository of currentAttemptRepositories) {
          const observedBranch = yield* cleanupWorktree({
            repository,
            force: true,
            operation: "recover",
          });
          yield* store.releaseTicketWorkspaceRepository({
            ticketId: workspace.ticketId,
            attemptId: workspace.attemptId,
            projectId: repository.projectId,
            releasedAt: operationAt,
            ...(Option.isSome(observedBranch) ? { branchName: observedBranch.value } : {}),
          });
        }
      }).pipe(Effect.catch((error) => restoreFailed.pipe(Effect.andThen(Effect.fail(error)))));
      yield* restoreFailed;
    },
  );

  const handleExistingWorkspace = Effect.fn("TicketWorkspaceService.handleExistingWorkspace")(
    function* ({
      existing,
      snapshot,
      ticket,
      repositoryStates,
      nowMillis,
      operationAt,
    }: {
      readonly existing: Option.Option<WorkbenchTicketWorkspace>;
      readonly snapshot: WorkbenchSnapshot;
      readonly ticket: WorkbenchSnapshot["tickets"][number];
      readonly repositoryStates: ReadonlyArray<WorkbenchTicketWorkspaceRepositoryState>;
      readonly nowMillis: number;
      readonly operationAt: string;
    }) {
      if (Option.isNone(existing)) return;
      const workspace = existing.value;
      if (workspace.status === "ready") {
        return yield* handleReadyWorkspace({ workspace, ticket, snapshot });
      } else if (workspace.status === "releasing") {
        yield* releaseClaimedWorkspace({ workspace, releasedAt: operationAt });
      } else if (workspace.status === "preparing") {
        yield* recoverPreparingWorkspace({
          workspace,
          repositoryStates,
          snapshot,
          nowMillis,
          operationAt,
        });
      } else if (workspace.status === "failed") {
        yield* recoverFailedWorkspace({
          workspace,
          repositoryStates,
          operationAt,
          expectedRevision: ticket.revision,
        });
      }
    },
  );

  const validateReadyRepository = Effect.fn("TicketWorkspaceService.validateReadyRepository")(
    function* ({
      projectId,
      isPrimary,
      repository,
    }: {
      readonly projectId: ProjectId;
      readonly isPrimary: boolean;
      readonly repository: WorkbenchTicketWorkspace["repositories"][number];
    }) {
      const observedBranch = yield* findRegisteredWorktree(repository);
      if (Option.isNone(observedBranch)) {
        return yield* preparationError(
          `Could not prepare repository ${repositoryLabel(repository)}: its worktree path is missing or no longer registered on a branch. If it is detached, check out a branch and retry. Otherwise restore the registered worktree, or delete linked Threads and use Reset Workspace after the path is removed.`,
        );
      }
      return {
        projectId,
        isPrimary,
        sourcePath: repository.sourcePath,
        worktreePath: repository.worktreePath,
        branchName: observedBranch.value,
        refName: observedBranch.value,
        newRefName: undefined,
        needsCreation: false,
      } satisfies ValidatedRepository;
    },
  );

  const validateNewRepository = Effect.fn("TicketWorkspaceService.validateNewRepository")(
    function* ({
      projectId,
      isPrimary,
      branchName,
      workspaceDirectory,
      existingRepository,
      usedRepositoryDirectoryNames,
    }: {
      readonly projectId: ProjectId;
      readonly isPrimary: boolean;
      readonly branchName: string;
      readonly workspaceDirectory: string;
      readonly existingRepository: WorkbenchTicketWorkspace["repositories"][number] | undefined;
      readonly usedRepositoryDirectoryNames: Set<string>;
    }) {
      const project = yield* projections
        .getProjectShellById(projectId)
        .pipe(
          Effect.mapError(() =>
            preparationError("A Ticket repository could not be loaded from this environment."),
          ),
        );
      if (Option.isNone(project)) {
        return yield* preparationError(
          `The linked T3 Project ${projectId} does not exist on this environment.`,
        );
      }
      const refs = yield* git
        .listRefs({ cwd: project.value.workspaceRoot, limit: 200 })
        .pipe(
          Effect.mapError((cause) =>
            preparationError(`Could not inspect ${project.value.title}: ${cause.detail}`),
          ),
        );
      if (!refs.isRepo) {
        return yield* preparationError(
          `${project.value.title} is not a Git repository and cannot receive a Ticket worktree.`,
        );
      }
      const repositoryDirectoryName = uniqueRepositoryDirectoryName({
        repositoryName: path.basename(project.value.workspaceRoot),
        projectId,
        usedNames: usedRepositoryDirectoryNames,
      });
      const worktreePath = path.join(workspaceDirectory, repositoryDirectoryName);
      if (yield* worktreePathExists(worktreePath)) {
        return yield* preparationError(
          `${project.value.title} already occupies the Ticket Workspace path ${worktreePath}.`,
        );
      }
      const existingBranch = refs.refs.find(
        (ref) => ref.name === branchName && ref.isRemote !== true,
      );
      if (existingBranch && existingRepository === undefined) {
        return yield* preparationError(
          `${project.value.title} already has the Ticket Workspace branch ${branchName}; it is not recorded for this Ticket.`,
        );
      }
      if (existingBranch?.worktreePath) {
        return yield* preparationError(
          `${project.value.title} already has ${branchName} checked out at ${existingBranch.worktreePath}.`,
        );
      }
      const baseRef =
        refs.refs.find((ref) => ref.current && ref.isRemote !== true) ??
        refs.refs.find((ref) => ref.isDefault && ref.isRemote !== true) ??
        refs.refs.find((ref) => ref.isDefault) ??
        refs.refs.find((ref) => ref.isRemote !== true);
      if (!existingBranch && !baseRef) {
        return yield* preparationError(
          `${project.value.title} has no local or default branch to prepare from.`,
        );
      }
      return {
        projectId,
        isPrimary,
        sourcePath: project.value.workspaceRoot,
        worktreePath,
        branchName: undefined,
        refName: existingBranch?.name ?? baseRef!.name,
        newRefName: existingBranch ? undefined : branchName,
        needsCreation: true,
      } satisfies ValidatedRepository;
    },
  );

  const validateRepositories = Effect.fn("TicketWorkspaceService.validateRepositories")(function* ({
    ticket,
    branchName,
    existingWorkspace,
    workspaceDirectory,
  }: {
    readonly ticket: WorkbenchSnapshot["tickets"][number];
    readonly branchName: string;
    readonly existingWorkspace: Option.Option<WorkbenchTicketWorkspace>;
    readonly workspaceDirectory: string;
  }) {
    const validatedRepositories: Array<ValidatedRepository> = [];
    const usedRepositoryDirectoryNames = new Set(
      Option.isSome(existingWorkspace) && existingWorkspace.value.status !== "released"
        ? existingWorkspace.value.repositories.map((repository) =>
            path.basename(repository.worktreePath),
          )
        : [],
    );
    for (const projectId of ticket.repositoryProjectIds) {
      const existingRepository = Option.isSome(existingWorkspace)
        ? existingWorkspace.value.repositories.find(
            (repository) => repository.projectId === projectId,
          )
        : undefined;
      if (existingRepository?.status === "ready") {
        validatedRepositories.push(
          yield* validateReadyRepository({
            projectId,
            isPrimary: projectId === ticket.primaryT3ProjectId,
            repository: existingRepository,
          }),
        );
        continue;
      }
      validatedRepositories.push(
        yield* validateNewRepository({
          projectId,
          isPrimary: projectId === ticket.primaryT3ProjectId,
          branchName,
          workspaceDirectory,
          existingRepository,
          usedRepositoryDirectoryNames,
        }),
      );
    }
    return validatedRepositories;
  });

  const rollbackPreparation = Effect.fn("TicketWorkspaceService.rollbackPreparation")(function* ({
    ticketId,
    attemptId,
    operationAt,
    createdRepositories,
    isWorkspaceExtension,
    projectId,
    errorMessage,
  }: {
    readonly ticketId: WorkbenchTicketId;
    readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
    readonly operationAt: string;
    readonly createdRepositories: Array<ValidatedRepository>;
    readonly isWorkspaceExtension: boolean;
    readonly projectId: ProjectId | null;
    readonly errorMessage: string;
  }) {
    let rollbackFailed = false;
    const releasedProjectIds = new Set<ProjectId>();
    for (const prepared of createdRepositories.toReversed()) {
      const removed = yield* Effect.result(
        git.removeWorktree({
          cwd: prepared.sourcePath,
          path: prepared.worktreePath,
          force: true,
        }),
      );
      if (Result.isFailure(removed)) {
        rollbackFailed = true;
        continue;
      }
      const released = yield* Effect.result(
        store.releaseTicketWorkspaceRepository({
          ticketId,
          attemptId,
          projectId: prepared.projectId,
          releasedAt: operationAt,
        }),
      );
      if (Result.isFailure(released)) rollbackFailed = true;
      else releasedProjectIds.add(prepared.projectId);
    }
    const failedProjectId =
      projectId !== null && releasedProjectIds.has(projectId) ? null : projectId;
    const recordedFailure = yield* Effect.result(
      isWorkspaceExtension
        ? store.failTicketWorkspaceExtension({
            ticketId,
            attemptId,
            projectId: failedProjectId,
            errorMessage,
            failedAt: operationAt,
          })
        : store.failTicketWorkspace({
            ticketId,
            attemptId,
            projectId: failedProjectId,
            errorMessage,
            failedAt: operationAt,
          }),
    );
    return rollbackFailed || Result.isFailure(recordedFailure);
  });

  const prepareRepository = Effect.fn("TicketWorkspaceService.prepareRepository")(function* ({
    ticketId,
    attemptId,
    operationAt,
    repository,
    createdRepositories,
  }: {
    readonly ticketId: WorkbenchTicketId;
    readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
    readonly operationAt: string;
    readonly repository: ValidatedRepository;
    readonly createdRepositories: Array<ValidatedRepository>;
  }) {
    const created = yield* Effect.result(
      git.createWorktree({
        cwd: repository.sourcePath,
        refName: repository.refName,
        ...(repository.newRefName ? { newRefName: repository.newRefName } : {}),
        path: repository.worktreePath,
      }),
    );
    if (Result.isFailure(created)) {
      return Result.fail(
        `Could not prepare repository ${repository.projectId}: ${created.failure.detail}`,
      );
    }
    createdRepositories.push(repository);
    const persisted = yield* Effect.result(
      store.markTicketWorkspaceRepositoryReady({
        ticketId,
        attemptId,
        projectId: repository.projectId,
        worktreePath: created.success.worktree.path,
        branchName: created.success.worktree.refName,
        updatedAt: operationAt,
      }),
    );
    if (Result.isFailure(persisted)) {
      return Result.fail(
        `Could not record prepared repository ${repository.projectId}: ${persisted.failure.message}`,
      );
    }
    return Result.succeed(undefined);
  });

  const finishPreparation = Effect.fn("TicketWorkspaceService.finishPreparation")(function* ({
    ticket,
    attemptId,
    operationAt,
    claimedWorkspace,
    validatedRepositories,
    existingWorkspace,
    repositoryStates,
  }: {
    readonly ticket: WorkbenchSnapshot["tickets"][number];
    readonly attemptId: WorkbenchTicketWorkspaceAttemptId;
    readonly operationAt: string;
    readonly claimedWorkspace: WorkbenchTicketWorkspace;
    readonly validatedRepositories: ReadonlyArray<ValidatedRepository>;
    readonly existingWorkspace: Option.Option<WorkbenchTicketWorkspace>;
    readonly repositoryStates: ReadonlyArray<WorkbenchTicketWorkspaceRepositoryState>;
  }) {
    if (claimedWorkspace.status === "ready") return claimedWorkspace;
    const hasRetainedRepositories =
      Option.isSome(existingWorkspace) &&
      existingWorkspace.value.repositories.some(
        (repository) =>
          repository.status === "ready" &&
          repositoryStates.find((state) => state.projectId === repository.projectId)?.attemptId !==
            existingWorkspace.value.attemptId,
      );
    const isWorkspaceExtension =
      Option.isSome(existingWorkspace) &&
      (existingWorkspace.value.status === "ready" || hasRetainedRepositories);
    const createdRepositories: Array<ValidatedRepository> = [];
    for (const repository of validatedRepositories) {
      if (!repository.needsCreation) continue;
      const prepared = yield* prepareRepository({
        ticketId: ticket.id,
        attemptId,
        operationAt,
        repository,
        createdRepositories,
      });
      if (Result.isFailure(prepared)) {
        const rollbackFailed = yield* rollbackPreparation({
          ticketId: ticket.id,
          attemptId,
          operationAt,
          createdRepositories,
          isWorkspaceExtension,
          projectId: repository.projectId,
          errorMessage: prepared.failure,
        });
        return yield* preparationError(
          rollbackFailed
            ? `${prepared.failure} Some prepared worktrees could not be removed.`
            : prepared.failure,
        );
      }
    }

    const completed = yield* Effect.result(
      store.completeTicketWorkspace({
        ticketId: ticket.id,
        attemptId,
        completedAt: operationAt,
      }),
    );
    if (Result.isFailure(completed)) {
      const errorMessage = `Could not finish preparing the Ticket Workspace: ${completed.failure.message}`;
      const rollbackFailed = yield* rollbackPreparation({
        ticketId: ticket.id,
        attemptId,
        operationAt,
        createdRepositories,
        isWorkspaceExtension,
        projectId: null,
        errorMessage,
      });
      return yield* preparationError(
        rollbackFailed
          ? `${errorMessage} Some prepared worktrees could not be removed.`
          : errorMessage,
      );
    }
    return completed.success;
  });

  const prepareUnlocked: TicketWorkspaceServiceShape["prepare"] = Effect.fn(
    "TicketWorkspaceService.prepareUnlocked",
  )(function* (input) {
    const nowMillis = yield* clock.currentTimeMillis;
    const operationAt = DateTime.formatIso(DateTime.makeUnsafe(nowMillis));
    // Check lifecycle state before inspecting or releasing an existing
    // Workspace. Archiving must not allow this flow to clean up a retained
    // worktree, and deletion must not start a new preparation.
    const snapshot = yield* store.getSnapshot;
    const ticket = snapshot.tickets.find((candidate) => candidate.id === input.ticketId);
    if (!ticket) {
      return yield* new WorkbenchOperationError({
        code: "ticket_not_found",
        message: "The Workbench Ticket does not exist.",
      });
    }
    if (ticket.archivedAt !== undefined && ticket.archivedAt !== null) {
      return yield* new WorkbenchOperationError({
        code: "ticket_archived",
        message: "Archived Workbench Tickets cannot receive a Workspace.",
      });
    }
    const existing = yield* store.getTicketWorkspace(input.ticketId);
    const repositoryStates = yield* store.getTicketWorkspaceRepositoryStates(input.ticketId);
    yield* handleExistingWorkspace({
      existing,
      snapshot,
      ticket,
      repositoryStates,
      nowMillis,
      operationAt,
    });

    const reconciledExisting = yield* store.getTicketWorkspace(input.ticketId);
    const startsNewGeneration =
      Option.isNone(reconciledExisting) || reconciledExisting.value.status === "released";
    const jiraIssueKey = startsNewGeneration
      ? Option.getOrNull(yield* store.getTicketJiraIssueKey(ticket.id))
      : null;
    const proposedWorkspaceDirectoryName = ticketWorkspaceDirectoryName({
      ticketId: ticket.id,
      jiraIssueKey,
      title: ticket.title,
    });
    const branchName = Option.isSome(reconciledExisting)
      ? reconciledExisting.value.branchName
      : ticketWorkspaceBranchName({
          ticketId: ticket.id,
          jiraIssueKey,
          title: ticket.title,
        });
    const workspaceDirectory =
      !startsNewGeneration &&
      Option.isSome(reconciledExisting) &&
      reconciledExisting.value.repositories[0] !== undefined
        ? path.dirname(reconciledExisting.value.repositories[0].worktreePath)
        : path.join(worktreesDir, "workbench", proposedWorkspaceDirectoryName);
    if (
      startsNewGeneration &&
      snapshot.ticketWorkspaces.some(
        (workspace) =>
          workspace.ticketId !== ticket.id &&
          workspace.repositories.some(
            (repository) => path.dirname(repository.worktreePath) === workspaceDirectory,
          ),
      )
    ) {
      return yield* preparationError(
        `The Ticket Workspace directory ${workspaceDirectory} is already assigned to another Ticket.`,
      );
    }
    const recordedWorkspaceDirectory =
      Option.isSome(reconciledExisting) && reconciledExisting.value.repositories[0] !== undefined
        ? path.dirname(reconciledExisting.value.repositories[0].worktreePath)
        : null;
    if (
      startsNewGeneration &&
      workspaceDirectory !== recordedWorkspaceDirectory &&
      (yield* worktreePathExists(workspaceDirectory))
    ) {
      return yield* preparationError(
        `The Ticket Workspace directory ${workspaceDirectory} already exists and is not recorded for this Ticket.`,
      );
    }
    const validatedRepositories = yield* validateRepositories({
      ticket,
      branchName,
      existingWorkspace: reconciledExisting,
      workspaceDirectory,
    });

    const attemptId = WorkbenchTicketWorkspaceAttemptId.make(NodeCrypto.randomUUID());
    const claimedWorkspace = yield* store.claimTicketWorkspace({
      ticketId: ticket.id,
      attemptId,
      branchName,
      repositories: validatedRepositories.map((repository) => ({
        projectId: repository.projectId,
        isPrimary: repository.isPrimary,
        sourcePath: repository.sourcePath,
        worktreePath: repository.worktreePath,
        ...(repository.branchName !== undefined ? { branchName: repository.branchName } : {}),
      })),
      claimedAt: operationAt,
    });
    return yield* finishPreparation({
      ticket,
      attemptId,
      operationAt,
      claimedWorkspace,
      validatedRepositories,
      existingWorkspace: reconciledExisting,
      repositoryStates,
    });
  });

  const releaseUnlocked: TicketWorkspaceServiceShape["release"] = Effect.fn(
    "TicketWorkspaceService.releaseUnlocked",
  )(function* (input) {
    const nowMillis = yield* clock.currentTimeMillis;
    const operationAt = DateTime.formatIso(DateTime.makeUnsafe(nowMillis));
    const existing = yield* store.getTicketWorkspace(input.ticketId);
    if (Option.isNone(existing)) {
      return yield* new WorkbenchOperationError({
        code: "ticket_workspace_not_found",
        message: "The Ticket Workspace does not exist.",
      });
    }
    const snapshot = yield* store.getSnapshot;
    const ticket = snapshot.tickets.find((candidate) => candidate.id === input.ticketId);
    if (ticket === undefined) {
      return yield* new WorkbenchOperationError({
        code: "ticket_not_found",
        message: "The Workbench Ticket does not exist.",
      });
    }
    if (ticket.archivedAt !== undefined && ticket.archivedAt !== null) {
      return yield* new WorkbenchOperationError({
        code: "ticket_archived",
        message: "Archived Workbench Tickets cannot release a Workspace.",
      });
    }
    if (existing.value.status === "released") return existing.value;
    if (existing.value.status === "preparing") {
      return yield* new WorkbenchOperationError({
        code: "ticket_workspace_preparation_in_progress",
        message: "The Ticket Workspace is still being prepared and cannot be reset yet.",
      });
    }
    // Keep a dirty or unreadable workspace unchanged. The release claim below
    // repeats the check after setting `releasing` to cover a race before any
    // worktree removal starts.
    yield* preflightCleanWorktrees({ workspace: existing.value });
    const releasing = yield* store.claimTicketWorkspaceRelease({
      ticketId: existing.value.ticketId,
      attemptId: existing.value.attemptId,
      claimedAt: operationAt,
      requireActiveTicket: true,
      requireNoLinkedThreads: true,
    });
    return yield* releaseClaimedWorkspace({ workspace: releasing, releasedAt: operationAt });
  });

  const prepare: TicketWorkspaceServiceShape["prepare"] = (input) =>
    Effect.gen(function* () {
      const lock = yield* getWorkspaceLock(input.ticketId);
      return yield* lock.withPermit(prepareUnlocked(input));
    });
  const release: TicketWorkspaceServiceShape["release"] = (input) =>
    Effect.gen(function* () {
      const lock = yield* getWorkspaceLock(input.ticketId);
      return yield* lock.withPermit(releaseUnlocked(input));
    });

  return TicketWorkspaceService.of({ prepare, release });
});

export const TicketWorkspaceServiceLive = Layer.effect(
  TicketWorkspaceService,
  makeTicketWorkspaceService,
);
