import {
  NodeId,
  RunId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchJiraOperationError,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { it as effectIt } from "@effect/vitest";
import * as NodeURL from "node:url";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
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
import { WorkbenchJiraService } from "./jira/WorkbenchJiraService.ts";
import { seedNativeThread } from "./testing/nativeThreads.ts";
import { TicketExecutionReactor, layer as reactorLayer } from "./TicketExecutionReactor.ts";
import {
  nativeEngineLayer,
  projectId,
  workspaceId,
  now,
  persistenceLayer,
  reactorServices,
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

const seedJiraOwnership = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO workbench_jira_connections (connection_id, cloud_id, credential_id, site_name, site_url, scopes_json, created_at, updated_at) VALUES ('connection', 'cloud', 'credential', 'Site', 'https://example.test', '[]', ${now}, ${now})`;
  yield* sql`INSERT INTO workbench_jira_bindings (binding_id, workbench_project_id, connection_id, jira_project_id, jira_project_key, jira_project_name, board_id, board_name, sprint_id, sprint_name, default_primary_t3_project_id, default_repository_project_ids_json, status_mappings_json, active, created_at, updated_at) VALUES ('binding', ${workspaceId}, 'connection', 'project', 'WB', 'Jira', 1, 'Board', 1, 'Sprint', ${projectId}, '[]', '[]', 0, ${now}, ${now})`;
  yield* sql`INSERT INTO workbench_jira_issue_links (binding_id, jira_issue_id, ticket_id, issue_json, active, linked_at, last_seen_at) VALUES ('binding', 'issue', ${ticketId}, '{}', 0, ${now}, ${now})`;
});

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

  effectIt.effect(
    "holds the cursor behind a failed local transition and replays the entire remaining lane on restart",
    () =>
      Effect.gen(function* () {
        yield* seed;
        const sql = yield* SqlClient.SqlClient;
        const sink = yield* EventSinkV2;
        const store = yield* WorkbenchStore;
        const projections = yield* ProjectionStoreV2;
        yield* sql`CREATE TRIGGER reject_execution BEFORE UPDATE OF status ON workbench_tickets WHEN NEW.status = 'in_progress' BEGIN SELECT RAISE(ABORT, 'execution fault'); END`;
        const target = yield* Effect.gen(function* () {
          const reactor = yield* TicketExecutionReactor;
          yield* reactor.start();
          const events = yield* sink.write({
            events: [runEvent(), runEvent({ id: RunId.make("second-run"), ordinal: 2 })],
          });
          yield* reactor.drainThrough(events.at(-1)!.sequence);
          return events.at(-1)!.sequence;
        }).pipe(Effect.provide(reactorServices), Effect.scoped);
        expect((yield* ticket(store)).status).toBe("todo");
        expect(yield* store.initializeTicketExecution).toBe(0);
        const failures = (yield* projections.getThreadProjection(threadId)).turnItems;
        expect(failures).toHaveLength(1);
        expect(failures[0]?.type).toBe("error");
        yield* sql`DROP TRIGGER reject_execution`;
        yield* Effect.gen(function* () {
          const reactor = yield* TicketExecutionReactor;
          yield* reactor.start();
          yield* reactor.drainThrough(yield* sink.latestSequence());
        }).pipe(Effect.provide(reactorServices), Effect.scoped);
        expect((yield* ticket(store)).status).toBe("in_progress");
        expect((yield* ticket(store)).revision).toBe(1);
        expect(yield* store.initializeTicketExecution).toBe(target);
        expect((yield* projections.getThreadProjection(threadId)).turnItems).toEqual(failures);
      }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  effectIt.effect(
    "retains uncertain Jira outcomes independently of later local Tickets and resumes through readback only",
    () =>
      Effect.gen(function* () {
        yield* seed;
        const store = yield* WorkbenchStore;
        const sink = yield* EventSinkV2;
        yield* seedJiraOwnership;
        const otherThread = ThreadId.make("local-execution-thread");
        const otherTicket = WorkbenchTicketId.make("local-execution-ticket");
        yield* seedNativeThread({ threadId: otherThread, projectId, createdAt: now });
        yield* store.createTicket({
          id: otherTicket,
          projectId: workspaceId,
          title: "Local",
          kind: "story",
          markdown: "",
          primaryT3ProjectId: projectId,
          createdAt: now,
        });
        yield* store.createAssignment({
          id: WorkbenchAssignmentId.make("local-assignment"),
          ticketId: otherTicket,
          threadId: otherThread,
          createdAt: now,
        });
        const attempts = yield* Ref.make<ReadonlyArray<boolean>>([]);
        const services = reactorLayer.pipe(
          Layer.provide(nativeEngineLayer),
          Layer.provide(
            Layer.mock(WorkbenchJiraService)({
              startTicketExecution: (input) =>
                Ref.update(attempts, (values) => [
                  ...values,
                  input.execution?.readbackOnly ?? false,
                ]).pipe(
                  Effect.andThen(
                    Effect.fail(
                      new WorkbenchJiraOperationError({
                        code: "request_failed",
                        message: "Possibly reached Jira",
                      }),
                    ),
                  ),
                ),
            }),
          ),
        );
        yield* Effect.gen(function* () {
          const reactor = yield* TicketExecutionReactor;
          yield* reactor.start();
          const other = runEvent({ id: RunId.make("local-run") });
          const committed = yield* sink.write({
            events: [
              runEvent(),
              {
                ...other,
                threadId: otherThread,
                payload: { ...other.payload, threadId: otherThread },
              },
            ],
          });
          yield* reactor.drainThrough(committed.at(-1)!.sequence);
        }).pipe(Effect.provide(services), Effect.scoped);
        expect((yield* ticket(store)).status).toBe("todo");
        expect(
          (yield* store.getSnapshot).tickets.find((candidate) => candidate.id === otherTicket)
            ?.status,
        ).toBe("in_progress");
        expect((yield* store.pendingTicketExecutions).map((run) => run.state)).toEqual([
          "uncertain",
        ]);
        expect(yield* Ref.get(attempts)).toEqual([false]);
        yield* Effect.gen(function* () {
          const reactor = yield* TicketExecutionReactor;
          yield* reactor.start();
          yield* reactor.drain;
        }).pipe(Effect.provide(services), Effect.scoped);
        expect(yield* Ref.get(attempts)).toEqual([false, true]);
        expect((yield* store.pendingTicketExecutions).map((run) => run.state)).toEqual([
          "uncertain",
        ]);
      }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  effectIt.effect(
    "retires uncertain execution obligations invalidated by archive, deletion, supersession or a reset",
    () =>
      Effect.gen(function* () {
        for (const invalidation of ["archive", "delete", "supersede", "reset"] as const) {
          yield* Effect.gen(function* () {
            yield* seed;
            yield* seedJiraOwnership;
            const sql = yield* SqlClient.SqlClient;
            const store = yield* WorkbenchStore;
            const sink = yield* EventSinkV2;
            yield* store.initializeTicketExecution;
            const event = runEvent();
            const committed = yield* sink.write({ events: [event] });
            const sequence = committed[0]!.sequence;
            const pending = yield* store.consumeTicketExecution({
              sequence,
              run: { id: event.payload.id, threadId, startedAt: now },
            });
            expect(pending?.state).toBe("pending");
            expect(yield* store.beginTicketExecutionJira(event.payload.id)).toBe("start");
            expect((yield* store.pendingTicketExecutions)[0]?.state).toBe("uncertain");
            // These rows represent lifecycle changes made by other Workbench writers before resumption.
            if (invalidation === "archive")
              yield* sql`UPDATE workbench_tickets SET archived_at = ${now} WHERE ticket_id = ${ticketId}`;
            if (invalidation === "delete")
              yield* sql`UPDATE workbench_tickets SET deleted_at = ${now} WHERE ticket_id = ${ticketId}`;
            if (invalidation === "supersede")
              yield* sql`UPDATE workbench_assignments SET superseded_at = ${now} WHERE ticket_id = ${ticketId}`;
            if (invalidation === "reset")
              yield* sql`UPDATE workbench_tickets SET execution_after_sequence = ${sequence} WHERE ticket_id = ${ticketId}`;
            expect(yield* store.beginTicketExecutionJira(event.payload.id)).toBe("skip");
            expect(yield* store.pendingTicketExecutions).toEqual([]);
          }).pipe(Effect.provide(testLayer), Effect.scoped);
        }
      }),
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
});
