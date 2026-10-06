import {
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeURL from "node:url";
import { runMigrations } from "../../persistence/Migrations.ts";
import * as GitWorkflowService from "../../git/GitWorkflowService.ts";
import { EventSinkV2, layer as eventSinkLayer } from "../../orchestration-v2/EventSink.ts";
import { layer as eventStoreLayer } from "../../orchestration-v2/EventStore.ts";
import {
  ProjectionStoreV2,
  layer as projectionLayer,
} from "../../orchestration-v2/ProjectionStore.ts";
import { OrchestratorV2 } from "../../orchestration-v2/Orchestrator.ts";
import { ServerActivation } from "../../serverActivation.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "../WorkbenchStore.ts";
import { WorkbenchJiraService } from "../jira/WorkbenchJiraService.ts";
import { TicketExecutionReactor, layer as reactorLayer } from "../TicketExecutionReactor.ts";
import { seedNativeThread } from "./nativeThreads.ts";

const encodeResult = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ status: Schema.String, revision: Schema.Number })),
);

export const projectId = ProjectId.make("execution-restart-project");
export const workspaceId = WorkbenchProjectId.make("execution-restart-workspace");
export const threadId = ThreadId.make("execution-restart-thread");
export const ticketId = WorkbenchTicketId.make("execution-restart-ticket");
export const now = "2026-10-03T10:00:00.000Z";
const runId = RunId.make("execution-restart-run");
export const runEvent = ({
  id = runId,
  status = "running",
  ordinal = 1,
}: {
  readonly id?: RunId;
  readonly status?: "queued" | "starting" | "running" | "completed";
  readonly ordinal?: number;
} = {}): Extract<OrchestrationV2DomainEvent, { type: "run.updated" }> => ({
  id: EventId.make(`event-${id}-${status}`),
  type: "run.updated",
  threadId,
  occurredAt: DateTime.makeUnsafe(now),
  payload: {
    id,
    threadId,
    ordinal,
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "default" },
    providerThreadId: null,
    userMessageId: MessageId.make(`user-${id}`),
    rootNodeId: NodeId.make(`root-${id}`),
    activeAttemptId: null,
    status,
    requestedAt: DateTime.makeUnsafe(now),
    startedAt: status === "queued" || status === "starting" ? null : DateTime.makeUnsafe(now),
    completedAt: status === "completed" ? DateTime.makeUnsafe(now) : null,
    checkpointId: null,
    contextHandoffId: null,
  },
});

export const persistenceLayer = (filename: string) =>
  Layer.effectDiscard(runMigrations()).pipe(
    Layer.provideMerge(NodeSqliteClient.layer({ filename })),
  );
export const servicesLayer = Layer.mergeAll(
  projectionLayer,
  WorkbenchStoreLive.pipe(
    Layer.provide(
      Layer.mock(GitWorkflowService.GitWorkflowService)({
        isRepository: () => Effect.succeed(true),
      }),
    ),
  ),
  eventSinkLayer.pipe(Layer.provide(Layer.mergeAll(eventStoreLayer, projectionLayer))),
);
export const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES (${projectId}, 'Execution', '/tmp/execution-restart', '[]', ${now}, ${now})`;
  yield* seedNativeThread({ threadId, projectId, createdAt: now });
  const store = yield* WorkbenchStore;
  yield* store.createProject({
    id: workspaceId,
    title: "Execution",
    linkedProjectIds: [projectId],
    createdAt: now,
  });
  yield* store.createTicket({
    id: ticketId,
    projectId: workspaceId,
    title: "Restart",
    kind: "story",
    markdown: "Restart",
    primaryT3ProjectId: projectId,
    createdAt: now,
  });
  yield* store.createAssignment({
    id: WorkbenchAssignmentId.make("execution-restart-assignment"),
    ticketId,
    threadId,
    createdAt: now,
  });
});

export const nativeEngineLayer = Layer.unwrap(
  Effect.gen(function* () {
    const projections = yield* ProjectionStoreV2;
    return Layer.mock(OrchestratorV2)({
      getShellSnapshot: () => projections.getShellSnapshot().pipe(Effect.orDie),
      getThreadShell: (id: ThreadId) => projections.getThreadShell(id).pipe(Effect.orDie),
    });
  }),
);
export const reactorServices = reactorLayer.pipe(
  Layer.provide(
    Layer.mock(WorkbenchJiraService)({
      startTicketExecution: () => Effect.die("Unexpected Jira write"),
    }),
  ),
  Layer.provide(nativeEngineLayer),
);

// Each phase runs in a separate Node process and opens the same disk database.
const main = (filename: string, phase: string) =>
  Effect.gen(function* () {
    const store = yield* WorkbenchStore;
    const sink = yield* EventSinkV2;
    if (
      phase === "crash-running" ||
      phase === "crash-completed" ||
      phase === "upgrade-queued" ||
      phase === "upgrade-starting" ||
      phase === "upgrade-started"
    ) {
      yield* seed;
      const activation = yield* Deferred.make<void>();
      return yield* Effect.gen(function* () {
        const reactor = yield* TicketExecutionReactor;
        if (
          phase !== "upgrade-queued" &&
          phase !== "upgrade-starting" &&
          phase !== "upgrade-started"
        )
          yield* reactor.start();
        yield* sink.write({
          events: [
            runEvent({
              status:
                phase === "upgrade-queued"
                  ? "queued"
                  : phase === "upgrade-starting"
                    ? "starting"
                    : "running",
            }),
          ],
        });
        if (phase === "crash-completed")
          yield* sink.write({ events: [runEvent({ status: "completed" })] });
        // Exit after the native commit while consumption is parked: no finalizers or in-memory state survive.
        process.exit(0);
      }).pipe(
        Effect.provide(reactorServices),
        Effect.provideService(ServerActivation, Deferred.await(activation)),
        Effect.scoped,
      );
    }
    if (phase === "consume" || phase === "reset-replay" || phase === "upgrade-resume") {
      yield* Effect.gen(function* () {
        const reactor = yield* TicketExecutionReactor;
        yield* reactor.start();
        if (phase === "reset-replay") {
          const ticket = (yield* store.getSnapshot).tickets[0]!;
          yield* store.updateTicket({
            id: ticketId,
            expectedRevision: ticket.revision,
            status: "todo",
            updatedAt: now,
          });
          yield* sink.write({ events: [{ ...runEvent(), id: EventId.make("repeated-running") }] });
        }
        if (phase === "upgrade-resume") {
          yield* sink.write({
            events: [{ ...runEvent(), id: EventId.make("running-after-upgrade") }],
          });
        }
        yield* reactor.drainThrough(yield* sink.latestSequence());
      }).pipe(Effect.provide(reactorServices), Effect.scoped);
      const ticket = (yield* store.getSnapshot).tickets[0]!;
      const output = yield* encodeResult({ status: ticket.status, revision: ticket.revision });
      process.stdout.write(output);
    }
  }).pipe(
    Effect.provide(servicesLayer.pipe(Layer.provideMerge(persistenceLayer(filename)))),
    Effect.scoped,
  );

if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href) {
  const filename = process.argv[2];
  const phase = process.argv[3];
  if (!filename || !phase) throw new Error("Expected database path and restart phase");
  await Effect.runPromise(main(filename, phase));
}
