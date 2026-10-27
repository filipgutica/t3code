import {
  NodeId,
  RunId,
  ThreadId as ThreadIdSchema,
  WorkbenchAssignmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { it as effectIt } from "@effect/vitest";
import * as NodeURL from "node:url";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as SqlClient from "effect/sql/SqlClient";
import { describe, expect } from "vite-plus/test";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import { ServerActivation } from "../serverActivation.ts";
import { WorkbenchStore } from "./WorkbenchStore.ts";
import { TicketExecutionReactor } from "./TicketExecutionReactor.ts";
import { ThreadRecapService } from "./ThreadRecapService.ts";
import { seedNativeThread } from "./testing/nativeThreads.ts";
import {
  now,
  persistenceLayer,
  projectId,
  reactorServices,
  reactorServicesWithoutRecaps,
  runEvent,
  seed,
  servicesLayer,
  ticketId,
  threadId,
} from "./testing/executionRestart.ts";

const fixture = NodeURL.fileURLToPath(new URL("./testing/executionRestart.ts", import.meta.url));
const phase = (filename: string, name: string) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(
      ChildProcess.make(process.execPath, [fixture, filename, name]),
    );
    const [output, errors, exitCode] = yield* Effect.all(
      [
        Stream.mkString(Stream.decodeText(handle.stdout)),
        Stream.mkString(Stream.decodeText(handle.stderr)),
        handle.exitCode,
      ],
      { concurrency: "unbounded" },
    );
    if (exitCode !== 0)
      return yield* Effect.die(new Error(`Execution phase ${name} exited ${exitCode}: ${errors}`));
    return output;
  });
const withDatabase = <A, E, R>(body: (filename: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "workbench-execution-restart-" });
    return yield* body(path.join(directory, "state.sqlite"));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);
const decodeResult = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ status: Schema.String, revision: Schema.Number })),
);

const testLayer = servicesLayer.pipe(Layer.provideMerge(persistenceLayer(":memory:")));
const ticket = (store: WorkbenchStore["Service"]) =>
  store.getSnapshot.pipe(
    Effect.map((snapshot) => snapshot.tickets.find((candidate) => candidate.id === ticketId)!),
  );

describe("durable Workbench execution consumption", () => {
  effectIt.effect.each(["running", "completed"])(
    "recovers a %s native run committed before a process crash",
    (status) =>
      withDatabase((filename) =>
        Effect.gen(function* () {
          yield* phase(filename, `crash-${status}`);
          expect(yield* decodeResult(yield* phase(filename, "consume"))).toEqual({
            status: "in_progress",
            revision: 1,
          });
          // A second runtime does not apply the completed local transition again.
          expect(yield* decodeResult(yield* phase(filename, "consume"))).toEqual({
            status: "in_progress",
            revision: 1,
          });
        }),
      ),
  );

  effectIt.effect(
    "preserves an explicit Todo reset across repeated running updates and restarts",
    () =>
      withDatabase((filename) =>
        Effect.gen(function* () {
          yield* phase(filename, "crash-running");
          yield* phase(filename, "consume");
          expect(yield* decodeResult(yield* phase(filename, "reset-replay"))).toEqual({
            status: "todo",
            revision: 2,
          });
          expect(yield* decodeResult(yield* phase(filename, "consume"))).toEqual({
            status: "todo",
            revision: 2,
          });
        }),
      ),
  );

  effectIt.effect.each(["queued", "starting", "started"])(
    "initializes an upgrade baseline with an existing %s run",
    (status) =>
      withDatabase((filename) =>
        Effect.gen(function* () {
          yield* phase(filename, `upgrade-${status}`);
          expect(yield* decodeResult(yield* phase(filename, "upgrade-resume"))).toEqual({
            status: status === "started" ? "todo" : "in_progress",
            revision: status === "started" ? 0 : 1,
          });
        }),
      ),
  );

  effectIt.effect(
    "excludes already-persisted first-running events after reset, reassign, archive or deletion",
    () =>
      Effect.gen(function* () {
        for (const action of ["reset", "reassign", "archive", "delete"] as const) {
          yield* Effect.gen(function* () {
            yield* seed;
            const store = yield* WorkbenchStore;
            const sink = yield* EventSinkV2;
            const activation = yield* Deferred.make<void>();
            yield* Effect.gen(function* () {
              const reactor = yield* TicketExecutionReactor;
              yield* reactor.start();
              const committed = yield* sink.write({ events: [runEvent()] });
              const before = yield* ticket(store);
              if (action === "reset")
                yield* store.updateTicket({
                  id: ticketId,
                  expectedRevision: before.revision,
                  status: "todo",
                  updatedAt: now,
                });
              if (action === "reassign") {
                yield* store.unlinkAssignment({ ticketId, threadId });
                yield* store.createAssignment({
                  id: WorkbenchAssignmentId.make("replacement"),
                  ticketId,
                  threadId,
                  createdAt: now,
                });
              }
              if (action === "archive")
                yield* store.archiveTicket({
                  ticketId,
                  expectedRevision: before.revision,
                  archivedAt: now,
                  updatedAt: now,
                });
              if (action === "delete")
                yield* store.deleteTicket({
                  ticketId,
                  expectedRevision: before.revision,
                  deletedAt: now,
                });
              yield* Deferred.succeed(activation, undefined);
              yield* reactor.drainThrough(committed[0]!.sequence);
              if (action === "delete") expect((yield* store.getSnapshot).tickets).toHaveLength(0);
              else expect((yield* ticket(store)).status).toBe("todo");
            }).pipe(
              Effect.provide(reactorServices),
              Effect.provideService(ServerActivation, Deferred.await(activation)),
              Effect.scoped,
            );
          }).pipe(Effect.provide(testLayer), Effect.scoped);
        }
      }),
  );

  effectIt.effect.each([1, 3])(
    "recovers after %s local failures without skipping the remaining lane or restarting",
    (failureCount) =>
      Effect.gen(function* () {
        yield* seed;
        const sql = yield* SqlClient.SqlClient;
        const sink = yield* EventSinkV2;
        const store = yield* WorkbenchStore;
        const projections = yield* ProjectionStoreV2;
        yield* sql`CREATE TRIGGER reject_execution BEFORE UPDATE OF status ON workbench_tickets WHEN NEW.status = 'in_progress' BEGIN SELECT RAISE(ABORT, 'execution fault'); END`;
        const failed = yield* Deferred.make<void>();
        const attempts = yield* Ref.make(0);
        const observedStore = WorkbenchStore.of({
          ...store,
          consumeTicketExecution: (input) =>
            store
              .consumeTicketExecution(input)
              .pipe(
                Effect.tapError(() =>
                  Ref.updateAndGet(attempts, (count) => count + 1).pipe(
                    Effect.flatMap((count) =>
                      count === failureCount ? Deferred.succeed(failed, undefined) : Effect.void,
                    ),
                  ),
                ),
              ),
        });
        yield* Effect.gen(function* () {
          const reactor = yield* TicketExecutionReactor;
          yield* reactor.start();
          const events = yield* sink.write({
            events: [runEvent(), runEvent({ id: RunId.make("second-run"), ordinal: 2 })],
          });
          if (failureCount > 1) yield* TestClock.adjust("750 millis");
          yield* Deferred.await(failed);
          expect((yield* ticket(store)).status).toBe("todo");
          expect(yield* store.initializeTicketExecution).toBe(0);
          yield* sql`DROP TRIGGER reject_execution`;
          yield* TestClock.adjust("1 second");
          expect((yield* ticket(store)).status).toBe("in_progress");
          yield* reactor.drainThrough(events.at(-1)!.sequence);
          expect((yield* ticket(store)).revision).toBe(1);
          expect(yield* store.initializeTicketExecution).toBe(events.at(-1)!.sequence);
          const failures = (yield* projections.getThreadProjection(threadId)).turnItems;
          expect(failures).toHaveLength(failureCount === 1 ? 0 : 1);
        }).pipe(
          Effect.provide(
            reactorServices.pipe(Layer.provide(Layer.succeed(WorkbenchStore, observedStore))),
          ),
          Effect.scoped,
        );
      }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  effectIt.effect("backs off across persistent failures after replaying ignored events", () =>
    Effect.gen(function* () {
      yield* seed;
      const sql = yield* SqlClient.SqlClient;
      const sink = yield* EventSinkV2;
      const store = yield* WorkbenchStore;
      yield* sql`CREATE TRIGGER reject_execution BEFORE UPDATE OF status ON workbench_tickets WHEN NEW.status = 'in_progress' BEGIN SELECT RAISE(ABORT, 'execution fault'); END`;
      const subscriptions: number[] = [];
      let failAfterRecovery = false;
      const observedSink = EventSinkV2.of({
        ...sink,
        stream: (input) => {
          subscriptions.push(input?.afterSequence ?? 0);
          if (failAfterRecovery) {
            failAfterRecovery = false;
            return Stream.concat(
              sink.stream(input).pipe(Stream.take(2)),
              Stream.die("stream fault"),
            );
          }
          return sink.stream(input);
        },
      });
      yield* Effect.gen(function* () {
        const reactor = yield* TicketExecutionReactor;
        yield* reactor.start();
        const events = yield* sink.write({
          events: [runEvent({ status: "queued" }), runEvent()],
        });
        yield* TestClock.adjust("750 millis");
        expect(subscriptions).toEqual([0]);
        for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]) {
          const count = subscriptions.length;
          yield* TestClock.adjust(delay - 1);
          expect(subscriptions).toHaveLength(count);
          yield* TestClock.adjust(1);
          expect(subscriptions).toHaveLength(count + 1);
          yield* TestClock.adjust("750 millis");
          expect(yield* store.initializeTicketExecution).toBe(0);
          expect((yield* ticket(store)).status).toBe("todo");
        }
        expect(subscriptions.every((sequence) => sequence === 0)).toBe(true);
        yield* sql`DROP TRIGGER reject_execution`;
        failAfterRecovery = true;
        yield* TestClock.adjust("30 seconds");
        yield* reactor.drainThrough(events.at(-1)!.sequence);
        expect((yield* ticket(store)).status).toBe("in_progress");
        expect((yield* ticket(store)).revision).toBe(1);
        expect(yield* store.initializeTicketExecution).toBe(events.at(-1)!.sequence);
        const count = subscriptions.length;
        yield* TestClock.adjust("999 millis");
        expect(subscriptions).toHaveLength(count);
        yield* TestClock.adjust("1 milli");
        expect(subscriptions).toHaveLength(count + 1);
        expect(subscriptions.at(-1)).toBe(events.at(-1)!.sequence);
      }).pipe(
        Effect.provide(
          reactorServices.pipe(Layer.provide(Layer.succeed(EventSinkV2, observedSink))),
        ),
        Effect.scoped,
      );
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  effectIt.effect("resubscribes after an event stream failure from the durable cursor", () =>
    Effect.gen(function* () {
      yield* seed;
      const store = yield* WorkbenchStore;
      const sink = yield* EventSinkV2;
      const failed = yield* Deferred.make<void>();
      let subscriptions = 0;
      const observedSink = EventSinkV2.of({
        ...sink,
        stream: (input) => {
          subscriptions += 1;
          return subscriptions === 1
            ? Stream.concat(
                sink.stream(input).pipe(Stream.take(1)),
                Stream.fromEffect(Deferred.succeed(failed, undefined)).pipe(
                  Stream.flatMap(() => Stream.die("stream fault")),
                ),
              )
            : sink.stream(input);
        },
      });
      yield* Effect.gen(function* () {
        const reactor = yield* TicketExecutionReactor;
        yield* reactor.start();
        const first = yield* sink.write({ events: [runEvent()] });
        yield* Deferred.await(failed);
        yield* reactor.drainThrough(first[0]!.sequence);
        expect(yield* store.initializeTicketExecution).toBe(first[0]!.sequence);
        const events = yield* sink.write({
          events: [runEvent({ id: RunId.make("after-stream-failure"), ordinal: 2 })],
        });
        yield* TestClock.adjust("1 second");
        expect((yield* ticket(store)).status).toBe("in_progress");
        expect(yield* store.initializeTicketExecution).toBe(events[0]!.sequence);
        yield* reactor.drainThrough(events[0]!.sequence);
        expect((yield* ticket(store)).revision).toBe(1);
      }).pipe(
        Effect.provide(
          reactorServices.pipe(Layer.provide(Layer.succeed(EventSinkV2, observedSink))),
        ),
        Effect.scoped,
      );
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  effectIt.effect(
    "ignores queued, starting, missing-start-time, child-node and child-thread execution",
    () =>
      Effect.gen(function* () {
        for (const shape of [
          "queued",
          "starting",
          "missing-time",
          "child-node",
          "child-thread",
        ] as const) {
          yield* Effect.gen(function* () {
            yield* seed;
            const sql = yield* SqlClient.SqlClient;
            const store = yield* WorkbenchStore;
            const sink = yield* EventSinkV2;
            if (shape === "child-thread")
              yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json = json_set(payload_json, '$.lineage.parentThreadId', 'parent', '$.lineage.relationshipToParent', 'subagent') WHERE thread_id = ${threadId}`;
            const base = runEvent({
              status: shape === "queued" || shape === "starting" ? shape : "running",
            });
            const event =
              shape === "missing-time"
                ? { ...base, payload: { ...base.payload, startedAt: null } }
                : shape === "child-node"
                  ? { ...base, nodeId: NodeId.make("child-node") }
                  : base;
            yield* Effect.gen(function* () {
              const reactor = yield* TicketExecutionReactor;
              yield* reactor.start();
              const committed = yield* sink.write({ events: [event] });
              yield* reactor.drainThrough(committed[0]!.sequence);
            }).pipe(Effect.provide(reactorServices), Effect.scoped);
            expect((yield* ticket(store)).status).toBe("todo");
          }).pipe(Effect.provide(testLayer), Effect.scoped);
        }
      }),
  );

  effectIt.effect("schedules a recap only when a root run finishes", () =>
    Effect.gen(function* () {
      yield* seed;
      const sink = yield* EventSinkV2;
      const scheduled = yield* Ref.make<
        ReadonlyArray<{ readonly threadId: ThreadId; readonly runId: RunId }>
      >([]);
      const recaps = ThreadRecapService.of({
        enqueue: ({ threadId, runId }) =>
          Ref.update(scheduled, (all) => [...all, { threadId, runId }]),
        awaitIdle: Effect.void,
      });
      const run = (name: string) => RunId.make(`recap-${name}`);
      const finished = runEvent({ id: run("completed"), status: "completed" });
      const failed = runEvent({ id: run("failed"), status: "completed", ordinal: 2 });
      const neverStarted = runEvent({ id: run("never-started"), status: "completed", ordinal: 3 });
      const childNode = runEvent({ id: run("child-node"), status: "completed", ordinal: 4 });
      yield* Effect.gen(function* () {
        const reactor = yield* TicketExecutionReactor;
        yield* reactor.start();
        const events = yield* sink.write({
          events: [
            runEvent({ id: run("completed") }),
            finished,
            { ...failed, payload: { ...failed.payload, status: "failed", completedAt: null } },
            { ...neverStarted, payload: { ...neverStarted.payload, startedAt: null } },
            { ...childNode, nodeId: NodeId.make("child-node") },
          ],
        });
        yield* reactor.drainThrough(events.at(-1)!.sequence);
        expect(yield* Ref.get(scheduled)).toEqual([
          { threadId, runId: run("completed") },
          { threadId, runId: run("failed") },
        ]);
      }).pipe(
        Effect.provide(
          reactorServicesWithoutRecaps.pipe(
            Layer.provide(Layer.succeed(ThreadRecapService, recaps)),
          ),
        ),
        Effect.scoped,
      );
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  effectIt.effect("re-offers the latest finished run of shared ticket Threads on start", () =>
    Effect.gen(function* () {
      yield* seed;
      const sibling = ThreadIdSchema.make("execution-restart-sibling");
      yield* seedNativeThread({ threadId: sibling, projectId, createdAt: now });
      const store = yield* WorkbenchStore;
      yield* store.createAssignment({
        id: WorkbenchAssignmentId.make("execution-restart-sibling-assignment"),
        ticketId,
        threadId: sibling,
        createdAt: now,
      });
      const sink = yield* EventSinkV2;
      const missed = RunId.make("recap-missed");
      // Written before the cursor exists, so only recovery can schedule its recap.
      yield* sink.write({ events: [runEvent({ id: missed, status: "completed" })] });
      const offered = yield* Deferred.make<{
        readonly threadId: ThreadId;
        readonly runId: RunId;
      }>();
      const recaps = ThreadRecapService.of({
        enqueue: ({ threadId, runId }) => Deferred.succeed(offered, { threadId, runId }),
        awaitIdle: Effect.void,
      });
      yield* Effect.gen(function* () {
        const reactor = yield* TicketExecutionReactor;
        yield* reactor.start();
        expect(yield* Deferred.await(offered)).toEqual({ threadId, runId: missed });
      }).pipe(
        Effect.provide(
          reactorServicesWithoutRecaps.pipe(
            Layer.provide(Layer.succeed(ThreadRecapService, recaps)),
          ),
        ),
        Effect.scoped,
      );
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );
});
