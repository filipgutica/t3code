import type { IsoDateTime, RunId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";

import { ThreadRecapHost } from "./ThreadRecapHost.ts";
import { WorkbenchStore } from "./WorkbenchStore.ts";

export interface ThreadRecapRequest {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  /** Terminal time of the run; it orders recaps for the same Thread. */
  readonly completedAt: IsoDateTime;
}

export class ThreadRecapService extends Context.Service<
  ThreadRecapService,
  {
    /** Schedule a recap of a finished run when its Thread shares a Ticket. Never fails. */
    readonly enqueue: (request: ThreadRecapRequest) => Effect.Effect<void>;
    /** Wait for currently scheduled recaps to finish, including superseding requests. */
    readonly awaitIdle: Effect.Effect<void>;
  }
>()("@t3tools/workbench/ThreadRecapService") {}

export const ThreadRecapServiceLive = Layer.effect(
  ThreadRecapService,
  Effect.gen(function* () {
    const store = yield* WorkbenchStore;
    const host = yield* ThreadRecapHost;
    const queue = yield* Queue.unbounded<ThreadId>();
    const lock = yield* Semaphore.make(1);
    // One queued entry per Thread and one running model call per environment.
    const jobs = new Map<ThreadId, ThreadRecapRequest>();
    const queued = new Set<ThreadId>();
    let idle = yield* Deferred.make<void>();
    yield* Deferred.succeed(idle, undefined);

    const enqueue = Effect.fn("ThreadRecapService.enqueue")(
      function* (request: ThreadRecapRequest) {
        const roster = yield* store.getThreadRoster(request.threadId);
        if (Option.isNone(roster) || roster.value.siblings.length === 0) return;
        const stored = roster.value.recap;
        // Replayed terminal events must not regenerate or roll back a recap.
        if (
          stored !== null &&
          (stored.runId === request.runId || stored.updatedAt > request.completedAt)
        )
          return;
        yield* lock.withPermit(
          Effect.gen(function* () {
            const current = jobs.get(request.threadId);
            if (current !== undefined && current.completedAt >= request.completedAt) return;
            if (jobs.size === 0) idle = yield* Deferred.make<void>();
            jobs.set(request.threadId, request);
            if (!queued.has(request.threadId)) {
              queued.add(request.threadId);
              yield* Queue.offer(queue, request.threadId);
            }
          }),
        );
      },
      Effect.catch((error) =>
        Effect.logWarning("A Thread recap could not be scheduled.", { cause: error.message }),
      ),
    );

    const isCurrent = (job: ThreadRecapRequest) =>
      lock.withPermit(Effect.sync(() => jobs.get(job.threadId) === job));

    const finish = (job: ThreadRecapRequest) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (jobs.get(job.threadId) === job) jobs.delete(job.threadId);
          if (jobs.size === 0) yield* Deferred.succeed(idle, undefined);
        }),
      );

    const processNext = Effect.gen(function* () {
      const threadId = yield* Queue.take(queue);
      const job = yield* lock.withPermit(
        Effect.sync(() => {
          queued.delete(threadId);
          return jobs.get(threadId);
        }),
      );
      if (!job) return;
      yield* Effect.gen(function* () {
        const text = yield* host.generate({ threadId: job.threadId, runId: job.runId });
        // A newer run replaced this job while it ran; its own job writes the recap.
        if (!(yield* isCurrent(job))) return;
        yield* store.upsertThreadRecap({
          threadId: job.threadId,
          runId: job.runId,
          text,
          updatedAt: job.completedAt,
        });
      }).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) =>
            Effect.logWarning("A Thread recap could not be generated; keeping the previous one.", {
              threadId: job.threadId,
              runId: job.runId,
              cause: Cause.pretty(cause),
            }),
        ),
        Effect.ensuring(finish(job)),
      );
    });
    yield* processNext.pipe(Effect.forever, Effect.forkScoped);

    return ThreadRecapService.of({
      enqueue,
      awaitIdle: Effect.suspend(() => Deferred.await(idle)),
    });
  }),
);
