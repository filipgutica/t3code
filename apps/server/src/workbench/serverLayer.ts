import * as Layer from "effect/Layer";

import { layerConfig as SqlitePersistenceLayerLive } from "../persistence/Layers/Sqlite.ts";
import * as TicketSettlement from "./TicketSettlement.ts";
import * as TicketExecutionReactor from "./TicketExecutionReactor.ts";
import * as TicketSummaryService from "./TicketSummaryService.ts";
import * as TicketWorkspaceService from "./TicketWorkspaceService.ts";
import * as WorkbenchStore from "./WorkbenchStore.ts";
import * as WorkbenchJiraService from "./jira/WorkbenchJiraService.ts";

const WorkbenchStoreLayerLive = WorkbenchStore.WorkbenchStoreLive.pipe(
  Layer.provide(SqlitePersistenceLayerLive),
);
const WorkbenchJiraLayerLive = WorkbenchJiraService.layerLive.pipe(
  Layer.provide(SqlitePersistenceLayerLive),
  Layer.provide(WorkbenchStoreLayerLive),
);

export const WorkbenchServicesLayerLive = Layer.empty.pipe(
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

export const WorkbenchReactorsLayerLive = Layer.empty.pipe(
  Layer.provideMerge(TicketExecutionReactorLayerLive),
  Layer.provideMerge(TicketSettlementLayerLive),
);
