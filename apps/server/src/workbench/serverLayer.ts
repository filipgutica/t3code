import { ClaudeQueryOptionsDecorator } from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import * as ClaudeResearchPolicy from "./providers/ClaudeResearchPolicy.ts";
import * as Layer from "effect/Layer";
import { workbenchJiraOAuthRouteLayer } from "./jira/http.ts";

import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as WorkbenchOrchestrationReactor from "./OrchestrationReactor.ts";
import * as TicketSettlement from "./TicketSettlement.ts";
import * as TicketExecutionReactor from "./TicketExecutionReactor.ts";
import * as TicketDraftService from "./TicketDraftService.ts";
import * as TicketPlanningRuntime from "./TicketPlanningRuntime.ts";
import * as TicketSummaryService from "./TicketSummaryService.ts";
import * as TicketWorkspaceService from "./TicketWorkspaceService.ts";
import * as WorkbenchStore from "./WorkbenchStore.ts";
import * as WorkbenchWorktreeOwnership from "./worktreeOwnership.ts";
import * as WorkbenchJiraService from "./jira/WorkbenchJiraService.ts";
import * as JiraRepository from "@t3tools/workbench/jira/WorkbenchJiraRepository";
import * as JiraResearch from "./mcp/JiraResearchService.ts";
import * as JiraResearchToolkit from "./mcp/JiraResearchToolkit.ts";
import * as WorkspaceLifecycleService from "@t3tools/workbench/WorkspaceLifecycleService";

const WorkbenchStoreLayerLive = WorkbenchStore.WorkbenchStoreLive.pipe(
  Layer.provide(SqlitePersistence.layerConfig),
);

export const withWorkbenchHttpRoutes = <A, E, R>(routes: Layer.Layer<A, E, R>) =>
  Layer.mergeAll(routes, workbenchJiraOAuthRouteLayer);

export const WorkbenchProviderPoliciesLayerLive = Layer.succeed(ClaudeQueryOptionsDecorator, {
  decorate: ClaudeResearchPolicy.decorate,
});

export const WorkbenchHostPoliciesLayerLive = Layer.mergeAll(
  WorkbenchProviderPoliciesLayerLive,
  TicketPlanningRuntime.layerRuntimePolicyDecorator,
  TicketPlanningRuntime.layerMcpWritePolicy,
  WorkbenchWorktreeOwnership.layer,
).pipe(
  Layer.provide(WorkbenchStoreLayerLive),
  Layer.provide(ProjectStore.layer),
  Layer.provide(JiraRepository.layerSql.pipe(Layer.provide(SqlitePersistence.layerConfig))),
);
const WorkbenchJiraLayerLive = WorkbenchJiraService.layerLive.pipe(
  Layer.provide(SqlitePersistence.layerConfig),
  Layer.provide(WorkbenchStoreLayerLive),
);
export const WorkbenchMcpLayerLive = JiraResearchToolkit.layer.pipe(
  Layer.provide(JiraResearch.layer),
  Layer.provide(WorkbenchJiraLayerLive),
  Layer.provide(WorkbenchStoreLayerLive),
);
const WorkspaceLifecycleLayerLive = WorkspaceLifecycleService.layer.pipe(
  Layer.provide(WorkbenchJiraLayerLive),
  Layer.provide(WorkbenchStoreLayerLive),
);

const TicketDraftLayerLive = TicketDraftService.layer.pipe(
  Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(SqlitePersistence.layerConfig))),
  Layer.provide(WorkbenchStoreLayerLive),
  Layer.provide(WorkbenchJiraLayerLive),
  Layer.provide(
    TicketWorkspaceService.TicketWorkspaceServiceLive.pipe(Layer.provide(WorkbenchStoreLayerLive)),
  ),
);

export const WorkbenchServicesLayerLive = Layer.empty.pipe(
  Layer.provideMerge(WorkbenchHostPoliciesLayerLive),
  Layer.provideMerge(TicketDraftLayerLive),
  Layer.provideMerge(WorkspaceLifecycleLayerLive),
  Layer.provideMerge(WorkbenchJiraLayerLive),
  Layer.provideMerge(TicketWorkspaceService.TicketWorkspaceServiceLive),
  Layer.provideMerge(TicketSummaryService.TicketSummaryServiceLive),
  Layer.provideMerge(WorkbenchStoreLayerLive),
);

const TicketExecutionReactorLayerLive = TicketExecutionReactor.layer.pipe(
  Layer.provide(WorkbenchJiraLayerLive),
  Layer.provide(WorkbenchStoreLayerLive),
);

const TicketSettlementLayerLive = TicketSettlement.layer.pipe(
  Layer.provide(WorkbenchStoreLayerLive),
);

const WorkbenchReactorsLayerLive = Layer.empty.pipe(
  Layer.provideMerge(TicketExecutionReactorLayerLive),
  Layer.provideMerge(TicketSettlementLayerLive),
);

export const WorkbenchRuntimeReactorLayerLive = WorkbenchOrchestrationReactor.layer.pipe(
  Layer.provideMerge(WorkbenchReactorsLayerLive),
);
