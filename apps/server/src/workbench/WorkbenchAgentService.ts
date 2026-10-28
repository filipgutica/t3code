import { WorkbenchOperationError } from "@t3tools/contracts";
import { WorkbenchAgentHost } from "@t3tools/workbench/WorkbenchAgentHost";
import { layer as serviceLayer } from "@t3tools/workbench/WorkbenchAgentService";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { ServerConfig } from "../config.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import {
  threadPullRequestsOf,
  visibleThreadPullRequests,
} from "../sourceControl/threadPullRequests.ts";

export { WorkbenchAgentService } from "@t3tools/workbench/WorkbenchAgentService";

const unavailable = (message: string) => () =>
  new WorkbenchOperationError({ code: "persistence_failed", message });

/** Ticket ids are user-visible strings, so one never names a parent or nested folder. */
const artifactsFolderName = (ownerId: string) =>
  encodeURIComponent(ownerId).replace(/^\.\.?$/u, (dots) => dots.replaceAll(".", "%2E"));

const hostLayer = Layer.effect(
  WorkbenchAgentHost,
  Effect.gen(function* () {
    const { stateDir } = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const projects = yield* ProjectStoreV2;
    const threads = yield* ThreadManagementService;
    return WorkbenchAgentHost.of({
      ensureArtifactsDir: Effect.fn("WorkbenchAgentHost.ensureArtifactsDir")(function* (ownerId) {
        const directory = path.join(stateDir, "workbench-artifacts", artifactsFolderName(ownerId));
        yield* fs
          .makeDirectory(directory, { recursive: true })
          .pipe(Effect.mapError(unavailable("The artifacts folder could not be created.")));
        return directory;
      }),
      describeProjects: Effect.fn("WorkbenchAgentHost.describeProjects")(function* (projectIds) {
        const rows = yield* projects
          .list({ projectIds })
          .pipe(Effect.mapError(unavailable("The repositories could not be loaded.")));
        return rows.map((row) => ({ id: row.projectId, title: row.title }));
      }),
      describeThreads: Effect.fn("WorkbenchAgentHost.describeThreads")(function* (threadIds) {
        const shells = yield* Effect.forEach(threadIds, (threadId) =>
          threads.getThreadShell(threadId),
        ).pipe(Effect.mapError(unavailable("The Workstream's Threads could not be loaded.")));
        return shells.flatMap((shell) =>
          shell === null || shell.deletedAt !== null
            ? []
            : [
                {
                  id: shell.id,
                  title: shell.title,
                  pullRequests: visibleThreadPullRequests(threadPullRequestsOf(shell)).map(
                    (link) => ({ url: link.url, state: link.snapshot?.state ?? null }),
                  ),
                },
              ],
        );
      }),
    });
  }),
);

export const WorkbenchAgentServiceLive = serviceLayer.pipe(Layer.provide(hostLayer));
