import type { EnvironmentId } from "@t3tools/contracts";
import { useWorkbenchBoardView } from "./workbenchBoardViewState";
import { getAssignmentsForTicket } from "./workbench.logic";
import type { useWorkbenchPageData } from "./useWorkbenchPageData";
import type { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";

export function useWorkbenchBoardData({
  environmentId,
  pageData,
  selection,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly pageData: ReturnType<typeof useWorkbenchPageData>;
  readonly selection: ReturnType<typeof useWorkbenchPageSelection>;
}) {
  const { projects, snapshot, optimisticStatus } = pageData;
  const { selectedProject, selectedEpic, selectedTicket } = selection;
  const { view, setView } = useWorkbenchBoardView({
    environmentId,
    projectId: selectedProject?.id ?? null,
  });
  const setBoardGroupMode = (groupMode: "none" | "epic") => setView({ groupMode });
  const repositoriesReady = snapshot !== null;
  const projectTickets = optimisticStatus.tickets.filter(
    (ticket) => ticket.projectId === selectedProject?.id && ticket.archivedAt == null,
  );
  const selectedEpicTickets = projectTickets.filter((ticket) => ticket.epicId === selectedEpic?.id);
  const linkedT3Projects = selectedProject
    ? projects.filter((project) => selectedProject.linkedProjectIds.includes(project.id))
    : [];
  const projectEpics = selectedProject
    ? (snapshot?.epics.filter((epic) => epic.projectId === selectedProject.id) ?? [])
    : [];
  const activeProjectEpics = projectEpics.filter((epic) => epic.archivedAt === null);
  const boardGroupModeForView = projectEpics.length > 0 ? view.groupMode : "none";
  const selectedAssignments = selectedTicket
    ? getAssignmentsForTicket(snapshot?.assignments ?? [], selectedTicket.id)
    : [];
  return {
    projectTickets,
    selectedEpicTickets,
    linkedT3Projects,
    repositoriesReady,
    projectEpics,
    activeProjectEpics,
    boardGroupModeForView,
    selectedAssignments,
    setBoardGroupMode,
  };
}
