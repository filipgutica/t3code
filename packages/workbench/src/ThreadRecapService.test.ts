import {
  ProjectId,
  RunId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchOperationError,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { ThreadRecapHost } from "./ThreadRecapHost.ts";
import { ThreadRecapService, ThreadRecapServiceLive } from "./ThreadRecapService.ts";
import { WorkbenchNativeAccess } from "./WorkbenchNativeAccess.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "./WorkbenchStore.ts";

const projectId = ProjectId.make("recap-project");
const workspaceId = WorkbenchProjectId.make("recap-workspace");
const ticketId = WorkbenchTicketId.make("recap-ticket");
const threadId = ThreadId.make("recap-thread");
const siblingId = ThreadId.make("recap-sibling");
const createdAt = "2026-10-20T10:00:00.000Z";
const run = (ordinal: number) => ({
  threadId,
  runId: RunId.make(`run-${ordinal}`),
  completedAt: `2026-10-20T1${ordinal}:00:00.000Z`,
});

const storeLayer = WorkbenchStoreLive.pipe(
  Layer.provide(
    Layer.succeed(WorkbenchNativeAccess, {
      findProject: (id) => Effect.succeedSome({ id, workspaceRoot: `/repos/${id}` }),
      isRepository: () => Effect.succeed(true),
      findThread: (id) => Effect.succeedSome({ id, projectId }),
      hasThreadAtWorktreePath: () => Effect.succeed(false),
      findStartingRun: () => Effect.succeedNone,
      contextMarker: () => Effect.succeed(0),
      findRun: () => Effect.succeedNone,
      executionSequence: Effect.succeed(0),
      startedExecutionRunIds: Effect.succeed([]),
      hasPendingThreadWork: () => Effect.succeed(false),
    }),
  ),
  Layer.provide(NodeSqliteClient.layer({ filename: ":memory:" })),
  Layer.provideMerge(NodeCrypto.layer),
);

const withRecapHost =
  (host: ThreadRecapHost["Service"]) =>
  <A, E>(test: Effect.Effect<A, E, WorkbenchStore | ThreadRecapService>) =>
    test.pipe(
      Effect.provide(
        ThreadRecapServiceLive.pipe(
          Layer.provide(Layer.succeed(ThreadRecapHost, host)),
          Layer.provideMerge(storeLayer),
        ),
      ),
    );

const seedTicket = (threads: ReadonlyArray<ThreadId>) =>
  Effect.gen(function* () {
    const store = yield* WorkbenchStore;
    yield* store.createProject({
      id: workspaceId,
      title: "Recap workspace",
      linkedProjectIds: [projectId],
      createdAt,
    });
    yield* store.createTicket({
      id: ticketId,
      projectId: workspaceId,
      title: "Share progress",
      kind: "story",
      markdown: "",
      primaryT3ProjectId: projectId,
      createdAt,
    });
    for (const id of threads) {
      yield* store.createAssignment({
        id: WorkbenchAssignmentId.make(`assignment-${id}`),
        ticketId,
        threadId: id,
        createdAt,
      });
    }
  });

const recaps = Effect.flatMap(WorkbenchStore, (store) => store.getCompactSnapshot).pipe(
  Effect.map((snapshot) => snapshot.threadRecaps),
);

describe("ThreadRecapService", () => {
  it.effect("recaps a ticket's only Thread, and skips a Thread outside any ticket", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const service = yield* ThreadRecapService;
        yield* service.enqueue({ ...run(1), threadId: siblingId });
        yield* service.awaitIdle;
        expect(yield* Ref.get(calls)).toBe(0);
        yield* seedTicket([threadId]);
        yield* service.enqueue(run(1));
        yield* service.awaitIdle;
        expect(yield* Ref.get(calls)).toBe(1);
        expect((yield* recaps).map((recap) => recap.threadId)).toEqual([threadId]);
      }).pipe(
        withRecapHost({ generate: () => Ref.update(calls, (n) => n + 1).pipe(Effect.as("x")) }),
      );
    }),
  );

  it.effect("lets a newer run supersede an in-flight recap", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        const service = yield* ThreadRecapService;
        yield* seedTicket([threadId, siblingId]);
        yield* service.enqueue(run(1));
        yield* Deferred.await(started);
        yield* service.enqueue(run(2));
        yield* Deferred.succeed(release, undefined);
        yield* service.awaitIdle;
        expect(yield* recaps).toEqual([
          { threadId, text: "Recap of run-2", updatedAt: run(2).completedAt },
        ]);
      }).pipe(
        withRecapHost({
          generate: ({ runId }) =>
            runId === run(1).runId
              ? Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.as("Recap of run-1"),
                )
              : Effect.succeed(`Recap of ${runId}`),
        }),
      );
    }),
  );

  it.effect("keeps the previous recap when generation fails and ignores replayed runs", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<RunId>>([]);
      yield* Effect.gen(function* () {
        const service = yield* ThreadRecapService;
        yield* seedTicket([threadId, siblingId]);
        yield* service.enqueue(run(1));
        yield* service.awaitIdle;
        yield* service.enqueue(run(2));
        yield* service.awaitIdle;
        expect(yield* recaps).toEqual([
          { threadId, text: "Recap of run-1", updatedAt: run(1).completedAt },
        ]);
        yield* service.enqueue(run(1));
        yield* service.awaitIdle;
        expect(yield* Ref.get(calls)).toEqual([run(1).runId, run(2).runId]);
      }).pipe(
        withRecapHost({
          generate: ({ runId }) =>
            Ref.update(calls, (all) => [...all, runId]).pipe(
              Effect.andThen(
                runId === run(2).runId
                  ? Effect.fail(
                      new WorkbenchOperationError({
                        code: "thread_recap_generation_failed",
                        message: "Provider unavailable.",
                      }),
                    )
                  : Effect.succeed(`Recap of ${runId}`),
              ),
            ),
        }),
      );
    }),
  );
});
