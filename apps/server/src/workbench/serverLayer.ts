import { ClaudeQueryOptionsDecorator } from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import * as ClaudeResearchPolicy from "./providers/ClaudeResearchPolicy.ts";
import * as Layer from "effect/Layer";

import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStoreV2 from "../orchestration-v2/ProjectionStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as WorkbenchOrchestrationReactor from "./OrchestrationReactor.ts";
import * as TicketSettlement from "./TicketSettlement.ts";
import * as TicketExecutionReactor from "./TicketExecutionReactor.ts";
import * as TicketDraftService from "./TicketDraftService.ts";
import * as TicketPlanningRuntime from "./TicketPlanningRuntime.ts";
import * as TicketSummaryService from "./TicketSummaryService.ts";
import * as ThreadRecapService from "./ThreadRecapService.ts";
import * as TicketWorkspaceService from "./TicketWorkspaceService.ts";
import * as WorkbenchStore from "./WorkbenchStore.ts";
import * as WorkbenchWorktreeOwnership from "./worktreeOwnership.ts";
import * as WorkspaceLifecycleService from "@t3tools/workbench/WorkspaceLifecycleService";

const WorkbenchStoreLayerLive = WorkbenchStore.WorkbenchStoreLive.pipe(
  Layer.provide(SqlitePersistence.layerConfig),
);

export const WorkbenchProviderPoliciesLayerLive = Layer.effect(
  ClaudeQueryOptionsDecorator,
  ClaudeResearchPolicy.make,
);

export const WorkbenchHostPoliciesLayerLive = Layer.mergeAll(
  WorkbenchProviderPoliciesLayerLive,
  TicketPlanningRuntime.layerRuntimePolicyDecorator,
  TicketPlanningRuntime.layerMcpWritePolicy,
  WorkbenchWorktreeOwnership.layer,
).pipe(
  Layer.provide(WorkbenchStoreLayerLive),
  Layer.provide(ProjectStore.layer),
  Layer.provide(ProjectionStoreV2.layer),
);
const WorkspaceLifecycleLayerLive = WorkspaceLifecycleService.layer.pipe(
  Layer.provide(WorkbenchStoreLayerLive),
);

const TicketDraftLayerLive = TicketDraftService.layer.pipe(
  Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(SqlitePersistence.layerConfig))),
  Layer.provide(WorkbenchStoreLayerLive),
  Layer.provide(
    TicketWorkspaceService.TicketWorkspaceServiceLive.pipe(Layer.provide(WorkbenchStoreLayerLive)),
  ),
);

export const WorkbenchServicesLayerLive = Layer.empty.pipe(
  Layer.provideMerge(WorkbenchHostPoliciesLayerLive),
  Layer.provideMerge(TicketDraftLayerLive),
  Layer.provideMerge(WorkspaceLifecycleLayerLive),
  Layer.provideMerge(TicketWorkspaceService.TicketWorkspaceServiceLive),
  Layer.provideMerge(TicketSummaryService.TicketSummaryServiceLive),
  Layer.provideMerge(ThreadRecapService.ThreadRecapServiceLive),
  Layer.provideMerge(WorkbenchStoreLayerLive),
);

const TicketExecutionReactorLayerLive = TicketExecutionReactor.layer.pipe(
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
