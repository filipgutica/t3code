import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchOperationError,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import { WorkbenchJiraService } from "@t3tools/workbench/jira/WorkbenchJiraService";
import { WorkbenchJiraRepository } from "@t3tools/workbench/jira/WorkbenchJiraRepository";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { McpWritePolicy } from "../mcp/McpWritePolicy.ts";
import * as RuntimePolicy from "../orchestration-v2/RuntimePolicy.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ProviderInstanceRegistry } from "../provider/ProviderInstanceRegistry.ts";
import { WorkspaceCleanupPolicy } from "../workspace/WorkspaceCleanupPolicy.ts";
import { WorkbenchStore } from "./WorkbenchStore.ts";
import { WorkbenchHostPoliciesLayer, withWorkbenchHttpRoutes } from "./serverLayer.ts";

it.effect(
  "production Workbench composition exposes the callback and installs all host policies",
  () =>
    Effect.gen(function* () {
      const handler = yield* HttpRouter.toHttpEffect(
        withWorkbenchHttpRoutes(
          HttpRouter.add(
            "GET",
            "/native-composition-probe",
            HttpServerResponse.empty({ status: 204 }),
          ),
        ).pipe(
          Layer.provide(
            Layer.mock(WorkbenchJiraService)({
              completeAuth: () => Effect.succeed({ connections: [] }),
            }),
          ),
        ),
      );
      const response = yield* handler.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(
            new Request(
              "http://localhost/oauth/workbench/jira/callback?code=code&state=" + "A_-0".repeat(8),
            ),
          ),
        ),
      );
      assert.strictEqual(response.status, 200);
      const nativeResponse = yield* handler.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(new Request("http://localhost/native-composition-probe")),
        ),
      );
      assert.strictEqual(nativeResponse.status, 204);

      const writePolicy = yield* McpWritePolicy;
      assert.strictEqual(
        (yield* Effect.flip(writePolicy.assertAllowed(ThreadId.make("planning")))).code,
        "capability_denied",
      );
      const decorator = yield* RuntimePolicy.RuntimePolicyDecorator;
      const native = {
        resolve: () =>
          Effect.succeed({
            cwd: "/repo",
            runtimeMode: "full-access" as const,
            interactionMode: "default" as const,
          }),
      };
      const threadId = ThreadId.make("planning");
      const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "test" };
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
        (yield* Effect.flip(decorator.decorate(native).resolve(input)))._tag,
        "RuntimePolicyResolveError",
      );
      const cleanup = yield* WorkspaceCleanupPolicy;
      assert.isFalse(
        yield* cleanup.canRemove({
          worktreesDir: "/worktrees",
          worktreePath: "/worktrees/workbench/ticket",
        }),
      );
      assert.isTrue(
        yield* cleanup.canRemove({ worktreesDir: "/worktrees", worktreePath: "/worktrees/native" }),
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(
        WorkbenchHostPoliciesLayer.pipe(
          Layer.provide(
            Layer.mock(WorkbenchStore)({
              getTicketDraftForThread: () =>
                Effect.fail(
                  new WorkbenchOperationError({
                    code: "persistence_failed",
                    message: "storage unavailable",
                  }),
                ),
            }),
          ),
          Layer.provide(Layer.mock(ProjectStoreV2)({})),
          Layer.provide(Layer.mock(ProviderInstanceRegistry)({})),
          Layer.provide(Layer.mock(WorkbenchJiraRepository)({})),
          Layer.provide(NodeServices.layer),
        ),
      ),
    ),
);
