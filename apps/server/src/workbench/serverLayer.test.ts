import { ClaudeQueryOptionsDecorator } from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import * as SqlClient from "effect/sql/SqlClient";
import { vi } from "vite-plus/test";
import { McpWritePolicy } from "../mcp/McpWritePolicy.ts";
import * as RuntimePolicy from "../orchestration-v2/RuntimePolicy.ts";
import { WorkspaceCleanupPolicy } from "../workspace/WorkspaceCleanupPolicy.ts";
import * as ServerConfig from "../config.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "./WorkbenchStore.ts";
import { runServer } from "../server.ts";

type RuntimeContext =
  | McpWritePolicy
  | RuntimePolicy.RuntimePolicyDecorator
  | ClaudeQueryOptionsDecorator
  | SqlClient.SqlClient;
type ServedApp = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | Scope.Scope
>;

// Observe the contexts delivered to existing consumers; all Workbench layers remain real.
const probes = vi.hoisted(() => ({
  runtime: vi.fn<(context: Context.Context<RuntimeContext>) => Effect.Effect<void>>(),
  providers:
    vi.fn<(context: Context.Context<ClaudeQueryOptionsDecorator>) => Effect.Effect<void>>(),
  cleanup: vi.fn<(context: Context.Context<WorkspaceCleanupPolicy>) => Effect.Effect<void>>(),
  serve: vi.fn<(app: ServedApp) => Effect.Effect<void>>(),
}));

vi.mock("../orchestration-v2/runtimeLayer.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../orchestration-v2/runtimeLayer.ts")>();
  const Effect = await import("effect/Effect");
  const Layer = await import("effect/Layer");
  return {
    ...original,
    layerProduction: Layer.merge(
      original.layerProduction,
      Layer.effectDiscard(Effect.context<RuntimeContext>().pipe(Effect.flatMap(probes.runtime))),
    ),
  };
});

vi.mock("../storageCleanup.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../storageCleanup.ts")>();
  const Effect = await import("effect/Effect");
  const Layer = await import("effect/Layer");
  return {
    ...original,
    layer: Layer.merge(
      original.layer,
      Layer.effectDiscard(
        Effect.context<WorkspaceCleanupPolicy>().pipe(Effect.flatMap(probes.cleanup)),
      ),
    ),
  };
});

// Keep startup/background work parked and replace only host I/O boundaries.
vi.mock("../serverRuntimeStartup.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../serverRuntimeStartup.ts")>();
  const Effect = await import("effect/Effect");
  const Layer = await import("effect/Layer");
  return {
    ...original,
    layerWithOptions: () =>
      Layer.mock(original.ServerRuntimeStartup)({
        awaitCommandReady: Effect.void,
        markHttpListening: Effect.void,
      }),
  };
});

vi.mock("@effect/platform-node/NodeHttpServer", async (importOriginal) => {
  const original = await importOriginal<typeof import("@effect/platform-node/NodeHttpServer")>();
  const Effect = await import("effect/Effect");
  const Layer = await import("effect/Layer");
  const { HttpServer } = await import("effect/http/HttpServer");
  const NetAddress = await import("effect/net/NetAddress");
  return {
    ...original,
    layer: () =>
      Layer.succeed(HttpServer, {
        address: NetAddress.inetAddressUnsafe(NetAddress.ipv4Loopback, 0),
        serve: <E>(
          app: Effect.Effect<
            HttpServerResponse.HttpServerResponse,
            E,
            HttpServerRequest.HttpServerRequest | Scope.Scope
          >,
        ) =>
          Effect.gen(function* () {
            const context = yield* Effect.context<
              HttpServerRequest.HttpServerRequest | Scope.Scope
            >();
            yield* probes.serve(app.pipe(Effect.orDie, Effect.provide(context)));
          }),
      }).pipe(Layer.provideMerge(original.layerHttpServices)),
  };
});

vi.mock("../provider/ProviderInstanceRegistryHydration.ts", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../provider/ProviderInstanceRegistryHydration.ts")>();
  const { layer } = await import("../provider/ProviderInstanceRegistry.ts");
  const Effect = await import("effect/Effect");
  const Layer = await import("effect/Layer");
  return {
    ...original,
    layer: Layer.merge(
      layer<never>({ drivers: [], configMap: {} }),
      Layer.effectDiscard(
        Effect.context<ClaudeQueryOptionsDecorator>().pipe(Effect.flatMap(probes.providers)),
      ),
    ),
  };
});

vi.mock("../provider/ModelManifest.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../provider/ModelManifest.ts")>();
  return { ...original, layer: original.layerTest };
});

vi.mock("../resourceTelemetry/NativeTelemetryClient.ts", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../resourceTelemetry/NativeTelemetryClient.ts")>();
  return { ...original, layer: original.layerTest() };
});

vi.mock("effect/http/FetchHttpClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("effect/http/FetchHttpClient")>();
  const Effect = await import("effect/Effect");
  const Layer = await import("effect/Layer");
  const HttpClient = await import("effect/http/HttpClient");
  return {
    ...original,
    layer: Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die("Unexpected outbound HTTP request")),
    ),
  };
});

vi.mock("../git/GitWorkflowService.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../git/GitWorkflowService.ts")>();
  const Effect = await import("effect/Effect");
  const Layer = await import("effect/Layer");
  return {
    ...original,
    layer: Layer.mock(original.GitWorkflowService)({
      isRepository: () => Effect.succeed(true),
    }),
  };
});

vi.mock("@effect/platform-node/NodeChildProcessSpawner", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@effect/platform-node/NodeChildProcessSpawner")>();
  const Effect = await import("effect/Effect");
  const Layer = await import("effect/Layer");
  const { ChildProcessSpawner } = await import("effect/process/ChildProcessSpawner");
  return {
    ...original,
    layer: Layer.mock(ChildProcessSpawner)({
      spawn: () => Effect.die("Unexpected child process"),
    }),
  };
});

vi.mock("../os-jank.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../os-jank.ts")>();
  const Effect = await import("effect/Effect");
  return { ...original, fixPath: () => Effect.void };
});

vi.mock("@t3tools/provider-opencode/server/OpenCodeServerLedger", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@t3tools/provider-opencode/server/OpenCodeServerLedger")>();
  const Layer = await import("effect/Layer");
  return { ...original, layer: () => Layer.mock(original.OpenCodeServerLedger)({}) };
});

it.effect("runServer mounts the Jira callback and installs Workbench host policies", () =>
  Effect.gen(function* () {
    const runtime = yield* Deferred.make<Context.Context<RuntimeContext>>();
    const providers = yield* Deferred.make<Context.Context<ClaudeQueryOptionsDecorator>>();
    const cleanupContext = yield* Deferred.make<Context.Context<WorkspaceCleanupPolicy>>();
    const served = yield* Deferred.make<ServedApp>();
    probes.runtime.mockImplementation((context) =>
      Deferred.succeed(runtime, context).pipe(Effect.asVoid),
    );
    probes.providers.mockImplementation((context) =>
      Deferred.succeed(providers, context).pipe(Effect.asVoid),
    );
    probes.cleanup.mockImplementation((context) =>
      Deferred.succeed(cleanupContext, context).pipe(Effect.asVoid),
    );
    probes.serve.mockImplementation((app) => Deferred.succeed(served, app).pipe(Effect.asVoid));
    const server = yield* runServer.pipe(Effect.forkScoped);
    yield* Effect.gen(function* () {
      const handler = yield* Deferred.await(served);
      const response = yield* handler.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(
            new Request("http://localhost/oauth/workbench/jira/callback?error=access_denied"),
          ),
        ),
      );
      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.headers["cache-control"], "no-store");
      assert.deepStrictEqual(
        response.body,
        HttpServerResponse.text(
          "Jira authorization was cancelled. Return to the desktop app and try again.",
        ).body,
      );

      const nativeResponse = yield* handler.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(new Request("http://localhost/not-a-static-asset")),
        ),
      );
      assert.strictEqual(nativeResponse.status, 503);

      const providerPolicy = Context.get(
        yield* Deferred.await(providers),
        ClaudeQueryOptionsDecorator,
      );
      const planningPolicy = {
        runtimeMode: "auto" as const,
        interactionMode: "plan" as const,
        cwd: "/repo",
        toolAccess: "research" as const,
        sandboxPolicy: { type: "readOnly" },
      };
      const research = providerPolicy.decorate({
        runtimePolicy: planningPolicy,
        mcpServerStatus: async () => undefined,
      });
      assert.equal(research.options?.({}).permissionPrompts, "none");
      const context = yield* Deferred.await(runtime);
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const store = yield* WorkbenchStore;
        const threadId = ThreadId.make("planning");
        const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "test" };
        const workspaceId = WorkbenchProjectId.make("workspace");
        const createdAt = "2026-10-17T00:00:00.000Z";
        yield* sql`INSERT INTO projection_projects
        (project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at)
        VALUES ('repo', 'Repository', '/repo', '[]', ${createdAt}, ${createdAt}, NULL)`;
        yield* store.createProject({
          id: workspaceId,
          title: "Planning",
          linkedProjectIds: [ProjectId.make("repo")],
          createdAt,
        });
        yield* store.beginTicketDraft({
          id: WorkbenchTicketId.make("draft"),
          projectId: workspaceId,
          threadId,
          modelSelection,
        });
        const writePolicy = yield* McpWritePolicy;
        assert.strictEqual(
          yield* writePolicy.assertAllowed(threadId).pipe(
            Effect.match({
              onFailure: (error) => error.code,
              onSuccess: () => "allowed",
            }),
          ),
          "capability_denied",
        );
        yield* writePolicy.assertAllowed(ThreadId.make("native"));
        assert.strictEqual(yield* ClaudeQueryOptionsDecorator, providerPolicy);
        const decorator = yield* RuntimePolicy.RuntimePolicyDecorator;
        const native = {
          resolve: () =>
            Effect.succeed({
              cwd: "/repo",
              runtimeMode: "full-access" as const,
              interactionMode: "default" as const,
            }),
        };
        const now = DateTime.makeUnsafe("2026-10-17T00:00:00Z");
        const thread: OrchestrationV2AppThread = {
          id: threadId,
          projectId: ProjectId.make("repo"),
          title: "Planning",
          createdBy: "user",
          creationSource: "web",
          providerInstanceId: modelSelection.instanceId,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          worktreePath: null,
          branch: null,
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          deletedAt: null,
          settledAt: null,
          settledOverride: null,
          lastVisitedAt: null,
        };
        const input = { thread, modelSelection };
        assert.strictEqual(
          yield* decorator
            .decorate(native)
            .resolve(input)
            .pipe(
              Effect.match({
                onFailure: (error) => error.cause,
                onSuccess: () => "resolved",
              }),
            ),
          "This provider does not support enforced read-only ticket planning.",
        );
      }).pipe(
        Effect.provide(WorkbenchStoreLive.pipe(Layer.provideMerge(Layer.succeedContext(context)))),
      );
      const cleanup = Context.get(yield* Deferred.await(cleanupContext), WorkspaceCleanupPolicy);
      assert.isFalse(
        yield* cleanup.canRemove({
          worktreesDir: "/worktrees",
          worktreePath: "/worktrees/workbench/ticket",
        }),
      );
      assert.isTrue(
        yield* cleanup.canRemove({ worktreesDir: "/worktrees", worktreePath: "/worktrees/native" }),
      );
    }).pipe(Effect.raceFirst(Fiber.join(server)));
  }).pipe(
    Effect.scoped,
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "workbench-server-composition-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
);
