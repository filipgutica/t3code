import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  EventId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as RuntimePolicy from "../orchestration-v2/RuntimePolicy.ts";
import type { ProviderAdapterV2Shape } from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";

// These metadata tests must not create checkpoint scopes or run Git effects.
const layerPlanningPolicy = Layer.effect(
  RuntimePolicy.RuntimePolicyV2,
  Effect.gen(function* () {
    const base = yield* RuntimePolicy.RuntimePolicyV2;
    return RuntimePolicy.RuntimePolicyV2.of({
      resolve: (input) =>
        base
          .resolve(input)
          .pipe(Effect.map((policy) => ({ ...policy, checkpoints: "disabled" as const }))),
    });
  }),
).pipe(Layer.provide(RuntimePolicy.layer));

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for metadata controls"),
} as ProviderAdapterV2Shape;
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  ProjectStore.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "workbench-thread-preparation" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    {
      databaseLayer: layerDatabase,
      runEffectWorker: false,
      runtimePolicyLayer: layerPlanningPolicy,
    },
  ),
);

const seedRebindThread = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const threadId = ThreadId.make("thread:rebind");
  const sourceProjectId = ProjectId.make("project:rebind-source");
  const projectId = ProjectId.make("project:rebind-target");
  const now = yield* DateTime.now;
  yield* projects.apply({
    sequence: 0,
    eventId: EventId.make("project:rebind-target"),
    aggregateKind: "project",
    aggregateId: projectId,
    occurredAt: DateTime.formatIso(now),
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "project.created",
    payload: {
      projectId,
      title: "Target repository",
      workspaceRoot: "/target-repo",
      defaultModelSelection: modelSelection,
      scripts: [],
      createdAt: DateTime.formatIso(now),
      updatedAt: DateTime.formatIso(now),
    },
  });
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make("create-rebind"),
    threadId,
    projectId: sourceProjectId,
    title: "Planning conversation",
    modelSelection,
    runtimeMode: "approval-required",
    interactionMode: "plan",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  const command = {
    type: "thread.metadata.update" as const,
    commandId: CommandId.make("rebind"),
    threadId,
    projectId,
    expectedProjectId: sourceProjectId,
    expectedWorktreePath: null,
    branch: null,
    worktreePath: null,
  };
  return { orchestrator, projects, projections, now, command };
});

it.effect.each([false, true])(
  "keeps creation retries idempotent and rejects another creator for an existing Thread ID (imported: %s)",
  (imported) =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = ThreadId.make("thread:create-ownership");
      const command = {
        type: "thread.create" as const,
        commandId: CommandId.make("create-ownership"),
        threadId,
        projectId: ProjectId.make("project:create-ownership"),
        title: "Original owner",
        modelSelection,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        createdBy: "user" as const,
        creationSource: "web" as const,
        ...(imported
          ? {
              importedNativeThread: {
                ref: {
                  driver: adapter.driver,
                  nativeId: "native-import-owner",
                  strength: "strong" as const,
                },
              },
            }
          : {}),
      };
      const created = yield* orchestrator.dispatch(command);
      yield* orchestrator.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make("rename-created-owner"),
        threadId,
        title: "Continued conversation",
      });
      const before = yield* projections.getThreadProjection(threadId);
      const retried = yield* orchestrator.dispatch(command);
      assert.deepEqual(retried.storedEvents, created.storedEvents);
      assert.deepEqual(yield* projections.getThreadProjection(threadId), before);
      const collision = yield* Effect.exit(
        orchestrator.dispatch({
          ...command,
          commandId: CommandId.make("another-creator"),
        }),
      );
      assert.equal(collision._tag, "Failure");
      assert.deepEqual(yield* projections.getThreadProjection(threadId), before);
      yield* orchestrator.dispatch({
        type: "thread.delete",
        commandId: CommandId.make("delete-created-owner"),
        threadId,
      });
      const deleted = yield* projections.getThread(threadId);
      assert.isNotNull(deleted.deletedAt);
      assert.equal(
        (yield* Effect.exit(
          orchestrator.dispatch({
            ...command,
            commandId: CommandId.make("reuse-deleted-owner-id"),
          }),
        ))._tag,
        "Failure",
      );
      yield* orchestrator.dispatch(command);
      assert.deepEqual(yield* projections.getThread(threadId), deleted);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("rebinds an idle conversation without losing history and detaches its old session", () =>
  Effect.gen(function* () {
    const { orchestrator, projections, now, command } = yield* seedRebindThread;
    const threadId = command.threadId;
    const sessionId = ProviderSessionId.make("session:rebind");
    yield* projections.apply({
      id: EventId.make("session:rebind"),
      type: "provider-session.attached",
      threadId,
      occurredAt: now,
      payload: {
        id: sessionId,
        driver: adapter.driver,
        providerInstanceId: instanceId,
        status: "ready",
        cwd: "/source-repo",
        model: modelSelection.model,
        capabilities: CodexProviderCapabilitiesV2,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      },
    });
    yield* projections.apply({
      id: EventId.make("message:rebind"),
      type: "message.updated",
      threadId,
      occurredAt: now,
      payload: {
        id: MessageId.make("message:rebind"),
        threadId,
        runId: null,
        nodeId: null,
        role: "assistant",
        createdBy: "agent",
        creationSource: "web",
        text: "The change belongs in the target repository.",
        attachments: [],
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    });
    const before = yield* projections.getThreadProjection(threadId);
    assert.lengthOf((yield* projections.getThreadProviderContext(threadId)).providerSessions, 1);
    const result = yield* orchestrator.dispatch(command);
    const after = yield* projections.getThreadProjection(threadId);
    assert.equal(after.thread.id, before.thread.id);
    assert.equal(after.thread.projectId, command.projectId);
    assert.isNull(after.thread.worktreePath);
    assert.deepEqual(after.thread.modelSelection, before.thread.modelSelection);
    assert.deepEqual(after.messages, before.messages);
    assert.deepEqual(after.providerSessions, []);
    assert.include(
      result.storedEvents.map(({ event }) => event.type),
      "provider-session.detached",
    );
    const shell = yield* projections.getThreadShell(threadId);
    assert.equal(shell?.projectId, command.projectId);
    // A second safe binding moves this conversation into an already prepared worktree.
    yield* orchestrator.dispatch({
      ...command,
      commandId: CommandId.make("bind-work-area"),
      expectedProjectId: command.projectId,
      worktreePath: "/target-worktree",
      branch: "feature/ticket",
    });
    assert.equal((yield* projections.getThread(threadId)).worktreePath, "/target-worktree");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("rejects stale, missing, or invalid destinations before rebinding", () =>
  Effect.gen(function* () {
    const { orchestrator, projections, command } = yield* seedRebindThread;
    const before = yield* projections.getThread(command.threadId);
    for (const [index, update] of [
      { expectedProjectId: command.projectId },
      { expectedProjectId: undefined },
      { expectedWorktreePath: undefined },
      { expectedWorktreePath: "/stale-worktree" },
      { projectId: ProjectId.make("missing-project") },
      { worktreePath: undefined },
      { branch: undefined },
    ].entries()) {
      const result = yield* Effect.exit(
        orchestrator.dispatch({
          ...command,
          ...update,
          commandId: CommandId.make(`invalid-rebind:${index}`),
        }),
      );
      assert.equal(result._tag, "Failure");
      assert.deepEqual(yield* projections.getThread(command.threadId), before);
    }
  }).pipe(Effect.provide(layerTest)),
);

it.effect("rejects rebinding with queued work or an unanswered runtime request", () =>
  Effect.gen(function* () {
    const { orchestrator, projections, now, command } = yield* seedRebindThread;
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("queue-before-rebind"),
      threadId: command.threadId,
      messageId: MessageId.make("queued-before-rebind"),
      text: "Continue planning",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "web",
    });
    assert.equal((yield* Effect.exit(orchestrator.dispatch(command)))._tag, "Failure");
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("queued-followup-before-rebind"),
      threadId: command.threadId,
      messageId: MessageId.make("queued-followup-before-rebind"),
      text: "A queued planning follow-up",
      attachments: [],
      dispatchMode: { type: "queue_after_active" },
      createdBy: "user",
      creationSource: "web",
    });
    const queued = yield* projections.getThreadRecords(command.threadId, ["runs"]);
    yield* projections.apply({
      id: EventId.make("cancel-before-rebind"),
      type: "run.updated",
      threadId: command.threadId,
      occurredAt: now,
      payload: { ...queued.runs[0]!, status: "cancelled", completedAt: now },
    });
    assert.equal(
      (yield* Effect.exit(
        orchestrator.dispatch({
          ...command,
          commandId: CommandId.make("rebind-queued-followup"),
        }),
      ))._tag,
      "Failure",
    );
    yield* orchestrator.dispatch({
      type: "queued-run.cancel",
      commandId: CommandId.make("cancel-queued-followup"),
      threadId: command.threadId,
      runId: queued.runs[1]!.id,
    });
    yield* projections.apply({
      id: EventId.make("request:rebind"),
      type: "runtime-request.updated",
      threadId: command.threadId,
      occurredAt: now,
      payload: {
        id: RuntimeRequestId.make("request:rebind"),
        nodeId: NodeId.make("node:rebind"),
        providerTurnId: null,
        nativeRequestRef: null,
        kind: "user_input",
        status: "pending",
        responseCapability: { type: "message" },
        createdAt: now,
        resolvedAt: null,
      },
    });
    assert.equal(
      (yield* Effect.exit(
        orchestrator.dispatch({
          ...command,
          commandId: CommandId.make("rebind-pending-request"),
        }),
      ))._tag,
      "Failure",
    );
    assert.equal(
      (yield* projections.getThread(command.threadId)).projectId,
      command.expectedProjectId,
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("starts and releases planning turns without preparing repository checkpoint scopes", () =>
  Effect.gen(function* () {
    const { orchestrator, projections, command } = yield* seedRebindThread;
    for (const [index, dispatchMode] of [
      { type: "start_immediately" as const },
      { type: "defer_start" as const },
    ].entries()) {
      const result = yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`checkpoint-free:${index}`),
        threadId: command.threadId,
        messageId: MessageId.make(`checkpoint-free:${index}`),
        text: "Prepare the ticket",
        attachments: [],
        dispatchMode,
        createdBy: "user",
        creationSource: "web",
      });
      assert.notInclude(
        result.storedEvents.map(({ event }) => event.type),
        "checkpoint-scope.created",
      );
      const projection = yield* projections.getThreadProjection(command.threadId);
      const run = projection.runs.find(
        (candidate) => candidate.userMessageId === `checkpoint-free:${index}`,
      )!;
      assert.isNull(projection.nodes.find((node) => node.id === run.rootNodeId)?.checkpointScopeId);
      if (dispatchMode.type === "defer_start") {
        const released = yield* orchestrator.dispatch({
          type: "prepared-run.release",
          commandId: CommandId.make("checkpoint-free:release"),
          threadId: command.threadId,
          runId: run.id,
        });
        assert.notInclude(
          released.storedEvents.map(({ event }) => event.type),
          "checkpoint-scope.created",
        );
      }
      yield* projections.apply({
        id: EventId.make(`checkpoint-free:complete:${index}`),
        type: "run.updated",
        threadId: command.threadId,
        occurredAt: run.requestedAt,
        payload: { ...run, status: "completed", completedAt: run.requestedAt },
      });
    }
    const projection = yield* projections.getThreadProjection(command.threadId);
    assert.deepEqual(projection.checkpointScopes, []);
  }).pipe(Effect.provide(layerTest)),
);
