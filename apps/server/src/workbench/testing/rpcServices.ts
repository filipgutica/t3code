import { WorkspaceLifecycleService } from "@t3tools/workbench/WorkspaceLifecycleService";
import * as Layer from "effect/Layer";

import { AskForChangeService } from "../AskForChangeService.ts";
import { TicketContextService } from "../TicketContextService.ts";
import { TicketDraftService } from "../TicketDraftService.ts";
import { TicketSummaryService } from "../TicketSummaryService.ts";
import { TicketWorkspaceService } from "../TicketWorkspaceService.ts";
import { WorkbenchStore } from "../WorkbenchStore.ts";

/** For native tests that serve the whole WebSocket layer but never call a Workbench method. */
export const layerUnusedWorkbenchRpcServices = Layer.mergeAll(
  Layer.mock(AskForChangeService)({}),
  Layer.mock(TicketDraftService)({}),
  Layer.mock(TicketContextService)({}),
  Layer.mock(WorkbenchStore)({}),
  Layer.mock(TicketWorkspaceService)({}),
  Layer.mock(TicketSummaryService)({}),
  Layer.mock(WorkspaceLifecycleService)({}),
);
