import { CommandId, MessageId, ThreadId, WorkbenchOperationError } from "@t3tools/contracts";
import { WorkbenchAgentHost } from "@t3tools/workbench/WorkbenchAgentHost";
import { layer as serviceLayer } from "@t3tools/workbench/WorkbenchAgentService";
import * as Crypto from "effect/Crypto";
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

/** Where an owner's plans, specs, and mockups live; `ensureArtifactsDir` creates it. */
export const artifactsDirectory = (input: {
  readonly path: Path.Path;
  readonly stateDir: string;
  readonly ownerId: string;
}) => input.path.join(input.stateDir, "workbench-artifacts", artifactsFolderName(input.ownerId));

const hostLayer = Layer.effect(
  WorkbenchAgentHost,
  Effect.gen(function* () {
    const { stateDir } = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const projects = yield* ProjectStoreV2;
    const threads = yield* ThreadManagementService;
    const crypto = yield* Crypto.Crypto;
    const newId = (prefix: string) =>
      crypto.randomUUIDv4().pipe(
        Effect.orDie,
        Effect.map((id) => `${prefix}:${id}`),
      );
    const threadFailure = unavailable("The new Thread could not be started.");
    return WorkbenchAgentHost.of({
      ensureArtifactsDir: Effect.fn("WorkbenchAgentHost.ensureArtifactsDir")(function* (ownerId) {
        const directory = artifactsDirectory({ path, stateDir, ownerId });
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
        ).pipe(Effect.mapError(unavailable("The Ticket's Threads could not be loaded.")));
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
      createThread: Effect.fn("WorkbenchAgentHost.createThread")(function* (input) {
        const caller = yield* threads
          .getThreadShell(input.callerThreadId)
          .pipe(Effect.mapError(threadFailure));
        if (caller === null) return yield* threadFailure();
        const threadId = ThreadId.make(yield* crypto.randomUUIDv4().pipe(Effect.orDie));
        yield* threads
          .dispatch({
            type: "thread.create",
            commandId: CommandId.make(yield* newId("workbench:thread-create")),
            threadId,
            projectId: input.projectId,
            title: input.title,
            createdBy: "agent",
            creationSource: "mcp",
            modelSelection: caller.modelSelection,
            runtimeMode: input.runtimeMode,
            interactionMode: input.interactionMode,
            branch: input.branch,
            worktreePath: input.worktreePath,
          })
          .pipe(Effect.mapError(threadFailure));
        return threadId;
      }),
      deleteThread: Effect.fn("WorkbenchAgentHost.deleteThread")(function* (threadId) {
        yield* threads
          .dispatch({
            type: "thread.delete",
            commandId: CommandId.make(yield* newId("workbench:thread-delete")),
            threadId,
          })
          .pipe(Effect.mapError(threadFailure));
      }),
      sendMessage: Effect.fn("WorkbenchAgentHost.sendMessage")(function* (input) {
        const thread = yield* threads
          .getThreadShell(input.threadId)
          .pipe(Effect.mapError(threadFailure));
        if (thread === null) return yield* threadFailure();
        const commandId = CommandId.make(yield* newId("workbench:thread-message"));
        yield* threads
          .sendToThread({
            projectId: thread.projectId,
            commandId,
            threadId: input.threadId,
            messageId: MessageId.make(commandId),
            senderThreadId: input.senderThreadId,
            text: input.text,
            attachments: [],
            mode: "auto",
            createdBy: "agent",
            creationSource: "mcp",
          })
          .pipe(Effect.mapError(threadFailure));
      }),
    });
  }),
);

export const WorkbenchAgentServiceLive = serviceLayer.pipe(Layer.provide(hostLayer));
