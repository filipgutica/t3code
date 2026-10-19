import * as NetAddress from "effect/net/NetAddress";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2ProviderThread,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderSessionId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { HttpServer } from "effect/http";
import * as McpProviderSession from "@t3tools/provider-core/server/mcpSession";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as McpSessionRegistry from "../../mcp/McpSessionRegistry.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "../../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as EventStore from "../../orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderEventIngestor from "../../orchestration-v2/ProviderEventIngestor.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as ThreadCommandExecutor from "../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ProviderSessionManager from "../../orchestration-v2/ProviderSessionManager.ts";
import * as CommandOutputHub from "../../orchestration-v2/CommandOutputHub.ts";

const layerTestDatabase = SqlitePersistence.layerMemory;
const layerTestStores = Layer.merge(EventStore.layer, ProjectionStore.layer).pipe(
  Layer.provide(layerTestDatabase),
);
const layerTestEventSink = EventSink.layer.pipe(
  Layer.provide(Layer.mergeAll(layerTestStores, layerTestDatabase)),
);

interface TestProviderRuntimeState {
  readonly resumeCount: number;
  readonly unloadedNativeThreadIds: ReadonlyArray<string>;
}

const emptyState: TestProviderRuntimeState = { resumeCount: 0, unloadedNativeThreadIds: [] };

const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
} satisfies ModelSelection;
const CODEX_DRIVER = ProviderDriverKind.make("codex");

const runtimePolicy = {
  runtimeMode: "full-access",
  interactionMode: "default",
  cwd: process.cwd(),
} satisfies ProviderAdapter.ProviderAdapterV2RuntimePolicy;

function makeThreadCreatedEvent(input: {
  readonly idAllocator: IdAllocator.IdAllocatorV2["Service"];
  readonly threadId: ThreadId;
  readonly now: DateTime.Utc;
}) {
  return Effect.gen(function* () {
    const projectId = yield* input.idAllocator.allocate.project({
      fixtureName: "provider-session-manager",
    });
    const providerThreadId = input.idAllocator.derive.providerThread({
      driver: CODEX_DRIVER,
      nativeThreadId: "native-thread",
    });
    const thread: OrchestrationV2AppThread = {
      createdBy: "user",
      creationSource: "web",
      id: input.threadId,
      projectId,
      title: "Provider session manager",
      providerInstanceId: modelSelection.instanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: providerThreadId,
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: input.threadId,
      },
      forkedFrom: null,
      createdAt: input.now,
      updatedAt: input.now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    };
    return {
      id: yield* input.idAllocator.allocate.event({ threadId: input.threadId }),
      type: "thread.created" as const,
      threadId: input.threadId,
      occurredAt: input.now,
      payload: thread,
    };
  });
}

function makeProviderThread(input: {
  readonly idAllocator: IdAllocator.IdAllocatorV2["Service"];
  readonly threadId: ThreadId;
  readonly providerSessionId: ProviderSessionId;
  readonly now: DateTime.Utc;
}): OrchestrationV2ProviderThread {
  const nativeThreadId = "native-thread";
  return {
    id: input.idAllocator.derive.providerThread({ driver: CODEX_DRIVER, nativeThreadId }),
    driver: CODEX_DRIVER,
    providerInstanceId: modelSelection.instanceId,
    providerSessionId: input.providerSessionId,
    appThreadId: input.threadId,
    ownerNodeId: null,
    nativeThreadRef: { driver: CODEX_DRIVER, nativeId: nativeThreadId, strength: "strong" },
    nativeConversationHeadRef: null,
    status: "idle",
    firstRunOrdinal: null,
    lastRunOrdinal: null,
    handoffIds: [],
    forkedFrom: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function unimplemented(detail: string) {
  return Effect.fail(
    new ProviderAdapter.ProviderAdapterProtocolError({ driver: CODEX_DRIVER, detail }),
  );
}

const makeProviderAdapter = Effect.fnUntraced(function* (
  state: Ref.Ref<TestProviderRuntimeState>,
  options: {
    readonly beforeUnload: Effect.Effect<void>;
    readonly onResume: (
      input: Parameters<ProviderAdapter.ProviderAdapterV2SessionRuntime["resumeThread"]>[0],
      config: McpProviderSession.McpProviderSessionConfig | undefined,
    ) => Effect.Effect<void>;
  },
) {
  const mcpSessions = yield* McpProviderSessions.McpProviderSessions;
  return ProviderAdapter.ProviderAdapterV2.of({
    instanceId: ProviderInstanceId.make("codex"),
    driver: CODEX_DRIVER,
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: (input) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event, Cause.Done>();
        return {
          instanceId: ProviderInstanceId.make("codex"),
          driver: CODEX_DRIVER,
          providerSessionId: input.providerSessionId,
          providerSession: {
            id: input.providerSessionId,
            driver: CODEX_DRIVER,
            providerInstanceId: modelSelection.instanceId,
            status: "ready",
            cwd: process.cwd(),
            model: "gpt-5.4",
            capabilities: CodexProviderCapabilitiesV2,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
          events: Stream.fromQueue(events),
          backgroundTasksEndWithProcess: true as const,
          ensureThread: () => unimplemented("ensureThread unused in test"),
          resumeThread: (threadInput) =>
            mcpSessions.read(threadInput.threadId ?? threadInput.providerThread.appThreadId!).pipe(
              Effect.flatMap((config) => options.onResume(threadInput, config)),
              Effect.andThen(
                Ref.update(state, (current) => ({
                  ...current,
                  resumeCount: current.resumeCount + 1,
                })),
              ),
              Effect.as(threadInput.providerThread),
            ),
          startTurn: () => Effect.void,
          steerTurn: () => Effect.void,
          interruptTurn: () => Effect.void,
          unloadThread: ({ providerThread }) =>
            options.beforeUnload.pipe(
              Effect.andThen(
                Ref.update(state, (current) => ({
                  ...current,
                  unloadedNativeThreadIds: [
                    ...current.unloadedNativeThreadIds,
                    providerThread.nativeThreadRef?.nativeId ?? "",
                  ],
                })),
              ),
            ),
          respondToRuntimeRequest: () => Effect.void,
          readThreadSnapshot: () => unimplemented("readThreadSnapshot unused in test"),
          rollbackThread: () => unimplemented("rollbackThread unused in test"),
          forkThread: () => unimplemented("forkThread unused in test"),
        } satisfies ProviderAdapter.ProviderAdapterV2SessionRuntime;
      }),
  });
});

const layerTestMcpRegistry = Layer.effect(
  McpSessionRegistry.McpSessionRegistry,
  McpSessionRegistry.__testing.make(),
).pipe(
  Layer.provide(
    Layer.succeed(
      HttpServer.HttpServer,
      HttpServer.HttpServer.of({
        address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 43123),
        serve: (() => Effect.void) as HttpServer.HttpServer["Service"]["serve"],
      }),
    ),
  ),
  Layer.provide(
    Layer.succeed(
      ServerEnvironment.ServerEnvironment,
      ServerEnvironment.ServerEnvironment.of({
        getEnvironmentId: Effect.succeed(
          EnvironmentId.make("environment-provider-session-manager"),
        ),
        getDescriptor: Effect.die("unused"),
      }),
    ),
  ),
  Layer.provide(NodeServices.layer),
);

function layerTest(input: {
  readonly state: Ref.Ref<TestProviderRuntimeState>;
  readonly idleTimeoutMs: number;
  readonly beforeUnload: Effect.Effect<void>;
  readonly onResume: (
    input: Parameters<ProviderAdapter.ProviderAdapterV2SessionRuntime["resumeThread"]>[0],
    config: McpProviderSession.McpProviderSessionConfig | undefined,
  ) => Effect.Effect<void>;
}) {
  const layerRegistry = Layer.unwrap(
    makeProviderAdapter(input.state, {
      beforeUnload: input.beforeUnload,
      onResume: input.onResume,
    }).pipe(Effect.map(ProviderAdapterRegistry.layerSingle)),
  );
  const layerProviderEventIngestorTest = ProviderEventIngestor.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerTestEventSink,
        IdAllocator.layer,
        layerTestStores,
        ThreadCommandExecutor.layer,
        Layer.mock(GitVcsDriver.GitVcsDriver)({
          resolveBranchName: () => Effect.succeed(null),
        }),
      ),
    ),
  );
  return Layer.mergeAll(
    layerTestStores,
    layerTestEventSink,
    IdAllocator.layer,
    layerTestMcpRegistry,
    McpProviderSessions.layer,
    ProviderSessionManager.layerWithOptions({ idleTimeoutMs: input.idleTimeoutMs }).pipe(
      Layer.provide(
        Layer.mergeAll(
          layerRegistry.pipe(Layer.provideMerge(McpProviderSessions.layer)),
          CommandOutputHub.layer.pipe(
            Layer.provide(Layer.merge(layerTestEventSink, layerTestStores)),
          ),
          layerTestEventSink,
          IdAllocator.layer,
          layerProviderEventIngestorTest,
          layerTestMcpRegistry,
          layerTestStores,
        ),
      ),
    ),
  ).pipe(Layer.provide(NodeServices.layer));
}

it.effect.each([false, true])(
  "ProviderSessionManagerV2 reloads shared native state before changing read-only MCP permissions (unload fails: %s)",
  (failUnload) =>
    Effect.gen(function* () {
      const state = yield* Ref.make(emptyState);
      const resumeCredentials = yield* Ref.make<
        ReadonlyArray<McpProviderSession.McpProviderSessionConfig>
      >([]);
      let unloadFails = failUnload;
      const effect = Effect.gen(function* () {
        const eventSink = yield* EventSink.EventSinkV2;
        const idAllocator = yield* IdAllocator.IdAllocatorV2;
        const manager = yield* ProviderSessionManager.ProviderSessionManagerV2;
        const registry = yield* McpSessionRegistry.McpSessionRegistry;
        const now = yield* DateTime.now;
        const threadId = ThreadId.make("thread:mcp-planning-transition");
        const otherThreadId = ThreadId.make("thread:mcp-shared-working");
        const providerSessionId = idAllocator.derive.providerSession({
          providerInstanceId: modelSelection.instanceId,
        });
        const providerThread = makeProviderThread({
          idAllocator,
          threadId,
          providerSessionId,
          now,
        });
        yield* eventSink.write({
          events: [
            yield* makeThreadCreatedEvent({ idAllocator, threadId, now }),
            yield* makeThreadCreatedEvent({ idAllocator, threadId: otherThreadId, now }),
            {
              id: yield* idAllocator.allocate.event({ threadId }),
              type: "provider-thread.updated",
              threadId,
              driver: CODEX_DRIVER,
              occurredAt: now,
              payload: providerThread,
            },
          ],
        });
        // The shared provider process starts writable for a different conversation.
        yield* manager.open({
          threadId: otherThreadId,
          providerSessionId,
          modelSelection,
          runtimePolicy,
        });
        const otherConfig = (yield* (yield* McpProviderSessions.McpProviderSessions).read(
          otherThreadId,
        ))!;
        assert.isFalse(
          (yield* registry.resolve(otherConfig.authorizationHeader.replace(/^Bearer\s+/, "")))
            ?.thread.readOnly ?? false,
        );
        const planningPolicy = { ...runtimePolicy, sandboxPolicy: { type: "readOnly" as const } };
        const runtime = yield* manager.open({
          threadId,
          providerSessionId,
          modelSelection,
          runtimePolicy: planningPolicy,
        });
        const readOnlyConfig = (yield* (yield* McpProviderSessions.McpProviderSessions).read(
          threadId,
        ))!;
        const readOnlyToken = readOnlyConfig.authorizationHeader.replace(/^Bearer\s+/, "");
        assert.isTrue((yield* registry.resolve(readOnlyToken))?.thread.readOnly);
        yield* runtime.resumeThread({
          threadId,
          providerThread,
          modelSelection,
          runtimePolicy: planningPolicy,
        });
        assert.equal(
          (yield* Ref.get(resumeCredentials)).at(-1)?.providerSessionId,
          readOnlyConfig.providerSessionId,
        );
        yield* manager.detach({ providerSessionId, threadId });
        if (failUnload) {
          const failed = yield* Effect.exit(
            manager.open({ threadId, providerSessionId, modelSelection, runtimePolicy }),
          );
          assert.equal(failed._tag, "Failure");
          assert.equal(
            (yield* (yield* McpProviderSessions.McpProviderSessions).read(threadId))
              ?.providerSessionId,
            readOnlyConfig.providerSessionId,
          );
          assert.isTrue((yield* registry.resolve(readOnlyToken))?.thread.readOnly);
          assert.equal((yield* Ref.get(state)).resumeCount, 1);
          unloadFails = false;
        }
        const unloadsBeforeWorking = (yield* Ref.get(state)).unloadedNativeThreadIds.length;
        const continued = yield* manager.open({
          threadId,
          providerSessionId,
          modelSelection,
          runtimePolicy,
        });
        assert.equal(
          (yield* Ref.get(state)).unloadedNativeThreadIds.length,
          unloadsBeforeWorking + 1,
        );
        const workingConfig = (yield* (yield* McpProviderSessions.McpProviderSessions).read(
          threadId,
        ))!;
        assert.notEqual(workingConfig.providerSessionId, readOnlyConfig.providerSessionId);
        assert.isUndefined(yield* registry.resolve(readOnlyToken));
        assert.isFalse(
          (yield* registry.resolve(workingConfig.authorizationHeader.replace(/^Bearer\s+/, "")))
            ?.thread.readOnly ?? false,
        );
        yield* continued.resumeThread({ threadId, providerThread, modelSelection, runtimePolicy });
        assert.equal(
          (yield* Ref.get(resumeCredentials)).at(-1)?.providerSessionId,
          workingConfig.providerSessionId,
        );
        assert.equal((yield* Ref.get(state)).resumeCount, 2);
        assert.include(
          (yield* Ref.get(state)).unloadedNativeThreadIds,
          providerThread.nativeThreadRef!.nativeId,
        );
        assert.equal(
          (yield* (yield* McpProviderSessions.McpProviderSessions).read(otherThreadId))
            ?.providerSessionId,
          otherConfig.providerSessionId,
        );
        // Tightening the same resident conversation also reloads its native MCP client.
        const unloadsBeforeTightening = (yield* Ref.get(state)).unloadedNativeThreadIds.length;
        yield* manager.open({
          threadId,
          providerSessionId,
          modelSelection,
          runtimePolicy: planningPolicy,
        });
        assert.equal(
          (yield* Ref.get(state)).unloadedNativeThreadIds.length,
          unloadsBeforeTightening + 1,
        );
        const tightened = (yield* (yield* McpProviderSessions.McpProviderSessions).read(threadId))!;
        assert.notEqual(tightened.providerSessionId, workingConfig.providerSessionId);
        assert.isUndefined(
          yield* registry.resolve(workingConfig.authorizationHeader.replace(/^Bearer\s+/, "")),
        );
        assert.isTrue(
          (yield* registry.resolve(tightened.authorizationHeader.replace(/^Bearer\s+/, "")))?.thread
            .readOnly,
        );
        yield* runtime.resumeThread({
          threadId,
          providerThread,
          modelSelection,
          runtimePolicy: planningPolicy,
        });
        assert.equal(
          (yield* Ref.get(resumeCredentials)).at(-1)?.providerSessionId,
          tightened.providerSessionId,
        );
        assert.equal((yield* Ref.get(state)).resumeCount, 3);
        // Revoked credentials still require a reload of any resident native MCP client.
        yield* registry.revokeThread(threadId);
        const unloadsBeforeRevocation = (yield* Ref.get(state)).unloadedNativeThreadIds.length;
        yield* manager.open({ threadId, providerSessionId, modelSelection, runtimePolicy });
        assert.equal(
          (yield* Ref.get(state)).unloadedNativeThreadIds.length,
          unloadsBeforeRevocation + 1,
        );
        const recovered = (yield* (yield* McpProviderSessions.McpProviderSessions).read(threadId))!;
        assert.notEqual(recovered.providerSessionId, tightened.providerSessionId);
        assert.isFalse(
          (yield* registry.resolve(recovered.authorizationHeader.replace(/^Bearer\s+/, "")))?.thread
            .readOnly ?? false,
        );
        yield* runtime.resumeThread({ threadId, providerThread, modelSelection, runtimePolicy });
        assert.equal(
          (yield* Ref.get(resumeCredentials)).at(-1)?.providerSessionId,
          recovered.providerSessionId,
        );
        assert.equal((yield* Ref.get(state)).resumeCount, 4);
      });
      yield* effect.pipe(
        Effect.provide(
          layerTest({
            state,
            idleTimeoutMs: 1000,
            beforeUnload: Effect.suspend(() =>
              unloadFails ? Effect.die("native unload failed") : Effect.void,
            ),
            onResume: (_input, config) =>
              config === undefined
                ? Effect.die("Missing MCP config on resume")
                : Ref.update(resumeCredentials, (current) => [...current, config]),
          }),
        ),
      );
    }),
);
