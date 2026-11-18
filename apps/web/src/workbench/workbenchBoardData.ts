import type { EnvironmentId } from "@t3tools/contracts";
import {
  getWorkbenchBoardLinkedProjects,
  getWorkbenchBoardRepositories,
  makeWorkbenchRepositoryKeyOf,
} from "./workbenchRemoteProjects";
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
  // Tickets may name any machine's checkout of a repository, so cards and the filter look up
  // every link, while the filter offers each repository once.
  const allLinkedProjects = selectedProject
    ? getWorkbenchBoardLinkedProjects({ board: selectedProject, projects, environmentId })
    : [];
  const repositoriesById = new Map(allLinkedProjects.map((project) => [project.id, project]));
  const shownIds = new Set(linkedT3Projects.map((project) => project.id));
  const repositoryFilterIds = (selectedProject?.linkedProjectIds ?? []).filter(
    (id) => shownIds.has(id) || !repositoriesById.has(id),
  );
  const repositoryKeyOf = makeWorkbenchRepositoryKeyOf({
    board: selectedProject ?? undefined,
    projects,
  });
  const selectedAssignments = selectedTicket
    ? getAssignmentsForTicket(snapshot?.assignments ?? [], selectedTicket.id)
    : [];
  return {
    projectTickets,
    linkedT3Projects,
    repositoriesById,
    repositoryFilterIds,
    repositoryKeyOf,
    repositoriesReady,
    selectedAssignments,
  };
}
