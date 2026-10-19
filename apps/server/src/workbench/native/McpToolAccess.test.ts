import { assert, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  OrchestratorMcpFailure,
  ProviderInstanceId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer, Tool, Toolkit } from "effect/ai";

import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { McpWritePolicy } from "../../mcp/McpWritePolicy.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";

const supervisedThreadId = ThreadId.make("thread:supervised");
const fullAccessThreadId = ThreadId.make("thread:full-access");
const endedThreadId = ThreadId.make("thread:ended");

const shells = new Map([
  [supervisedThreadId, liveThreadShell(supervisedThreadId, { runtimeMode: "approval-required" })],
  [fullAccessThreadId, liveThreadShell(fullAccessThreadId)],
  [endedThreadId, liveThreadShell(endedThreadId, { activeRunId: null })],
]);

const threadCaller = (threadId: ThreadId): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment"),
  requestNamespace: `provider:${threadId}`,
  thread: {
    threadId,
    providerSessionId: `provider:${threadId}`,
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
});

const clientCaller = (
  access: McpInvocationContext.McpClientCaller["access"],
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment"),
  requestNamespace: "client:session",
  thread: undefined,
  client: { sessionId: "session", label: "Claude Code", access },
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
});

const mcpClient = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "mcp-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const probe = {
  success: Schema.Struct({ ran: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
  ],
};
const ProbeToolkit = Toolkit.make(
  Tool.make("reads", probe),
  Tool.make("acts_as_caller", probe),
  Tool.make("researches_as_caller", probe),
  Tool.make("writes", probe),
  Tool.make("starts_threads", {
    ...probe,
    parameters: Schema.Struct({
      runtimeMode: Schema.optional(RuntimeMode),
      interactionMode: Schema.optional(ProviderInteractionMode),
    }),
  }),
);
const ran = Effect.succeed({ ran: "ran" });
const layerProbeHandlers = McpToolAccess.toLayer(ProbeToolkit, {
  reads: McpToolAccess.reads(() => ran),
  acts_as_caller: McpToolAccess.actsAsCaller(() => ran),
  researches_as_caller: McpToolAccess.researchesAsCaller(() => ran),
  writes: McpToolAccess.writes(() => ran),
  starts_threads: McpToolAccess.startsThreads(
    (input) => input,
    (_, modes) => Effect.succeed({ ran: `${modes.runtimeMode}/${modes.interactionMode}` }),
  ),
});

const probeServer = McpHttpServer.toolkitRegistration(ProbeToolkit, layerProbeHandlers).pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provideMerge(
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (threadId) => Effect.succeed(shells.get(threadId) ?? null),
    }),
  ),
);

const decodeOutcome = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Union([Schema.Struct({ ran: Schema.String }), Schema.Struct({ code: Schema.String })]),
  ),
);

const call = (
  tool: string,
  scope: McpInvocationContext.McpInvocationScope,
  args: Record<string, unknown> = {},
) =>
  McpServer.McpServer.pipe(
    Effect.flatMap((server) => server.callTool({ name: tool, arguments: args })),
    Effect.flatMap(({ content }) =>
      decodeOutcome(content.map((part) => (part.type === "text" ? part.text : "")).join("")),
    ),
    Effect.map((outcome) => ("code" in outcome ? outcome.code : outcome.ran)),
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
    Effect.provideService(McpSchema.McpServerClient, mcpClient),
  );

const supervised = threadCaller(supervisedThreadId);
const fullAccess = threadCaller(fullAccessThreadId);
const ended = threadCaller(endedThreadId);
const fullAccessClient = clientCaller("full-access");
const readOnlyClient = clientCaller("read-only");
const readOnlyProvider = {
  ...fullAccess,
  thread: {
    threadId: fullAccessThreadId,
    providerSessionId: `provider:${fullAccessThreadId}`,
    providerInstanceId: ProviderInstanceId.make("codex"),
    readOnly: true,
  },
};

it.effect("applies an owner write policy after credential restrictions and before handlers", () =>
  Effect.gen(function* () {
    const checked: ThreadId[] = [];
    const deny = {
      assertAllowed: (threadId: ThreadId) =>
        Effect.sync(() => checked.push(threadId)).pipe(
          Effect.andThen(
            Effect.fail(
              new OrchestratorMcpFailure({
                code: "capability_denied",
                message: "Owner forbids writes",
              }),
            ),
          ),
        ),
    };
    assert.equal(
      yield* call("writes", fullAccess).pipe(Effect.provideService(McpWritePolicy, deny)),
      "capability_denied",
    );
    assert.deepEqual(checked, [fullAccessThreadId]);
    assert.equal(
      yield* call("reads", fullAccess).pipe(Effect.provideService(McpWritePolicy, deny)),
      "ran",
    );
    assert.equal(
      yield* call("writes", readOnlyProvider).pipe(Effect.provideService(McpWritePolicy, deny)),
      "capability_denied",
    );
    assert.equal(
      yield* call("writes", fullAccessClient).pipe(Effect.provideService(McpWritePolicy, deny)),
      "ran",
    );
    assert.deepEqual(checked, [fullAccessThreadId]);
  }).pipe(Effect.provide(probeServer)),
);

it.effect("requires an explicit research exception without granting mutations", () =>
  Effect.gen(function* () {
    assert.equal(yield* call("researches_as_caller", readOnlyProvider), "capability_denied");
    const researchPolicy = {
      assertAllowed: (_: ThreadId, operation?: "research") =>
        operation === "research"
          ? Effect.void
          : Effect.fail(
              new OrchestratorMcpFailure({ code: "capability_denied", message: "Planning" }),
            ),
    };
    assert.equal(
      yield* call("researches_as_caller", readOnlyProvider).pipe(
        Effect.provideService(McpWritePolicy, researchPolicy),
      ),
      "ran",
    );
    assert.equal(
      yield* call("acts_as_caller", readOnlyProvider).pipe(
        Effect.provideService(McpWritePolicy, researchPolicy),
      ),
      "capability_denied",
    );
    assert.equal(
      yield* call("researches_as_caller", {
        ...ended,
        thread: { ...readOnlyProvider.thread, threadId: endedThreadId },
      }).pipe(Effect.provideService(McpWritePolicy, researchPolicy)),
      "parent_not_active",
    );
  }).pipe(Effect.provide(probeServer)),
);

it.effect.each([
  ["reads", readOnlyProvider, "ran"],
  ["writes", readOnlyProvider, "capability_denied"],
  ["acts_as_caller", readOnlyProvider, "capability_denied"],
  ["starts_threads", readOnlyProvider, "capability_denied"],
  ["researches_as_caller", supervised, "ran"],
  ["researches_as_caller", ended, "parent_not_active"],
  ["researches_as_caller", readOnlyClient, "thread_credential_required"],
] as const)("%s from %o: %s", ([tool, scope, expected]) =>
  call(tool, scope).pipe(
    Effect.map((outcome) => expect(outcome).toBe(expected)),
    Effect.provide(probeServer),
  ),
);
