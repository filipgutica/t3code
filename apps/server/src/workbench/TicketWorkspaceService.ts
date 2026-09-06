import * as NodeCrypto from "node:crypto";

import {
  WorkbenchOperationError,
  WorkbenchTicketWorkspaceAttemptId,
  type ProjectId,
  type WorkbenchPrepareTicketWorkspaceInput,
  type WorkbenchReleaseTicketWorkspaceInput,
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

import * as ServerConfig from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorkbenchStore } from "./WorkbenchStore.ts";

const stableSlug = (value: string) => {
  const readable = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const digest = NodeCrypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
  return `${readable || "item"}-${digest}`;
};

export const ticketWorkspaceBranchName = (ticketId: string) => `workbench/${stableSlug(ticketId)}`;

const preparationError = (message: string) =>
  new WorkbenchOperationError({
    code: "ticket_workspace_preparation_failed",
    message: message.trim().slice(0, 4_000) || "The Ticket Workspace could not be prepared.",
  });

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
>()("t3/workbench/TicketWorkspaceService") {}

interface ValidatedRepository {
  readonly projectId: ProjectId;
  readonly isPrimary: boolean;
  readonly sourcePath: string;
  readonly worktreePath: string;
  readonly refName: string;
  readonly newRefName: string | undefined;
}

const makeTicketWorkspaceService = Effect.gen(function* () {
  const store = yield* WorkbenchStore;
  const git = yield* GitWorkflowService.GitWorkflowService;
  const projections = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const clock = yield* Clock.Clock;
  const workspaceLocks = yield* Ref.make<ReadonlyMap<string, Semaphore.Semaphore>>(new Map());

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

  const worktreeIsRegistered = Effect.fn("TicketWorkspaceService.worktreeIsRegistered")(function* ({
    branchName,
    sourcePath,
    worktreePath,
  }: {
    readonly branchName: string;
    readonly sourcePath: string;
    readonly worktreePath: string;
  }) {
    const refs = yield* git
      .listRefs({ cwd: sourcePath, query: branchName, limit: 200 })
      .pipe(
        Effect.mapError((cause) =>
          preparationError(`Could not inspect a Ticket Workspace repository: ${cause.detail}`),
        ),
      );
    const expectedPath = path.resolve(worktreePath);
    return refs.refs.some(
      (ref) => ref.worktreePath !== null && path.resolve(ref.worktreePath) === expectedPath,
    );
  });

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

  const worktreeExists = Effect.fn("TicketWorkspaceService.worktreeExists")(function* ({
    branchName,
    sourcePath,
    worktreePath,
  }: {
    readonly branchName: string;
    readonly sourcePath: string;
    readonly worktreePath: string;
  }) {
    if (!(yield* worktreePathExists(worktreePath))) return false;
    return yield* worktreeIsRegistered({ branchName, sourcePath, worktreePath });
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
    if (!(yield* worktreePathExists(repository.worktreePath))) {
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
      return;
    }
    if (
      !(yield* worktreeIsRegistered({
        branchName: repository.branchName,
        sourcePath: repository.sourcePath,
        worktreePath: repository.worktreePath,
      }))
    ) {
      return yield* preparationError(
        `Could not ${operation} repository ${repository.projectId}: its worktree path exists but is no longer registered.`,
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
  });

  const recoverInterruptedPreparation = Effect.fn(
    "TicketWorkspaceService.recoverInterruptedPreparation",
  )(function* ({
    workspace,
    recoveredAt,
  }: {
    readonly workspace: WorkbenchTicketWorkspace;
    readonly recoveredAt: string;
  }) {
    for (const repository of workspace.repositories) {
      if (repository.status === "released") continue;
      yield* cleanupWorktree({ repository, force: true, operation: "recover" });
      yield* store.releaseTicketWorkspaceRepository({
        ticketId: workspace.ticketId,
        attemptId: workspace.attemptId,
        projectId: repository.projectId,
        releasedAt: recoveredAt,
      });
    }
    return yield* store.completeTicketWorkspaceRelease({
      ticketId: workspace.ticketId,
      attemptId: workspace.attemptId,
      completedAt: recoveredAt,
    });
  });

  const releaseClaimedWorkspace = Effect.fn("TicketWorkspaceService.releaseClaimedWorkspace")(
    function* ({
      workspace,
      releasedAt,
    }: {
      readonly workspace: WorkbenchTicketWorkspace;
      readonly releasedAt: string;
    }) {
      for (const repository of workspace.repositories) {
        if (repository.status !== "ready") continue;
        yield* cleanupWorktree({ repository, force: false, operation: "release" });
        yield* store.releaseTicketWorkspaceRepository({
          ticketId: workspace.ticketId,
          attemptId: workspace.attemptId,
          projectId: repository.projectId,
          releasedAt,
        });
      }
      return yield* store.completeTicketWorkspaceRelease({
        ticketId: workspace.ticketId,
        attemptId: workspace.attemptId,
        completedAt: releasedAt,
      });
    },
  );

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
    if (Option.isSome(existing) && existing.value.status === "ready") {
      let intact = true;
      for (const repository of existing.value.repositories) {
        if (
          repository.status !== "ready" ||
          !(yield* worktreeExists({
            branchName: repository.branchName,
            sourcePath: repository.sourcePath,
            worktreePath: repository.worktreePath,
          }))
        ) {
          intact = false;
          break;
        }
      }
      if (intact) return existing.value;

      const releasing = yield* store.claimTicketWorkspaceRelease({
        ticketId: existing.value.ticketId,
        attemptId: existing.value.attemptId,
        claimedAt: operationAt,
        requireActiveTicket: true,
      });
      yield* releaseClaimedWorkspace({ workspace: releasing, releasedAt: operationAt });
    }
    if (Option.isSome(existing) && existing.value.status === "releasing") {
      yield* releaseClaimedWorkspace({ workspace: existing.value, releasedAt: operationAt });
    }

    if (Option.isSome(existing) && existing.value.status === "preparing") {
      const preparationAge = nowMillis - Date.parse(existing.value.updatedAt);
      if (!Number.isFinite(preparationAge) || preparationAge < interruptedPreparationThresholdMs) {
        return yield* new WorkbenchOperationError({
          code: "ticket_workspace_preparation_in_progress",
          message: "The Ticket Workspace is already being prepared.",
        });
      }
      const activeAssignments = snapshot.assignments.filter(
        (assignment) => assignment.ticketId === input.ticketId && assignment.supersededAt === null,
      );
      for (const activeAssignment of activeAssignments) {
        const thread = yield* projections
          .getThreadShellById(activeAssignment.threadId)
          .pipe(
            Effect.mapError(() =>
              preparationError("The assigned Agent Thread could not be loaded."),
            ),
          );
        if (Option.isSome(thread)) {
          return yield* new WorkbenchOperationError({
            code: "ticket_workspace_in_use",
            message: "The interrupted Ticket Workspace is still used by an active Agent Thread.",
          });
        }
      }
      yield* recoverInterruptedPreparation({
        workspace: existing.value,
        recoveredAt: operationAt,
      });
    }

    const branchName = ticketWorkspaceBranchName(ticket.id);
    const validatedRepositories: Array<ValidatedRepository> = [];
    for (const projectId of ticket.repositoryProjectIds) {
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
      const worktreePath = path.join(
        config.worktreesDir,
        "workbench",
        stableSlug(ticket.id),
        stableSlug(projectId),
      );
      const existingBranch = refs.refs.find(
        (ref) => ref.name === branchName && ref.isRemote !== true,
      );
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
      validatedRepositories.push({
        projectId,
        isPrimary: projectId === ticket.primaryT3ProjectId,
        sourcePath: project.value.workspaceRoot,
        worktreePath,
        refName: existingBranch?.name ?? baseRef!.name,
        newRefName: existingBranch ? undefined : branchName,
      });
    }

    const attemptId = WorkbenchTicketWorkspaceAttemptId.make(NodeCrypto.randomUUID());
    yield* store.claimTicketWorkspace({
      ticketId: ticket.id,
      attemptId,
      branchName,
      repositories: validatedRepositories.map((repository) => ({
        projectId: repository.projectId,
        isPrimary: repository.isPrimary,
        sourcePath: repository.sourcePath,
        worktreePath: repository.worktreePath,
      })),
      claimedAt: operationAt,
    });

    const createdRepositories: Array<ValidatedRepository> = [];
    const failAndRollback = Effect.fn("TicketWorkspaceService.failAndRollback")(function* ({
      projectId,
      errorMessage,
    }: {
      readonly projectId: ProjectId | null;
      readonly errorMessage: string;
    }) {
      const recordedFailure = yield* Effect.result(
        store.failTicketWorkspace({
          ticketId: ticket.id,
          attemptId,
          projectId,
          errorMessage,
          failedAt: operationAt,
        }),
      );
      let rollbackFailed = Result.isFailure(recordedFailure);
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
            ticketId: ticket.id,
            attemptId,
            projectId: prepared.projectId,
            releasedAt: operationAt,
          }),
        );
        if (Result.isFailure(released)) rollbackFailed = true;
      }
      return rollbackFailed;
    });

    for (const repository of validatedRepositories) {
      const created = yield* Effect.result(
        git.createWorktree({
          cwd: repository.sourcePath,
          refName: repository.refName,
          ...(repository.newRefName ? { newRefName: repository.newRefName } : {}),
          path: repository.worktreePath,
        }),
      );
      if (Result.isFailure(created)) {
        const errorMessage = `Could not prepare repository ${repository.projectId}: ${created.failure.detail}`;
        const rollbackFailed = yield* failAndRollback({
          projectId: repository.projectId,
          errorMessage,
        });
        return yield* preparationError(
          rollbackFailed
            ? `${errorMessage} Some prepared worktrees could not be removed.`
            : errorMessage,
        );
      }
      createdRepositories.push(repository);
      const persisted = yield* Effect.result(
        store.markTicketWorkspaceRepositoryReady({
          ticketId: ticket.id,
          attemptId,
          projectId: repository.projectId,
          worktreePath: created.success.worktree.path,
          branchName: created.success.worktree.refName,
          updatedAt: operationAt,
        }),
      );
      if (Result.isFailure(persisted)) {
        const errorMessage = `Could not record prepared repository ${repository.projectId}: ${persisted.failure.message}`;
        const rollbackFailed = yield* failAndRollback({
          projectId: repository.projectId,
          errorMessage,
        });
        return yield* preparationError(
          rollbackFailed
            ? `${errorMessage} Some prepared worktrees could not be removed.`
            : errorMessage,
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
      const rollbackFailed = yield* failAndRollback({ projectId: null, errorMessage });
      return yield* preparationError(
        rollbackFailed
          ? `${errorMessage} Some prepared worktrees could not be removed.`
          : errorMessage,
      );
    }
    return completed.success;
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
    if (existing.value.status === "released") return existing.value;
    if (existing.value.status === "preparing") {
      const preparationAge = nowMillis - Date.parse(existing.value.updatedAt);
      if (!Number.isFinite(preparationAge) || preparationAge < interruptedPreparationThresholdMs) {
        return yield* new WorkbenchOperationError({
          code: "ticket_workspace_preparation_in_progress",
          message: "The Ticket Workspace is still being prepared.",
        });
      }
      return yield* recoverInterruptedPreparation({
        workspace: existing.value,
        recoveredAt: operationAt,
      });
    }
    const releasing = yield* store.claimTicketWorkspaceRelease({
      ticketId: existing.value.ticketId,
      attemptId: existing.value.attemptId,
      claimedAt: operationAt,
      requireActiveTicket: true,
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
