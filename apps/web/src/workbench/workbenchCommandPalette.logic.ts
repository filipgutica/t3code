import type {
  EnvironmentId,
  ScopedThreadRef,
  WorkbenchProjectId,
  WorkbenchSnapshot,
} from "@t3tools/contracts";
import { getWorkbenchContextForThread } from "./workbench.logic";
import type { WorkbenchSearch } from "./workbenchSearch";

/**
 * The Workbench the palette asks for a snapshot. On a Thread page it is the Thread's owning host
 * alone: null while discovery loads or when no Workbench owns the Thread, as a stock server
 * cannot answer.
 */
export const getWorkbenchCommandPaletteEnvironmentId = ({
  threadRef,
  threadOwnerId,
  searchEnvironmentId,
  threadEnvironmentId,
  draftEnvironmentId,
  primaryEnvironmentId,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly threadOwnerId: EnvironmentId | null;
  readonly searchEnvironmentId: EnvironmentId | undefined;
  readonly threadEnvironmentId: EnvironmentId | undefined;
  readonly draftEnvironmentId: EnvironmentId | undefined;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): EnvironmentId | null =>
  threadRef !== null
    ? threadOwnerId
    : (searchEnvironmentId ?? threadEnvironmentId ?? draftEnvironmentId ?? primaryEnvironmentId);

/** Resolve targets only from the selected environment's authoritative Workbench snapshot. */
export const getWorkbenchCommandPaletteTargets = ({
  environmentId,
  snapshot,
  workspaceId,
  threadRef,
}: {
  readonly environmentId: EnvironmentId;
  readonly snapshot: WorkbenchSnapshot;
  readonly workspaceId: WorkbenchProjectId | undefined;
  readonly threadRef: ScopedThreadRef | null;
}) => {
  const context = threadRef
    ? getWorkbenchContextForThread(snapshot, environmentId, threadRef)
    : null;
  const workspace = workspaceId
    ? snapshot.projects.find((project) => project.id === workspaceId)
    : context?.workspace;
  const board: WorkbenchSearch = {
    environmentId,
    ...(workspace ? { workbenchProjectId: workspace.id } : {}),
  };
  return {
    board,
    createTicket:
      workspace && workspace.archivedAt == null ? { ...board, create: "ticket" as const } : null,
    ticket: context
      ? { environmentId, workbenchProjectId: context.workspace.id, ticketId: context.ticket.id }
      : null,
  };
};
