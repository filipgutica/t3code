import type { McpServerStatus, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ClaudeSettings,
  MessageId,
  type ModelSelection,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ProviderThread,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";

import * as ClaudeAdapterV2 from "../../orchestration-v2/Adapters/ClaudeAdapterV2.ts";

const DEFAULT_CLAUDE_SETTINGS = Schema.decodeSync(ClaudeSettings)({});
const CLAUDE_TEST_MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make(ClaudeAdapterV2.CLAUDE_PROVIDER),
  model: "claude-sonnet-4-6",
  options: [{ id: "effort", value: "ultrathink" }],
} satisfies ModelSelection;
const CLAUDE_TEST_RUNTIME_POLICY = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
  runtimeMode: "full-access",
  interactionMode: "default",
  cwd: "/workspace",
});

function makeClaudeTestAppThread(input: {
  readonly threadId: ThreadId;
  readonly providerThread: OrchestrationV2ProviderThread;
  readonly now: DateTime.Utc;
}): OrchestrationV2AppThread {
  return {
    createdBy: "user",
    creationSource: "web",
    id: input.threadId,
    projectId: ProjectId.make(`project-${input.threadId}`),
    title: "Claude query options test",
    providerInstanceId: ProviderInstanceId.make(ClaudeAdapterV2.CLAUDE_PROVIDER),
    modelSelection: CLAUDE_TEST_MODEL_SELECTION,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: input.providerThread.id,
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
}

function makeClaudeTestTurnInput(input: {
  readonly threadId: ThreadId;
  readonly providerThread: OrchestrationV2ProviderThread;
  readonly now: DateTime.Utc;
  readonly attemptId: RunAttemptId;
  readonly text: string;
  readonly attachments: ProviderAdapter.ProviderAdapterV2TurnInput["message"]["attachments"];
  readonly providerTurnOrdinal?: number;
  readonly runtimePolicy?: ProviderAdapter.ProviderAdapterV2RuntimePolicy;
}): ProviderAdapter.ProviderAdapterV2TurnInput {
  return {
    appThread: makeClaudeTestAppThread(input),
    threadId: input.threadId,
    runId: RunId.make(`run-${input.attemptId}`),
    runOrdinal: 1,
    providerTurnOrdinal: input.providerTurnOrdinal ?? 1,
    attemptId: input.attemptId,
    rootNodeId: NodeId.make(`node-${input.attemptId}`),
    providerThread: input.providerThread,
    message: {
      createdBy: "user",
      creationSource: "web",
      messageId: MessageId.make(`message-${input.attemptId}`),
      text: input.text,
      attachments: input.attachments,
    },
    modelSelection: CLAUDE_TEST_MODEL_SELECTION,
    runtimePolicy: input.runtimePolicy ?? CLAUDE_TEST_RUNTIME_POLICY,
  };
}

describe("ClaudeAdapterV2 MCP query overrides", () => {
  it("keys live-query reuse on an installed options policy", () => {
    const queryPolicy = ClaudeAdapterV2.claudeRuntimeQueryPolicyForRuntimePolicy(
      ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: "/workspace",
        approvalPolicy: "on-request",
        sandboxPolicy: {
          type: "readOnly",
          access: { type: "fullAccess" },
          networkAccess: false,
        },
      }),
    );
    const detachedKey = ClaudeAdapterV2.claudeEffectiveQueryPolicyKey(queryPolicy, {});

    assert.notEqual(
      detachedKey,
      ClaudeAdapterV2.claudeEffectiveQueryPolicyKey(queryPolicy, {
        reuseKey: "installed-policy",
      }),
    );
  });
});

describe("ClaudeAdapterV2 query options decorator", () => {
  const startPolicyTurn = Effect.fn(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const idAllocator = yield* IdAllocator.IdAllocatorV2;
    const attachmentsDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-claude-research-",
    });
    let openedOptions: ClaudeAdapterV2.ClaudeAgentSdkQueryOptions | undefined;
    const adapter = yield* ClaudeAdapterV2.makeClaudeAdapterV2({
      instanceId: ClaudeAdapterV2.CLAUDE_DEFAULT_INSTANCE_ID,
      settings: DEFAULT_CLAUDE_SETTINGS,
      environment: {},
      attachmentsDir,
      fileSystem,
      path: yield* Path.Path,
      crypto: yield* Crypto.Crypto,
      idAllocator,
      queryRunner: {
        allocateSessionId: Effect.succeed("native-thread-claude-research"),
        open: (openInput) =>
          Effect.sync(() => {
            openedOptions = openInput.options;
            return {
              messages: Stream.never,
              offer: () => Effect.void,
              setModel: () => Effect.void,
              applyFlagSettings: () => Effect.void,
              setPermissionMode: () => Effect.void,
              backgroundTasks: () => Effect.succeed(false),
              stopTask: () => Effect.void,
              interrupt: Effect.void,
              close: Effect.void,
            };
          }),
        forkSession: () => Effect.die("unused"),
        subagentLaunchToolUseId: () => Effect.succeed(null),
        assertComplete: Effect.void,
      },
    });
    const threadId = ThreadId.make("thread-claude-research");
    const runtime = yield* adapter.openSession({
      threadId,
      providerSessionId: ProviderSessionId.make("provider-session-claude-research"),
      modelSelection: CLAUDE_TEST_MODEL_SELECTION,
      runtimePolicy: CLAUDE_TEST_RUNTIME_POLICY,
    });
    const providerThread = yield* runtime.ensureThread({
      threadId,
      modelSelection: CLAUDE_TEST_MODEL_SELECTION,
      runtimePolicy: CLAUDE_TEST_RUNTIME_POLICY,
    });
    const now = yield* DateTime.now;
    yield* runtime.startTurn(
      makeClaudeTestTurnInput({
        threadId,
        providerThread,
        now,
        attemptId: RunAttemptId.make("attempt-claude-research"),
        text: "Research the ticket.",
        attachments: [],
        runtimePolicy: CLAUDE_TEST_RUNTIME_POLICY,
      }),
    );
    if (openedOptions === undefined) return yield* Effect.die("query was not opened");
    return openedOptions;
  });

  it.effect("keeps native defaults and consults an installed options policy", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* startPolicyTurn();
        assert.equal(native.permissionMode, "bypassPermissions");
        assert.isUndefined(native.permissionPrompts);
        assert.isUndefined(native.hooks);
        let consulted = false;
        const decorated = yield* startPolicyTurn().pipe(
          Effect.provideService(ClaudeAdapterV2.ClaudeQueryOptionsDecorator, {
            decorate: ({ runtimePolicy, mcpServerStatus }) => {
              consulted = true;
              assert.equal(runtimePolicy.runtimeMode, "full-access");
              assert.isFunction(mcpServerStatus);
              return {
                options: (options) => {
                  assert.equal(options.permissionMode, "bypassPermissions");
                  return { permissionPrompts: "none" };
                },
                reuseKey: "fixture-policy",
              };
            },
          }),
        );
        assert.isTrue(consulted);
        assert.equal(decorated.permissionMode, native.permissionMode);
        assert.equal(decorated.permissionPrompts, "none");
      }).pipe(
        Effect.provide(
          Layer.mergeAll(IdAllocator.layer, McpProviderSessions.layer, NodeServices.layer),
        ),
      ),
    ),
  );
});

describe("ClaudeAdapterV2 background wake turns", () => {
  const WAKE_NATIVE_SESSION = "native-thread-claude-wake";
  const turnOneResult = {
    type: "result",
    subtype: "success",
    duration_ms: 10,
    duration_api_ms: 10,
    is_error: false,
    num_turns: 1,
    result: "Kicked off the build in the background.",
    stop_reason: "end_turn",
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: "00000000-0000-4000-8000-000000000102",
    session_id: WAKE_NATIVE_SESSION,
    terminal_reason: "completed",
  } as unknown as SDKMessage;

  // Each reopened process gets its own queue and reports its own MCP inventory.
  const makeWakeHarnessWithOptions = (options: {
    readonly freshQueueOnReopen: true;
    readonly mcpServerStatus: (
      processNumber: number,
    ) => NonNullable<ClaudeAdapterV2.ClaudeAgentSdkQuerySession["mcpServerStatus"]>;
  }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const idAllocator = yield* IdAllocator.IdAllocatorV2;
      const attachmentsDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-claude-v2-wake-",
      });
      const sdkMessages = yield* Queue.unbounded<SDKMessage>();
      const processQueues: Array<Queue.Queue<SDKMessage>> = [];
      const offeredMessages: Array<SDKUserMessage> = [];
      const terminalReceipts =
        yield* Queue.unbounded<
          Extract<ProviderAdapter.ProviderAdapterV2Event, { type: "turn.terminal" }>
        >();
      let openedOptions: ClaudeAdapterV2.ClaudeAgentSdkQueryOptions | undefined;
      const adapter = yield* ClaudeAdapterV2.makeClaudeAdapterV2({
        instanceId: ClaudeAdapterV2.CLAUDE_DEFAULT_INSTANCE_ID,
        settings: DEFAULT_CLAUDE_SETTINGS,
        environment: {},
        attachmentsDir,
        fileSystem,
        path: yield* Path.Path,
        crypto: yield* Crypto.Crypto,
        idAllocator,
        queryRunner: {
          allocateSessionId: Effect.succeed(WAKE_NATIVE_SESSION),
          open: (input) =>
            Effect.gen(function* () {
              openedOptions = input.options;
              const processMessages =
                options.freshQueueOnReopen && processQueues.length > 0
                  ? yield* Queue.unbounded<SDKMessage>()
                  : sdkMessages;
              processQueues.push(processMessages);
              return {
                messages: Stream.fromQueue(processMessages),
                mcpServerStatus: options.mcpServerStatus(processQueues.length),
                offer: (message: SDKUserMessage) =>
                  Effect.sync(() => {
                    offeredMessages.push(message);
                  }),
                setModel: () => Effect.void,
                applyFlagSettings: () => Effect.void,
                setPermissionMode: () => Effect.void,
                backgroundTasks: () => Effect.succeed(false),
                stopTask: () => Effect.void,
                interrupt: Effect.void,
                close:
                  processMessages === sdkMessages ? Effect.void : Queue.shutdown(processMessages),
              };
            }),
          forkSession: () => Effect.die("unused forkSession"),
          subagentLaunchToolUseId: () => Effect.succeed(null),
          assertComplete: Effect.void,
        },
      });
      const threadId = ThreadId.make("thread-claude-wake");
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("provider-session-claude-wake"),
        modelSelection: CLAUDE_TEST_MODEL_SELECTION,
        runtimePolicy: CLAUDE_TEST_RUNTIME_POLICY,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection: CLAUDE_TEST_MODEL_SELECTION,
        runtimePolicy: CLAUDE_TEST_RUNTIME_POLICY,
      });
      yield* runtime.events.pipe(
        Stream.runForEach((event) =>
          event.type === "turn.terminal" ? Queue.offer(terminalReceipts, event) : Effect.void,
        ),
        Effect.forkScoped,
      );
      return {
        runtime,
        providerThread,
        threadId,
        sdkMessages,
        processQueues,
        terminalReceipts,
        getOpenedOptions: () => openedOptions,
      };
    });

  it.effect.each([false, true])(
    "reuses decorated queries only for a stable policy and reads live inventory (change=%s)",
    (changePolicy) =>
      Effect.gen(function* () {
        let inventoryBridge:
          | (() => Promise<ReadonlyArray<McpServerStatus> | undefined>)
          | undefined;
        const harness = yield* makeWakeHarnessWithOptions({
          freshQueueOnReopen: true,
          mcpServerStatus: (processNumber) =>
            Effect.succeed([{ name: `process-${processNumber}`, status: "connected" }]),
        }).pipe(
          Effect.provideService(ClaudeAdapterV2.ClaudeQueryOptionsDecorator, {
            decorate: ({ runtimePolicy, mcpServerStatus }) => {
              inventoryBridge ??= mcpServerStatus;
              return {
                reuseKey: runtimePolicy.toolAccess ?? "native",
                options: () => ({ permissionPrompts: "none" }),
              };
            },
          }),
        );
        const startTurn = (ordinal: number) =>
          harness.runtime.startTurn(
            makeClaudeTestTurnInput({
              threadId: harness.threadId,
              providerThread: harness.providerThread,
              now: DateTime.makeUnsafe(0),
              attemptId: RunAttemptId.make(`decorated-${ordinal}`),
              providerTurnOrdinal: ordinal,
              text: "Continue.",
              attachments: [],
              runtimePolicy: {
                ...CLAUDE_TEST_RUNTIME_POLICY,
                ...(ordinal === 2 && changePolicy ? { toolAccess: "research" as const } : {}),
              },
            }),
          );
        yield* startTurn(1);
        if (inventoryBridge === undefined) return assert.fail("Decorator was not consulted");
        const readInventory = inventoryBridge;
        assert.deepEqual(yield* Effect.promise(readInventory), [
          { name: "process-1", status: "connected" },
        ]);
        yield* Queue.offer(harness.sdkMessages, turnOneResult);
        yield* Queue.take(harness.terminalReceipts);
        const firstOptions = harness.getOpenedOptions();
        assert.equal(firstOptions?.permissionPrompts, "none");
        yield* startTurn(2);
        assert.lengthOf(harness.processQueues, changePolicy ? 2 : 1);
        assert.equal(harness.getOpenedOptions() === firstOptions, !changePolicy);
        assert.deepEqual(yield* Effect.promise(readInventory), [
          { name: `process-${changePolicy ? 2 : 1}`, status: "connected" },
        ]);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(IdAllocator.layer, McpProviderSessions.layer, NodeServices.layer),
        ),
      ),
  );
});
