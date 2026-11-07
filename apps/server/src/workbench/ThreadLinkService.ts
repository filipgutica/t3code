import { CommandId, ThreadId, WorkbenchOperationError } from "@t3tools/contracts";
import { ThreadLinkHost } from "@t3tools/workbench/ThreadLinkHost";
import { layer as serviceLayer } from "@t3tools/workbench/ThreadLinkService";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";

export { ThreadLinkService } from "@t3tools/workbench/ThreadLinkService";

const failure = (message: string) => () =>
  new WorkbenchOperationError({ code: "persistence_failed", message });

export const hostLayer = Layer.effect(
  ThreadLinkHost,
  Effect.gen(function* () {
    const threads = yield* ThreadManagementService;
    const random = yield* SecureRandom.SecureRandom;
    // Rejected native commands also keep receipts, so every attempt needs a fresh command id.
    const commandId = (prefix: string) =>
      random.uuidV4().pipe(Effect.map((id) => CommandId.make(`workbench:${prefix}:${id}`)));
    return ThreadLinkHost.of({
      forkThread: Effect.fn("ThreadLinkHost.forkThread")(function* (sourceThreadId) {
        const targetThreadId = ThreadId.make(yield* random.uuidV4());
        yield* threads
          .dispatch({
            type: "thread.fork",
            commandId: yield* commandId("thread-link-fork"),
            createdBy: "user",
            creationSource: "web",
            sourceThreadId,
            targetThreadId,
            sourcePoint: { type: "latest_stable" },
          })
          .pipe(
            Effect.mapError(
              failure("The Thread could not be forked. Only a Thread with a finished turn can be."),
            ),
          );
        return targetThreadId;
      }),
      rebindThread: Effect.fn("ThreadLinkHost.rebindThread")(function* ({ threadId, from, to }) {
        yield* threads
          .dispatch({
            type: "thread.metadata.update",
            commandId: yield* commandId("thread-link-rebind"),
            threadId,
            projectId: to.projectId,
            branch: to.branch,
            worktreePath: to.worktreePath,
            expectedProjectId: from.projectId,
            expectedBranch: from.branch,
            expectedWorktreePath: from.worktreePath,
            expectedEmpty: true,
          })
          .pipe(Effect.mapError(failure("The fork could not move into the Ticket's worktree.")));
      }),
      deleteThread: Effect.fn("ThreadLinkHost.deleteThread")(function* (threadId) {
        yield* threads
          .dispatch({
            type: "thread.delete",
            commandId: yield* commandId("thread-link-delete"),
            threadId,
          })
          .pipe(Effect.mapError(failure("The fork could not be deleted.")));
      }),
    });
  }),
);

export const ThreadLinkServiceLive = serviceLayer.pipe(Layer.provide(hostLayer));
