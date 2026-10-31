import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CodexSettings,
  MessageId,
  type ModelSelection,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ProviderThread,
  ProjectId,
  ProviderSessionId,
  RunAttemptId,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexReplay from "effect-codex-app-server/replay";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import packageJson from "../../../package.json" with { type: "json" };
import * as CodexAdapterV2 from "../../orchestration-v2/Adapters/CodexAdapterV2.ts";
import { withCodexReplayChildMetadata } from "../../orchestration-v2/Adapters/CodexAdapterV2.testkit.ts";
import { makeReplayServerConfig } from "../../orchestration-v2/testkit/ProviderReplayHarness.ts";

const DEFAULT_CODEX_SETTINGS = Schema.decodeSync(CodexSettings)({});
const CODEX_TEST_MODEL_SELECTION = {
  instanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID,
  model: "gpt-5.4",
} satisfies ModelSelection;
const CODEX_TEST_RUNTIME_POLICY = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
  runtimeMode: "full-access",
  interactionMode: "default",
  cwd: "/workspace",
});

function makeCodexTestAppThread(input: {
  readonly threadId: ThreadId;
  readonly providerThread: OrchestrationV2ProviderThread;
  readonly now: DateTime.Utc;
}): OrchestrationV2AppThread {
  return {
    createdBy: "user",
    creationSource: "web",
    id: input.threadId,
    projectId: ProjectId.make(`project-${input.threadId}`),
    title: "Codex continuation test",
    providerInstanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID,
    modelSelection: CODEX_TEST_MODEL_SELECTION,
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

function makeCodexTestTurnInput(input: {
  readonly threadId: ThreadId;
  readonly providerThread: OrchestrationV2ProviderThread;
  readonly now: DateTime.Utc;
  readonly attemptId: RunAttemptId;
  readonly text: string;
}): ProviderAdapter.ProviderAdapterV2TurnInput {
  return {
    appThread: makeCodexTestAppThread(input),
    threadId: input.threadId,
    runId: RunId.make(`run-${input.attemptId}`),
    runOrdinal: 1,
    providerTurnOrdinal: 1,
    attemptId: input.attemptId,
    rootNodeId: NodeId.make(`node-${input.attemptId}`),
    providerThread: input.providerThread,
    message: {
      createdBy: "user",
      creationSource: "web",
      messageId: MessageId.make(`message-${input.attemptId}`),
      text: input.text,
      attachments: [],
    },
    modelSelection: CODEX_TEST_MODEL_SELECTION,
    runtimePolicy: CODEX_TEST_RUNTIME_POLICY,
  };
}

function makeCodexReplayTurn(input: {
  readonly id: string;
  readonly status: "inProgress" | "completed" | "interrupted" | "failed";
}): Record<string, unknown> {
  const terminal =
    input.status === "completed" || input.status === "interrupted" || input.status === "failed";
  return {
    id: input.id,
    items: [],
    itemsView: "notLoaded",
    status: input.status,
    error: null,
    startedAt: 1782622440,
    completedAt: terminal ? 1782622450 : null,
    durationMs: null,
  };
}

function codexReplayPreamble(input: {
  readonly nativeThreadId: string;
  readonly nativeTurnId: string;
  readonly prompt: string;
  readonly sentPrompt?: string;
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
        result: {
          thread: {
            id: input.nativeThreadId,
            sessionId: input.nativeThreadId,
            forkedFromId: null,
            preview: "",
            ephemeral: false,
            modelProvider: "openai",
            createdAt: 1782622440,
            updatedAt: 1782622440,
            status: { type: "idle" },
            path: `/tmp/${input.nativeThreadId}.jsonl`,
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
        },
      },
    },
    {
      type: "expect_outbound",
      label: "turn/start",
      frame: {
        id: 3,
        method: "turn/start",
        params: {
          threadId: input.nativeThreadId,
          input: [{ type: "text", text: input.sentPrompt ?? input.prompt }],
          cwd: "/workspace",
          model: "gpt-5.4",
          approvalPolicy: "never",
          approvalsReviewer: "user",
          collaborationMode: { mode: "default", settings: { model: "gpt-5.4" } },
          sandboxPolicy: { type: "dangerFullAccess" },
          summary: "detailed",
        },
      },
    },
    {
      type: "emit_inbound",
      label: "turn/start",
      frame: {
        id: 3,
        result: { turn: makeCodexReplayTurn({ id: input.nativeTurnId, status: "inProgress" }) },
      },
    },
    {
      type: "emit_inbound",
      label: "turn/started",
      frame: {
        method: "turn/started",
        params: {
          threadId: input.nativeThreadId,
          turn: makeCodexReplayTurn({ id: input.nativeTurnId, status: "inProgress" }),
        },
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

describe("CodexAdapterV2 research tool access", () => {
  const makeCodexReplayHarness = (
    transcript: CodexReplay.CodexAppServerReplayTranscript,
    onEvent: (event: ProviderAdapter.ProviderAdapterV2Event) => Effect.Effect<unknown>,
  ) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const idAllocator = yield* IdAllocator.IdAllocatorV2;
      const serverConfig = yield* makeReplayServerConfig(transcript.scenario).pipe(Effect.orDie);
      const clientFactory: CodexAdapterV2.CodexAppServerClientFactoryShape = {
        open: (openInput) =>
          Layer.build(CodexReplay.layerReplay(transcript)).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapter.ProviderAdapterOpenSessionError({
                  driver: CodexAdapterV2.CODEX_DRIVER_KIND,
                  providerSessionId: openInput.providerSessionId,
                  cause,
                }),
            ),
            Effect.flatMap((context) =>
              Effect.service(CodexClient.CodexAppServerClient).pipe(
                Effect.map((client) => withCodexReplayChildMetadata(client, transcript)),
                Effect.provide(context),
              ),
            ),
          ),
      };
      const adapter = yield* CodexAdapterV2.makeCodexAdapterV2({
        instanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID,
        settings: DEFAULT_CODEX_SETTINGS,
        environment: {},
        clientFactory,
        crypto: yield* Crypto.Crypto,
        fileSystem,
        idAllocator,
        serverConfig,
      });
      const threadId = ThreadId.make(`thread-${transcript.scenario}`);
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make(`provider-session-${transcript.scenario}`),
        modelSelection: CODEX_TEST_MODEL_SELECTION,
        runtimePolicy: CODEX_TEST_RUNTIME_POLICY,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection: CODEX_TEST_MODEL_SELECTION,
        runtimePolicy: CODEX_TEST_RUNTIME_POLICY,
      });
      const events: Array<ProviderAdapter.ProviderAdapterV2Event> = [];
      const firstTerminal = yield* Deferred.make<void>();
      yield* runtime.events.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            events.push(event);
          }).pipe(
            Effect.andThen(
              event.type === "turn.terminal"
                ? Deferred.succeed(firstTerminal, undefined)
                : Effect.void,
            ),
            Effect.andThen(onEvent(event)),
          ),
        ),
        Effect.forkScoped,
      );
      return {
        runtime,
        providerThread,
        threadId,
        events,
        terminalEvents: () => events.filter((event) => event.type === "turn.terminal"),
        firstTerminal: Deferred.await(firstTerminal),
      };
    });

  const assistantMessages = (events: ReadonlyArray<ProviderAdapter.ProviderAdapterV2Event>) =>
    events.filter(
      (
        event,
      ): event is Extract<ProviderAdapter.ProviderAdapterV2Event, { type: "message.updated" }> =>
        event.type === "message.updated" && event.message.role === "assistant",
    );

  const finalAnswerTranscript = (
    scenario: string,
    answers: ReadonlyArray<{ readonly id: string; readonly text: string }>,
  ) => {
    const nativeThreadId = `native-${scenario}-thread`;
    const nativeTurnId = `native-${scenario}-turn`;
    const prompt = "Reply with the requested recovery marker.";
    return makeCodexReplayTranscript({
      scenario,
      entries: [
        ...codexReplayPreamble({ nativeThreadId, nativeTurnId, prompt }),
        ...answers.map((answer, index): CodexReplay.CodexAppServerReplayEntry => ({
          type: "emit_inbound",
          label: `item/completed/${answer.id}`,
          frame: {
            method: "item/completed",
            params: {
              item: {
                type: "agentMessage",
                id: answer.id,
                text: answer.text,
                phase: "final_answer",
                memoryCitation: null,
              },
              threadId: nativeThreadId,
              turnId: nativeTurnId,
              completedAtMs: 1782622441000 + index,
            },
          },
        })),
        {
          type: "emit_inbound",
          label: "turn/completed",
          frame: {
            method: "turn/completed",
            params: {
              threadId: nativeThreadId,
              turn: makeCodexReplayTurn({ id: nativeTurnId, status: "completed" }),
            },
          },
        },
      ],
    });
  };

  it.effect.each([
    "file-change",
    "filesystem-grant",
    "filesystem-grant-entries",
    "command-escape",
    "legacy-command-escape",
    "legacy-file-change",
  ] as const)(
    "declines research %s approval without exposing a user grant and continues the turn",
    (kind) =>
      Effect.scoped(
        Effect.gen(function* () {
          const scenario = `codex-research-${kind}`;
          const milestone = yield* Deferred.make<void>();
          const base = finalAnswerTranscript(scenario, [
            { id: "answer", text: "RESEARCH_CONTINUES" },
          ]);
          const legacy = kind.startsWith("legacy-");
          const method =
            kind === "legacy-command-escape"
              ? "execCommandApproval"
              : kind === "legacy-file-change"
                ? "applyPatchApproval"
                : kind === "file-change"
                  ? "item/fileChange/requestApproval"
                  : kind.startsWith("filesystem-grant")
                    ? "item/permissions/requestApproval"
                    : "item/commandExecution/requestApproval";
          const result = legacy
            ? {
                decision: {
                  denied: { rejection: "Tool access policy does not allow this operation." },
                },
              }
            : kind.startsWith("filesystem-grant")
              ? { permissions: {}, scope: "turn" }
              : { decision: "decline" };
          const transcript = {
            ...base,
            entries: [
              ...base.entries.slice(0, -2),
              {
                type: "emit_inbound" as const,
                label: `research-${kind}-request`,
                frame: {
                  id: 77,
                  method,
                  params: legacy
                    ? {
                        conversationId: `native-${scenario}-thread`,
                        callId: `research-${kind}`,
                        ...(kind === "legacy-file-change"
                          ? {
                              fileChanges: { "/workspace/file": { type: "add", content: "write" } },
                              grantRoot: "/workspace",
                            }
                          : {
                              cwd: "/workspace",
                              command: ["touch", "/workspace/file"],
                              parsedCmd: [],
                            }),
                      }
                    : {
                        threadId: `native-${scenario}-thread`,
                        turnId: `native-${scenario}-turn`,
                        itemId: `research-${kind}`,
                        startedAtMs: 1782622440500,
                        ...(kind === "file-change"
                          ? { grantRoot: "/workspace" }
                          : kind.startsWith("filesystem-grant")
                            ? {
                                cwd: "/workspace",
                                permissions: {
                                  fileSystem:
                                    kind === "filesystem-grant"
                                      ? { write: ["/workspace"] }
                                      : {
                                          entries: [
                                            {
                                              path: { type: "path", path: "/workspace" },
                                              access: "write",
                                            },
                                          ],
                                        },
                                },
                              }
                            : {
                                cwd: "/workspace",
                                command: "touch /workspace/file",
                                reason: "Run outside the sandbox",
                              }),
                      },
                },
              },
              {
                type: "expect_outbound" as const,
                label: `research-${kind}-declined`,
                frame: { id: 77, result },
              },
              ...base.entries.slice(-2),
            ],
          };
          const harness = yield* makeCodexReplayHarness(transcript, (event) =>
            event.type === "runtime_request.updated" || event.type === "turn.terminal"
              ? Deferred.succeed(milestone, undefined).pipe(Effect.asVoid)
              : Effect.void,
          );
          const now = yield* DateTime.now;
          yield* harness.runtime.startTurn({
            ...makeCodexTestTurnInput({
              threadId: harness.threadId,
              providerThread: harness.providerThread,
              now,
              attemptId: RunAttemptId.make(`attempt-${scenario}`),
              text: "Reply with the requested recovery marker.",
            }),
            runtimePolicy: { ...CODEX_TEST_RUNTIME_POLICY, toolAccess: "research" },
          });
          yield* Deferred.await(milestone);
          assert.deepEqual(
            harness.events.filter((event) => event.type === "runtime_request.updated"),
            [],
          );
          yield* harness.firstTerminal;
          assert.equal(harness.terminalEvents().length, 1);
          assert.deepEqual(
            assistantMessages(harness.events).map((event) => event.message.text),
            ["RESEARCH_CONTINUES"],
          );
        }).pipe(
          Effect.provide(
            Layer.mergeAll(IdAllocator.layer, McpProviderSessions.layer, NodeServices.layer),
          ),
        ),
      ),
  );

  it.effect.each([
    { kind: "network", decision: "accept" },
    { kind: "network", decision: "decline" },
    { kind: "network", decision: "cancel" },
    { kind: "connector", decision: "accept" },
  ] as const)("retains native research approval and applies %s", ({ kind, decision }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const scenario = `codex-research-approval-${kind}-${decision}`;
        const approval = yield* Deferred.make<RuntimeRequestId>();
        const base = finalAnswerTranscript(scenario, [
          { id: "answer", text: "RESEARCH_CONTINUES" },
        ]);
        const networkPermissions = { network: { enabled: true } };
        const transcript = {
          ...base,
          entries: [
            ...base.entries.slice(0, -2),
            {
              type: "emit_inbound" as const,
              label: `${kind}-approval-request`,
              frame: {
                id: 77,
                method:
                  kind === "network"
                    ? "item/permissions/requestApproval"
                    : "mcpServer/elicitation/request",
                params: {
                  threadId: `native-${scenario}-thread`,
                  turnId: `native-${scenario}-turn`,
                  ...(kind === "network"
                    ? {
                        cwd: "/workspace",
                        itemId: "network-grant",
                        startedAtMs: 1782622440500,
                        permissions: networkPermissions,
                      }
                    : {
                        serverName: "jira",
                        mode: "form",
                        requestedSchema: {
                          type: "object",
                          properties: {
                            confirm: { type: "string", enum: ["allow_once", "decline"] },
                          },
                          required: ["confirm"],
                        },
                        message: "Authorize Jira research access",
                      }),
                },
              },
            },
            {
              type: "expect_outbound" as const,
              label: `${kind}-approved`,
              frame: {
                id: 77,
                result:
                  kind === "network"
                    ? {
                        permissions: decision === "accept" ? networkPermissions : {},
                        scope: "turn",
                      }
                    : { action: "accept", content: { confirm: "allow_once" } },
              },
            },
            ...base.entries.slice(-2),
          ],
        };
        const harness = yield* makeCodexReplayHarness(transcript, (event) =>
          event.type === "runtime_request.updated"
            ? Deferred.succeed(approval, event.runtimeRequest.id).pipe(Effect.asVoid)
            : Effect.void,
        );
        const now = yield* DateTime.now;
        yield* harness.runtime.startTurn({
          ...makeCodexTestTurnInput({
            threadId: harness.threadId,
            providerThread: harness.providerThread,
            now,
            attemptId: RunAttemptId.make(`attempt-${scenario}`),
            text: "Reply with the requested recovery marker.",
          }),
          runtimePolicy: { ...CODEX_TEST_RUNTIME_POLICY, toolAccess: "research" },
        });
        const requestId = yield* Deferred.await(approval);
        assert.deepEqual(harness.terminalEvents(), []);
        assert.deepEqual(assistantMessages(harness.events), []);
        yield* harness.runtime.respondToRuntimeRequest({ requestId, decision });
        yield* harness.firstTerminal;
        assert.deepEqual(
          assistantMessages(harness.events).map((event) => event.message.text),
          ["RESEARCH_CONTINUES"],
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(IdAllocator.layer, McpProviderSessions.layer, NodeServices.layer),
        ),
      ),
    ),
  );
});
