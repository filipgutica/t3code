import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as WorkbenchOrchestrationReactor from "./OrchestrationReactor.ts";
import * as TicketSettlement from "./TicketSettlement.ts";
import * as TicketExecutionReactor from "./TicketExecutionReactor.ts";
import * as TicketSummaryService from "./TicketSummaryService.ts";
import * as TicketWorkspaceService from "./TicketWorkspaceService.ts";
import * as WorkbenchStore from "./WorkbenchStore.ts";
import * as WorkbenchJiraService from "./jira/WorkbenchJiraService.ts";
import * as WorkspaceLifecycleService from "@t3tools/workbench/WorkspaceLifecycleService";

const WorkbenchStoreLayerLive = WorkbenchStore.WorkbenchStoreLive.pipe(
  Layer.provide(SqlitePersistence.layerConfig),
);
const WorkbenchJiraLayerLive = WorkbenchJiraService.layerLive.pipe(
  Layer.provide(SqlitePersistence.layerConfig),
  Layer.provide(WorkbenchStoreLayerLive),
);
const WorkspaceLifecycleLayerLive = WorkspaceLifecycleService.layer.pipe(
  Layer.provide(WorkbenchJiraLayerLive),
  Layer.provide(WorkbenchStoreLayerLive),
);

export const WorkbenchServicesLayerLive = Layer.empty.pipe(
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
