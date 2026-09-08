export { WorkbenchStore } from "@t3tools/workbench/WorkbenchStore";
export type {
  WorkbenchClaimTicketWorkspaceInput,
  WorkbenchTicketWorkspaceRepositoryReadyInput,
  WorkbenchFailTicketWorkspaceInput,
  WorkbenchReleaseTicketWorkspaceRepositoryInput,
  WorkbenchCompleteTicketWorkspaceInput,
  WorkbenchStartTicketExecutionInput,
  WorkbenchStartTicketExecutionResult,
  WorkbenchClaimTicketWorkspaceReleaseInput,
} from "@t3tools/workbench/WorkbenchStore";

import { WorkbenchStoreLive as WorkbenchStorePackageLive } from "@t3tools/workbench/WorkbenchStore";
import * as Layer from "effect/Layer";

import { WorkbenchNativeAccessLive } from "./WorkbenchNativeAccess.ts";

/** Server composition supplies native T3 projection access to the package store. */
export const WorkbenchStoreLive = WorkbenchStorePackageLive.pipe(
  Layer.provideMerge(WorkbenchNativeAccessLive),
);
