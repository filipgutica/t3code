import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CodexSettings,
  CheckpointId,
  EnvironmentId,
  type ModelSelection,
  NodeId,
  ProviderTurnId,
  RunAttemptId,
  ProviderSessionId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexReplay from "effect-codex-app-server/replay";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSession from "@t3tools/provider-core/server/mcpSession";
import {
  ProviderAdapterOpenSessionError,
  ProviderAdapterV2RuntimePolicy,
} from "@t3tools/provider-core/server/ProviderAdapter";
import * as Schema from "effect/Schema";
import packageJson from "../../package.json" with { type: "json" };
import * as CodexAdapterV2 from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import { makeReplayServerConfig } from "../orchestration-v2/Adapters/CodexAdapterV2.testkit.ts";

const DEFAULT_CODEX_SETTINGS = Schema.decodeSync(CodexSettings)({});
const CODEX_TEST_MODEL_SELECTION = {
  instanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID,
  model: "gpt-5.4",
} satisfies ModelSelection;
const CODEX_TEST_RUNTIME_POLICY = ProviderAdapterV2RuntimePolicy.make({
  runtimeMode: "full-access",
  interactionMode: "default",
  cwd: "/workspace",
});

const threadResult = (nativeThreadId: string) => ({
  thread: {
    id: nativeThreadId,
    sessionId: nativeThreadId,
    forkedFromId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1782622440,
    updatedAt: 1782622440,
    status: { type: "idle" },
    path: `/tmp/${nativeThreadId}.jsonl`,
    cwd: "/workspace",
    cliVersion: "0.144.0",
    source: "vscode",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  },
  model: "gpt-5.4",
  modelProvider: "openai",
  serviceTier: null,
  cwd: "/workspace",
  instructionSources: [],
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  sandbox: { type: "workspaceWrite", writableRoots: [], networkAccess: false },
  reasoningEffort: "medium",
});

function codexReplayPreamble(input: {
  readonly nativeThreadId: string;
}): Array<CodexReplay.CodexAppServerReplayEntry> {
  return [
    {
      type: "expect_outbound",
      label: "initialize",
      frame: {
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "T3 Code", title: "T3 Code", version: packageJson.version },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: ["turn/diff/updated"],
            extensions: {
              "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
            },
          },
        },
      },
    },
    {
      type: "emit_inbound",
      label: "initialize",
      frame: {
        id: 1,
        result: {
          userAgent: "T3 Code/0.156.1",
          codexHome: "/tmp/codex-home",
          platformFamily: "unix",
          platformOs: "macos",
        },
      },
    },
    { type: "expect_outbound", label: "initialized", frame: { method: "initialized" } },
    {
      type: "expect_outbound",
      label: "thread/start",
      frame: {
        id: 2,
        method: "thread/start",
        params: { config: CodexAdapterV2.CODEX_THREAD_CONFIG },
      },
    },
    {
      type: "emit_inbound",
      label: "thread/start",
      frame: {
        id: 2,
        result: threadResult(input.nativeThreadId),
      },
    },
  ];
}

function makeCodexReplayTranscript(input: {
  readonly scenario: string;
  readonly entries: ReadonlyArray<CodexReplay.CodexAppServerReplayEntry>;
}): CodexReplay.CodexAppServerReplayTranscript {
  return {
    provider: "codex",
    protocol: "codex.app-server",
    version: "0.144.0",
    scenario: input.scenario,
    entries: input.entries,
  };
}

function withReplayRequestId(
  entry: CodexReplay.CodexAppServerReplayEntry,
  id: number,
): CodexReplay.CodexAppServerReplayEntry {
  return entry.type !== "runtime_exit" && Predicate.isObject(entry.frame)
    ? { ...entry, frame: { ...entry.frame, id } }
    : entry;
}

describe("Codex planning runtime integration", () => {
  const openReplaySession = (
    transcript: CodexReplay.CodexAppServerReplayTranscript,
    runtimePolicy = CODEX_TEST_RUNTIME_POLICY,
  ) =>
    Effect.gen(function* () {
      const driver = yield* CodexReplay.makeReplayDriver(transcript, {});
      const requests: Array<string> = [];
      const sentRequests: Array<{ method: string; params: unknown }> = [];
      const adapter = CodexAdapterV2.makeCodexAdapterV2({
        instanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID,
        settings: DEFAULT_CODEX_SETTINGS,
        environment: {},
        clientFactory: {
          open: (openInput) =>
            Layer.build(CodexReplay.layerReplayWithDriver(driver)).pipe(
              Effect.flatMap((context) =>
                Effect.service(CodexClient.CodexAppServerClient).pipe(Effect.provide(context)),
              ),
              Effect.map(
                (client) =>
                  ({
                    ...client,
                    request: (method, params) =>
                      Effect.sync(() => {
                        requests.push(method);
                        sentRequests.push({ method, params });
                      }).pipe(Effect.andThen(client.request(method, params))),
                    raw: {
                      ...client.raw,
                      request: (method, params) =>
                        Effect.sync(() => {
                          sentRequests.push({ method, params });
                        }).pipe(Effect.andThen(client.raw.request(method, params))),
                    },
                  }) satisfies CodexClient.CodexAppServerClient["Service"],
              ),
              Effect.mapError(
                (cause) =>
                  new ProviderAdapterOpenSessionError({
                    driver: CodexAdapterV2.CODEX_DRIVER_KIND,
                    providerSessionId: openInput.providerSessionId,
                    cause,
                  }),
              ),
            ),
        },
        crypto: yield* Crypto.Crypto,
        fileSystem: yield* FileSystem.FileSystem,
        idAllocator: yield* IdAllocator.IdAllocatorV2,
        serverConfig: yield* makeReplayServerConfig(transcript.scenario).pipe(Effect.orDie),
      });
      const runtime = yield* adapter.openSession({
        threadId: ThreadId.make(`thread-${transcript.scenario}`),
        providerSessionId: ProviderSessionId.make(`provider-session-${transcript.scenario}`),
        modelSelection: CODEX_TEST_MODEL_SELECTION,
        runtimePolicy,
      });
      return {
        runtime,
        requests,
        ensureThread: (threadId: string, runtimePolicy = CODEX_TEST_RUNTIME_POLICY) =>
          runtime.ensureThread({
            threadId: ThreadId.make(threadId),
            modelSelection: CODEX_TEST_MODEL_SELECTION,
            runtimePolicy,
          }),
        sentRequests,
      };
    });

  const replayPreamble = (nativeThreadId: string) => codexReplayPreamble({ nativeThreadId });

  const exchange = (
    id: number,
    method: string,
    params: unknown,
    result: unknown,
  ): Array<CodexReplay.CodexAppServerReplayEntry> => [
    { type: "expect_outbound", frame: { id, method, params } },
    { type: "emit_inbound", frame: { id, result } },
  ];
  const restrictedParams = {
    cwd: "/workspace",
    model: "gpt-5.4",
    config: {
      "tools.update_plan.enabled": true,
      "features.hooks": false,
      "features.codex_hooks": false,
      "features.plugin_hooks": false,
      "features.plugins": false,
      "features.apps": false,
      "features.connectors": false,
      "features.multi_agent": false,
      mcp_servers: {
        jira: { enabled: false },
        "github.external": { enabled: false },
        "t3-code": { enabled: false },
      },
    },
  };
  const inventory = (id: number) =>
    exchange(
      id,
      "config/read",
      { cwd: "/workspace", includeLayers: false },
      {
        config: {
          mcp_servers: {
            jira: { command: "jira-write-server" },
            "github.external": { url: "https://external.invalid/mcp" },
            "t3-code": { enabled: true },
          },
        },
        origins: {},
      },
    );

  it.effect.each([
    [false, true],
    [true, true],
    [true, false],
  ] as const)(
    "isolates inherited integrations only for read-only native start and resume (read-only: %s, native MCP: %s)",
    ([readOnly, nativeMcp]) =>
      Effect.gen(function* () {
        const scenario = `integration-isolation-${readOnly}-${nativeMcp}`;
        const threadId = ThreadId.make(`thread-${scenario}`);
        const nativeThreadId = `native-${scenario}`;
        const endpoint = "http://127.0.0.1:43123/mcp";
        const authorization = "Bearer readonly-protocol-token";
        if (nativeMcp)
          McpProviderSession.setMcpProviderSession({
            environmentId: EnvironmentId.make("integration-isolation"),
            threadId,
            providerSessionId: `mcp-${scenario}`,
            providerInstanceId: CODEX_TEST_MODEL_SELECTION.instanceId,
            endpoint,
            authorizationHeader: authorization,
            browserToolsAvailable: false,
          });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => McpProviderSession.clearMcpProviderSession(threadId)),
        );
        const policy = {
          ...CODEX_TEST_RUNTIME_POLICY,
          ...(readOnly ? { sandboxPolicy: { type: "readOnly" as const } } : {}),
        };
        const expectedParams = {
          cwd: "/workspace",
          model: "gpt-5.4",
          config: {
            "tools.update_plan.enabled": true,
            ...(readOnly ? restrictedParams.config : {}),
            mcp_servers: {
              ...(readOnly
                ? { jira: { enabled: false }, "github.external": { enabled: false } }
                : {}),
              ...(nativeMcp
                ? { "t3-code": { url: endpoint, http_headers: { Authorization: authorization } } }
                : { "t3-code": { enabled: false } }),
            },
          },
        };
        const preamble = replayPreamble(nativeThreadId);
        const startId = readOnly ? 3 : 2;
        const resumeId = readOnly ? 5 : 3;
        const session = yield* openReplaySession(
          makeCodexReplayTranscript({
            scenario,
            entries: [
              ...preamble.slice(0, 3),
              ...(readOnly ? inventory(2) : []),
              {
                type: "expect_outbound",
                label: "thread/start",
                frame: { id: startId, method: "thread/start", params: expectedParams },
              },
              withReplayRequestId(preamble[4]!, startId),
              ...(readOnly ? inventory(4) : []),
              {
                type: "expect_outbound",
                label: "thread/resume",
                frame: {
                  id: resumeId,
                  method: "thread/resume",
                  params: { threadId: nativeThreadId, excludeTurns: true, ...expectedParams },
                },
              },
              {
                type: "emit_inbound",
                label: "thread/resume",
                frame: {
                  id: resumeId,
                  result: { thread: { id: nativeThreadId, updatedAt: 1782622450 } },
                },
              },
            ],
          }),
        );
        const started = yield* session.ensureThread(threadId, policy);
        const resumed = yield* session.runtime.resumeThread({
          providerThread: started,
          modelSelection: CODEX_TEST_MODEL_SELECTION,
          runtimePolicy: policy,
        });
        assert.equal(resumed.nativeThreadRef?.nativeId, nativeThreadId);
        assert.deepEqual(
          session.sentRequests
            .filter(({ method }) => method === "thread/start" || method === "thread/resume")
            .map(({ params }) => params),
          [expectedParams, { threadId: nativeThreadId, excludeTurns: true, ...expectedParams }],
        );
        assert.equal(
          session.requests.filter((method) => method === "config/read").length,
          readOnly ? 2 : 0,
        );
      }).pipe(Effect.scoped, Effect.provide(Layer.merge(IdAllocator.layer, NodeServices.layer))),
  );

  it.effect.each(["unavailable", "malformed"])(
    "refuses native start with a %s integration inventory",
    (failure) =>
      Effect.gen(function* () {
        const session = yield* openReplaySession(
          makeCodexReplayTranscript({
            scenario: `integration-inventory-${failure}`,
            entries: [
              ...replayPreamble("inventory-failure").slice(0, 3),
              {
                type: "expect_outbound",
                label: "config/read",
                frame: {
                  id: 2,
                  method: "config/read",
                  params: { cwd: "/workspace", includeLayers: false },
                },
              },
              {
                type: "emit_inbound",
                label: "config/read",
                frame:
                  failure === "unavailable"
                    ? { id: 2, error: { code: -32603, message: "Config unavailable" } }
                    : { id: 2, result: { config: { mcp_servers: [] }, origins: {} } },
              },
            ],
          }),
        );
        const error = yield* session
          .ensureThread("thread-inventory-failure", {
            ...CODEX_TEST_RUNTIME_POLICY,
            sandboxPolicy: { type: "readOnly" },
          })
          .pipe(Effect.flip);
        assert.equal(error._tag, "ProviderAdapterEnsureThreadError");
        assert.deepEqual(session.requests, ["initialize", "config/read"]);
      }).pipe(Effect.scoped, Effect.provide(Layer.merge(IdAllocator.layer, NodeServices.layer))),
  );

  it.effect.each(["fork", "rollback"])(
    "preserves read-only integration restrictions during %s",
    (operation) =>
      Effect.gen(function* () {
        const policy = { ...CODEX_TEST_RUNTIME_POLICY, sandboxPolicy: { type: "readOnly" } };
        const nativeThreadId = `native-${operation}-source`;
        const preamble = replayPreamble(nativeThreadId);
        const initialParams =
          operation === "rollback"
            ? restrictedParams
            : {
                cwd: "/workspace",
                model: "gpt-5.4",
                config: { "tools.update_plan.enabled": true },
              };
        const entries =
          operation === "fork"
            ? [
                ...preamble.slice(0, 3),
                ...exchange(2, "thread/start", initialParams, threadResult(nativeThreadId)),
                ...inventory(3),
                ...exchange(
                  4,
                  "thread/fork",
                  { threadId: nativeThreadId, ...restrictedParams },
                  threadResult("native-fork-target"),
                ),
              ]
            : [
                ...preamble.slice(0, 3),
                ...inventory(2),
                ...exchange(3, "thread/start", initialParams, threadResult(nativeThreadId)),
                ...exchange(
                  4,
                  "thread/read",
                  { threadId: nativeThreadId, includeTurns: false },
                  { thread: { historyMode: "paginated", status: { type: "notLoaded" } } },
                ),
                ...inventory(5),
                ...exchange(
                  6,
                  "thread/resume",
                  { threadId: nativeThreadId, excludeTurns: true, ...restrictedParams },
                  { thread: { id: nativeThreadId } },
                ),
                ...exchange(
                  7,
                  "thread/turns/list",
                  {
                    threadId: nativeThreadId,
                    cursor: null,
                    limit: 1,
                    sortDirection: "desc",
                    itemsView: "summary",
                  },
                  {
                    data: [{ id: "native-turn", items: [], status: "completed", error: null }],
                    nextCursor: null,
                  },
                ),
                ...exchange(
                  8,
                  "thread/revert",
                  { threadId: nativeThreadId, beforeTurnId: "native-turn" },
                  threadResult(nativeThreadId),
                ),
              ];
        const session = yield* openReplaySession(
          makeCodexReplayTranscript({ scenario: `planning-${operation}`, entries }),
          operation === "rollback" ? policy : CODEX_TEST_RUNTIME_POLICY,
        );
        const source = yield* session.ensureThread(
          `thread-${operation}-source`,
          operation === "rollback" ? policy : CODEX_TEST_RUNTIME_POLICY,
        );
        if (operation === "fork") {
          const forked = yield* session.runtime.forkThread({
            sourceProviderThread: source,
            targetThreadId: ThreadId.make("thread-fork-target"),
            modelSelection: CODEX_TEST_MODEL_SELECTION,
            runtimePolicy: policy,
          });
          assert.equal(forked.nativeThreadRef?.nativeId, "native-fork-target");
        } else {
          const now = yield* DateTime.now;
          yield* session.runtime.rollbackThread({
            providerThread: source,
            target: {
              type: "thread_start",
              checkpointId: CheckpointId.make("planning-rollback"),
              appRunOrdinal: 0,
            },
            providerThreadTurns: [
              {
                id: ProviderTurnId.make("provider-turn"),
                providerThreadId: source.id,
                nodeId: NodeId.make("node"),
                runAttemptId: RunAttemptId.make("attempt"),
                nativeTurnRef: {
                  driver: CodexAdapterV2.CODEX_DRIVER_KIND,
                  nativeId: "native-turn",
                  strength: "strong",
                },
                ordinal: 1,
                status: "completed",
                startedAt: now,
                completedAt: now,
              },
            ],
          });
        }
        const method = operation === "fork" ? "thread/fork" : "thread/resume";
        assert.deepEqual(
          session.sentRequests.find((request) => request.method === method)?.params,
          {
            threadId: nativeThreadId,
            ...(operation === "rollback" ? { excludeTurns: true } : {}),
            ...restrictedParams,
          },
        );
      }).pipe(Effect.scoped, Effect.provide(Layer.merge(IdAllocator.layer, NodeServices.layer))),
  );
});
