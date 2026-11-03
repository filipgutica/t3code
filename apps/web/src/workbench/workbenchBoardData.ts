import { getAssignmentsForTicket } from "./workbench.logic";
import type { useWorkbenchPageData } from "./useWorkbenchPageData";
import type { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";

export function getWorkbenchBoardData({
  pageData,
  selection,
}: {
  readonly pageData: ReturnType<typeof useWorkbenchPageData>;
  readonly selection: ReturnType<typeof useWorkbenchPageSelection>;
}) {
  const { projects, snapshot, optimisticStatus } = pageData;
  const { selectedProject, selectedTicket } = selection;
  const repositoriesReady = snapshot !== null;
  const projectTickets = optimisticStatus.tickets.filter(
    (ticket) => ticket.projectId === selectedProject?.id && ticket.archivedAt == null,
  );
  const linkedT3Projects = selectedProject
    ? projects.filter((project) => selectedProject.linkedProjectIds.includes(project.id))
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
