import type {
  EnvironmentId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchSnapshot,
} from "@t3tools/contracts";
import { getWorkbenchContextForThread } from "./workbench.logic";
import type { WorkbenchSearch } from "./workbenchSearch";

/** Resolve targets only from the selected environment's authoritative Workbench snapshot. */
export const getWorkbenchCommandPaletteTargets = ({
  environmentId,
  snapshot,
  workspaceId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly snapshot: WorkbenchSnapshot;
  readonly workspaceId: WorkbenchProjectId | undefined;
  readonly threadId: ThreadId | undefined;
}) => {
  const context = threadId ? getWorkbenchContextForThread(snapshot, threadId) : null;
  const workspace = workspaceId
    ? snapshot.projects.find((project) => project.id === workspaceId)
    : context?.workspace;
  const board: WorkbenchSearch = {
    environmentId,
    ...(workspace ? { workbenchProjectId: workspace.id } : {}),
  };
  return {
    board,
    createTicket: workspace ? { ...board, create: "ticket" as const } : null,
    ticket: context
      ? { environmentId, workbenchProjectId: context.workspace.id, ticketId: context.ticket.id }
      : null,
  };
};
