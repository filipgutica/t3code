import {
  isProviderNativeSubagentThread,
  type OrchestrationV2AppThread,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ProjectStoreV2 } from "./ProjectStore.ts";
import type { ProjectionStoreV2Shape } from "./ProjectionStore.ts";

// Called within the native Thread dispatch lock; adapter prechecks cannot replace this decision.
export const decideThreadRepositoryBinding = ({
  thread,
  command,
  projects,
  projections,
}: {
  thread: OrchestrationV2AppThread;
  command: Extract<OrchestrationV2ServerCommand, { type: "thread.metadata.update" }>;
  projects: Pick<ProjectStoreV2["Service"], "get">;
  projections: Pick<ProjectionStoreV2Shape, "getThreadRecords">;
}) =>
  Effect.gen(function* () {
    if (command.expectedProjectId !== undefined && command.expectedProjectId !== thread.projectId) {
      return {
        type: "refused",
        cause: `Thread ${command.threadId} project changed before the metadata update could be applied.`,
      } as const;
    }
    if (command.projectId === undefined) {
      return { type: "allowed", projectChanged: false } as const;
    }

    const project = yield* projects.get(command.projectId);
    if (
      command.expectedProjectId === undefined ||
      command.expectedWorktreePath === undefined ||
      command.branch === undefined ||
      command.worktreePath === undefined ||
      Option.isNone(project) ||
      project.value.deletedAt !== null ||
      thread.archivedAt !== null ||
      isProviderNativeSubagentThread(thread)
    ) {
      return {
        type: "refused",
        cause: `Thread ${command.threadId} requires a live destination project and an explicit expected and destination binding.`,
      } as const;
    }

    const records = yield* projections.getThreadRecords(command.threadId, [
      "runs",
      "runtimeRequests",
    ]);
    if (
      records.runs.some((run) =>
        ["preparing", "queued", "starting", "running", "waiting"].includes(run.status),
      ) ||
      records.runtimeRequests.some((request) => request.status === "pending")
    ) {
      return {
        type: "refused",
        cause: `Thread ${command.threadId} has active or blocked work and cannot be rebound.`,
      } as const;
    }

    return {
      type: "allowed",
      projectChanged: command.projectId !== thread.projectId,
    } as const;
  });
