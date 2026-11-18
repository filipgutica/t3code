import type { EnvironmentId } from "@t3tools/contracts";
import { getWorkbenchBoardRepositories } from "./workbenchRemoteProjects";
import { getAssignmentsForTicket } from "./workbench.logic";
import type { useWorkbenchPageData } from "./useWorkbenchPageData";
import type { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";

export function getWorkbenchBoardData({
  pageData,
  selection,
  environmentId = null,
}: {
  readonly pageData: ReturnType<typeof useWorkbenchPageData>;
  readonly environmentId?: EnvironmentId | null;
  readonly selection: ReturnType<typeof useWorkbenchPageSelection>;
}) {
  const { projects, snapshot, optimisticStatus } = pageData;
  const { selectedProject, selectedTicket } = selection;
  const repositoriesReady = snapshot !== null;
  const projectTickets = optimisticStatus.tickets.filter(
    (ticket) => ticket.projectId === selectedProject?.id && ticket.archivedAt == null,
  );
  const linkedT3Projects = selectedProject
    ? getWorkbenchBoardRepositories({
        board: selectedProject,
        projects,
        environmentId,
        ticketProjectIds: selectedTicket?.repositoryProjectIds,
      })
    : [];
  const selectedAssignments = selectedTicket
    ? getAssignmentsForTicket(snapshot?.assignments ?? [], selectedTicket.id)
    : [];
  return {
    projectTickets,
    linkedT3Projects,
    repositoriesReady,
    selectedAssignments,
  };
}
