import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import { WorkbenchJiraService } from "@t3tools/workbench/jira/WorkbenchJiraService";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerRequest } from "effect/http";
import { McpWritePolicy } from "../mcp/McpWritePolicy.ts";
import * as RuntimePolicy from "../orchestration-v2/RuntimePolicy.ts";
import { ProviderInstanceRegistry } from "../provider/ProviderInstanceRegistry.ts";
import { WorkspaceCleanupPolicy } from "../workspace/WorkspaceCleanupPolicy.ts";
import { AcpRegistryCatalog } from "@t3tools/provider-acp-registry/server/AcpRegistrySupport";
import { AcpRegistryRuntimeCoordinator } from "@t3tools/provider-acp-registry/server/AcpRegistryRuntimeCoordinator";
import { AnalyticsService } from "../telemetry/AnalyticsService.ts";
import { AntigravityInstallation } from "../provider/AntigravityInstallation.ts";
import { BackgroundPolicy } from "../background/BackgroundPolicy.ts";
import { BrowserTraceCollector } from "../observability/BrowserTraceCollector.ts";
import { CheckpointDiffQuery } from "../checkpointing/CheckpointDiffQuery.ts";
import { CloudLink } from "../cloud/CloudLink.ts";
import { CodexInstallation } from "../provider/CodexInstallation.ts";
import { DatabaseStorage } from "../persistence/DatabaseStorage.ts";
import { DeviceService } from "../device/DeviceService.ts";
import { DirectEndpoints } from "../environment/DirectEndpoints.ts";
import { EnvironmentAuth } from "../auth/EnvironmentAuth.ts";
import { EnvironmentThemeService } from "../environmentTheme.ts";
import { ExternalLauncher } from "../process/externalLauncher.ts";
import { GitHubCredentials } from "@t3tools/source-control-github/server/GitHubCredentials";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { HostResources } from "../resourceTelemetry/HostResources.ts";
import { Keybindings } from "../keybindings.ts";
import { McpProviderSessions } from "@t3tools/provider-core/server/McpProviderSessions";
import { McpSessionRegistry } from "../mcp/McpSessionRegistry.ts";
import { ModelManifest } from "../provider/ModelManifest.ts";
import { NativeAppIconResolver } from "../assets/NativeAppIconResolver.ts";
import { PairingGrantStore } from "../auth/PairingGrantStore.ts";
import { PortDiscovery } from "../preview/PortScanner.ts";
import { PreviewManager } from "../preview/Manager.ts";
import { ProcessDiagnostics } from "../diagnostics/ProcessDiagnostics.ts";
import { ProcessResourceMonitor } from "../diagnostics/ProcessResourceMonitor.ts";
import { ProjectCloneTracker } from "../project/ProjectCloneTracker.ts";
import { ProjectEnrichmentService } from "../project/ProjectEnrichmentService.ts";
import { ProjectFaviconResolver } from "../project/ProjectFaviconResolver.ts";
import { ProjectSetupScriptRunner } from "../project/ProjectSetupScriptRunner.ts";
import { ProviderLatestVersions } from "@t3tools/provider-core/server/ProviderLatestVersions";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import { PullRequestSyncReactor } from "../orchestration-v2/PullRequestSyncReactor.ts";
import { RelayClient } from "@t3tools/shared/relayClient";
import { RemoteOpenTargets } from "../environment/RemoteOpenTargets.ts";
import { RepositoryIdentityResolver } from "../project/RepositoryIdentityResolver.ts";
import { ResourceTelemetry } from "../resourceTelemetry/ResourceTelemetry.ts";
import { ReviewService } from "../review/ReviewService.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ServerEnvironmentIdentity } from "../environment/ServerEnvironment.ts";
import { ServerLifecycleEvents } from "../serverLifecycleEvents.ts";
import { ServerRuntimeStartup } from "../serverRuntimeStartup.ts";
import * as ServerSecrets from "../auth/ServerSecretStore.ts";
import { ServiceLauncherClient } from "../cloud/serviceLauncherClient.ts";
import { SessionStore } from "../auth/SessionStore.ts";
import { SourceControlRepositoryService } from "../sourceControl/SourceControlRepositoryService.ts";
import { StorageCleanup } from "../storageCleanup.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";
import { ThreadSearch } from "../orchestration-v2/ThreadSearch.ts";
import { TicketDraftService } from "@t3tools/workbench/TicketDraftService";
import { TicketSummaryService } from "@t3tools/workbench/TicketSummaryService";
import { TicketWorkspaceService } from "@t3tools/workbench/TicketWorkspaceService";
import { TraceDiagnostics } from "../diagnostics/TraceDiagnostics.ts";
import { UsageLimitSources } from "../usage/UsageLimitSources.ts";
import { UsageService } from "../usage/UsageService.ts";
import { VcsProcess } from "../vcs/VcsProcess.ts";
import { VcsProvisioningService } from "../vcs/VcsProvisioningService.ts";
import { VcsStatusBroadcaster } from "../vcs/VcsStatusBroadcaster.ts";
import { WorkspaceEntries } from "../workspace/WorkspaceEntries.ts";
import { WorkspaceFileSystem } from "../workspace/WorkspaceFileSystem.ts";
import { WorkspaceLifecycleService } from "@t3tools/workbench/WorkspaceLifecycleService";
import { WorkspacePaths } from "../workspace/WorkspacePaths.ts";
import { WorktreeSetupTracker } from "../project/WorktreeSetupTracker.ts";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as Etag from "effect/http/Etag";
import * as OtlpSerialization from "effect/observability/OtlpSerialization";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "./WorkbenchStore.ts";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as SqlClient from "effect/sql/SqlClient";
import * as Settings from "../serverSettings.ts";
import { HttpClient } from "effect/http";
import { layerMakeRoutes, layerOrchestrationV2Runtime } from "../server.ts";

const dependencies = Layer.mergeAll(
  Layer.mock(AcpRegistryCatalog)({}),
  Layer.mock(AcpRegistryRuntimeCoordinator)({}),
  Layer.mock(AnalyticsService)({}),
  Layer.mock(AntigravityInstallation)({ managedDirectory: "/unused" }),
  Layer.mock(BackgroundPolicy)({}),
  Layer.mock(BrowserTraceCollector)({}),
  Layer.mock(CheckpointDiffQuery)({}),
  Layer.mock(CloudLink)({}),
  Layer.mock(CodexInstallation)({ managedDirectory: "/unused" }),
  Layer.mock(DatabaseStorage)({}),
  Layer.mock(DeviceService)({}),
  Layer.mock(DirectEndpoints)({}),
  Layer.mock(EnvironmentAuth)({}),
  Layer.mock(EnvironmentThemeService)({}),
  Layer.mock(ExternalLauncher)({}),
  Layer.mock(GitHubCredentials)({}),
  Layer.mock(GitVcsDriver)({}),
  Layer.mock(GitWorkflowService)({ isRepository: () => Effect.succeed(true) }),
  Layer.mock(HostResources)({}),
  Layer.mock(Keybindings)({}),
  Layer.mock(McpProviderSessions)({}),
  Layer.mock(McpSessionRegistry)({}),
  Layer.mock(ModelManifest)({}),
  Layer.mock(NativeAppIconResolver)({}),
  Layer.mock(PairingGrantStore)({}),
  Layer.mock(PortDiscovery)({}),
  Layer.mock(PreviewManager)({}),
  Layer.mock(ProcessDiagnostics)({}),
  Layer.mock(ProcessResourceMonitor)({}),
  Layer.mock(ProjectCloneTracker)({}),
  Layer.mock(ProjectEnrichmentService)({}),
  Layer.mock(ProjectFaviconResolver)({}),
  Layer.mock(ProjectSetupScriptRunner)({}),
  Layer.mock(ProviderLatestVersions)({}),
  Layer.mock(ProviderRegistry)({}),
  Layer.mock(PullRequestSyncReactor)({}),
  Layer.mock(RelayClient)({}),
  Layer.mock(RemoteOpenTargets)({}),
  Layer.mock(RepositoryIdentityResolver)({}),
  Layer.mock(ResourceTelemetry)({}),
  Layer.mock(ReviewService)({}),
  Layer.mock(ServerEnvironment)({
    getEnvironmentId: Effect.succeed(EnvironmentId.make("composition-test")),
  }),
  Layer.mock(ServerEnvironmentIdentity)({}),
  Layer.mock(ServerLifecycleEvents)({}),
  Layer.mock(ServerRuntimeStartup)({ awaitCommandReady: Effect.void }),
  Layer.mock(ServiceLauncherClient)({ managed: false }),
  Layer.mock(SessionStore)({ cookieName: "test", legacyCookieName: undefined }),
  Layer.mock(SourceControlRepositoryService)({}),
  Layer.mock(StorageCleanup)({}),
  Layer.mock(TerminalManager)({}),
  Layer.mock(TextGeneration)({}),
  Layer.mock(ThreadSearch)({}),
  Layer.mock(TicketDraftService)({}),
  Layer.mock(TicketSummaryService)({}),
  Layer.mock(TicketWorkspaceService)({}),
  Layer.mock(TraceDiagnostics)({}),
  Layer.mock(UsageLimitSources)({}),
  Layer.mock(UsageService)({}),
  Layer.mock(VcsProcess)({}),
  Layer.mock(VcsProvisioningService)({}),
  Layer.mock(VcsStatusBroadcaster)({}),
  Layer.mock(WorkspaceEntries)({}),
  Layer.mock(WorkspaceFileSystem)({}),
  Layer.mock(WorkspaceLifecycleService)({}),
  Layer.mock(WorkspacePaths)({}),
  Layer.mock(WorktreeSetupTracker)({}),
  Layer.mock(ProviderInstanceRegistry)({
    getInstance: () => Effect.succeed(undefined),
    listInstances: Effect.succeed([]),
  }),
  Layer.mock(WorkbenchJiraService)({
    completeAuth: () => Effect.succeed({ connections: [] }),
  }),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() => Effect.die("Unexpected HTTP request")),
  ),
  Settings.layerTest(),
  NodeHttpPlatform.layer,
  Etag.layerWeak,
  OtlpSerialization.layerJson,
).pipe(
  Layer.provideMerge(ServerSecrets.layer),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "workbench-server-composition-" }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

it.effect(
  "production Workbench composition exposes the callback and installs all host policies",
  () =>
    Effect.gen(function* () {
      const handler = yield* HttpRouter.toHttpEffect(layerMakeRoutes);
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
          HttpServerRequest.fromWeb(new Request("http://localhost/not-a-static-asset")),
        ),
      );
      assert.strictEqual(nativeResponse.status, 503);

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
              onFailure: (error) => error._tag,
              onSuccess: () => "resolved",
            }),
          ),
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
        layerOrchestrationV2Runtime.pipe(
          Layer.provideMerge(Layer.mergeAll(WorkbenchStoreLive, ProjectStore.layer)),
          Layer.provideMerge(SqlitePersistence.layerConfig),
          Layer.provideMerge(dependencies),
        ),
      ),
    ),
);
