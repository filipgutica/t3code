import type { WorkbenchEpic, WorkbenchTicketId } from "@t3tools/contracts";
import type {
  EnvironmentId,
  WorkbenchProjectId,
  WorkbenchTicket,
  WorkbenchJiraLocalTicketMigrationItem,
  WorkbenchJiraLocalEpicMigrationItem,
} from "@t3tools/contracts";
import { useMemo, useCallback, useState } from "react";
import { getAssignmentsForTicket } from "./workbench.logic";
import {
  getWorkbenchJiraBindingSprints,
  isWorkbenchJiraEpic,
  resolveWorkbenchJiraEpicKey,
} from "./workbenchJira.logic";
import type { useWorkbenchPageData } from "./useWorkbenchPageData";
import type { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";
import type { useWorkbenchJiraBindings } from "./useWorkbenchJiraBindings";

export function useWorkbenchBoardData({
  environmentId,
  pageData,
  selection,
  jiraSyncNotice,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly pageData: ReturnType<typeof useWorkbenchPageData>;
  readonly selection: ReturnType<typeof useWorkbenchPageSelection>;
  readonly jiraSyncNotice: ReturnType<typeof useWorkbenchJiraBindings>["jiraSyncNotice"];
}) {
  const { projects, snapshot, jiraSnapshot, optimisticStatus } = pageData;
  const { selectedProject, selectedEpic, selectedTicket } = selection;
  const [boardGroupMode, setBoardGroupMode] = useState<"none" | "epic">("none");
  const [jiraBoardFilter, setJiraBoardFilter] = useState<{
    readonly environmentId: EnvironmentId;
    readonly projectId: WorkbenchProjectId;
  } | null>(null);
  const jiraIssueLinksByTicketId = useMemo(
    () => new Map(optimisticStatus.issueLinks.map((link) => [link.ticketId, link])),
    [optimisticStatus.issueLinks],
  );
  const isTicketVisible = useCallback(
    (ticket: WorkbenchTicket) =>
      ticket.archivedAt == null && jiraIssueLinksByTicketId.get(ticket.id)?.active !== false,
    [jiraIssueLinksByTicketId],
  );
  const projectTickets = useMemo(
    () =>
      optimisticStatus.tickets.filter(
        (ticket) => ticket.projectId === selectedProject?.id && isTicketVisible(ticket),
      ),
    [isTicketVisible, selectedProject?.id, optimisticStatus.tickets],
  );
  const projectJiraIssueLinks = useMemo(() => {
    const ticketIds = new Set(projectTickets.map((ticket) => ticket.id));
    return (jiraSnapshot?.issueLinks ?? []).filter(
      (link) => link.active && ticketIds.has(link.ticketId),
    );
  }, [jiraSnapshot?.issueLinks, projectTickets]);
  const selectedEpicTickets = useMemo(
    () => projectTickets.filter((ticket) => ticket.epicId === selectedEpic?.id),
    [projectTickets, selectedEpic?.id],
  );
  const linkedT3Projects = selectedProject
    ? projects.filter((project) => selectedProject.linkedProjectIds.includes(project.id))
    : [];
  const projectEpics = selectedProject
    ? (snapshot?.epics.filter((epic) => epic.projectId === selectedProject.id) ?? [])
    : [];
  const activeProjectEpics = projectEpics.filter((epic) => epic.archivedAt === null);
  const effectiveBoardGroupMode = projectEpics.length > 0 ? boardGroupMode : "none";
  const { jiraBinding, activeJiraSyncNotice, selectedJiraEpicUrl, jiraSprintLinks } =
    getJiraBoardPresentation({
      environmentId,
      jiraSnapshot,
      selectedProject,
      selectedEpic,
      jiraSyncNotice,
    });
  const activeJiraTicketIds = new Set(
    (jiraSnapshot?.issueLinks ?? []).filter((link) => link.active).map((link) => link.ticketId),
  );
  const jiraManagedTicketIds = new Set(
    (jiraSnapshot?.issueLinks ?? []).map((link) => link.ticketId),
  );
  const { showJiraImportedOnly, boardTickets, boardEpics, boardGroupModeForView } =
    getBoardGrouping({
      environmentId,
      jiraBoardFilter,
      selectedProject,
      projectTickets,
      projectEpics,
      jiraManagedTicketIds,
      effectiveBoardGroupMode,
    });
  const jiraOwnershipKnown = jiraSnapshot !== null;
  const localTicketsForJiraMigration: ReadonlyArray<WorkbenchJiraLocalTicketMigrationItem> =
    projectTickets
      .filter((ticket) => !jiraManagedTicketIds.has(ticket.id))
      .map(({ id, revision }) => ({ id, revision }));
  const localEpicsForJiraMigration: ReadonlyArray<WorkbenchJiraLocalEpicMigrationItem> =
    activeProjectEpics
      .filter(
        (epic) =>
          jiraBinding === null ||
          !isWorkbenchJiraEpic({
            epicId: epic.id,
            bindingId: jiraBinding.id,
            epicLinks: jiraSnapshot?.epicLinks,
          }),
      )
      .map(({ id, updatedAt }) => ({ id, updatedAt }));
  const selectedAssignments = selectedTicket
    ? getAssignmentsForTicket(snapshot?.assignments ?? [], selectedTicket.id)
    : [];
  return {
    jiraIssueLinksByTicketId,
    projectTickets,
    projectJiraIssueLinks,
    selectedEpicTickets,
    linkedT3Projects,
    projectEpics,
    activeProjectEpics,
    jiraBinding,
    activeJiraSyncNotice,
    selectedJiraEpicUrl,
    jiraSprintLinks,
    activeJiraTicketIds,
    jiraManagedTicketIds,
    showJiraImportedOnly,
    boardTickets,
    boardEpics,
    boardGroupModeForView,
    jiraOwnershipKnown,
    localTicketsForJiraMigration,
    localEpicsForJiraMigration,
    selectedAssignments,
    setBoardGroupMode,
    setJiraBoardFilter,
  };
}

function getJiraBoardPresentation({
  environmentId,
  jiraSnapshot,
  selectedProject,
  selectedEpic,
  jiraSyncNotice,
}: {
  environmentId: EnvironmentId | null;
  jiraSnapshot: ReturnType<typeof useWorkbenchPageData>["jiraSnapshot"];
  selectedProject: ReturnType<typeof useWorkbenchPageSelection>["selectedProject"];
  selectedEpic: ReturnType<typeof useWorkbenchPageSelection>["selectedEpic"];
  jiraSyncNotice: ReturnType<typeof useWorkbenchJiraBindings>["jiraSyncNotice"];
}) {
  const jiraBinding =
    jiraSnapshot?.bindings.find((binding) => binding.projectId === selectedProject?.id) ?? null;
  const jiraSiteUrl = jiraSnapshot?.connections.find(
    (connection) => connection.id === jiraBinding?.connectionId,
  )?.siteUrl;
  const activeJiraSyncNotice =
    jiraBinding !== null &&
    selectedProject !== null &&
    jiraSyncNotice?.environmentId === environmentId &&
    jiraSyncNotice.projectId === selectedProject.id &&
    jiraSyncNotice.bindingId === jiraBinding.id
      ? jiraSyncNotice
      : null;
  const selectedJiraEpicKey =
    jiraBinding && selectedEpic
      ? resolveWorkbenchJiraEpicKey({
          bindingId: jiraBinding.id,
          epicId: selectedEpic.id,
          epicLinks: jiraSnapshot?.epicLinks,
          issueLinks: jiraSnapshot?.issueLinks,
        })
      : null;
  const selectedJiraEpicUrl =
    selectedJiraEpicKey && jiraSiteUrl
      ? new URL(`/browse/${encodeURIComponent(selectedJiraEpicKey)}`, jiraSiteUrl).toString()
      : null;
  const jiraSprintLinks =
    jiraBinding && jiraSiteUrl
      ? getWorkbenchJiraBindingSprints(jiraBinding).map((sprint) => {
          const url = new URL("/secure/RapidBoard.jspa", jiraSiteUrl);
          url.searchParams.set("rapidView", String(jiraBinding.boardId));
          url.searchParams.set("projectKey", jiraBinding.jiraProjectKey);
          url.searchParams.set("sprint", String(sprint.id));
          return { ...sprint, url: url.toString() };
        })
      : [];
  return { jiraBinding, activeJiraSyncNotice, selectedJiraEpicUrl, jiraSprintLinks };
}

function getBoardGrouping({
  environmentId,
  jiraBoardFilter,
  selectedProject,
  projectTickets,
  projectEpics,
  jiraManagedTicketIds,
  effectiveBoardGroupMode,
}: {
  environmentId: EnvironmentId | null;
  jiraBoardFilter: { environmentId: EnvironmentId; projectId: WorkbenchProjectId } | null;
  selectedProject: ReturnType<typeof useWorkbenchPageSelection>["selectedProject"];
  projectTickets: ReadonlyArray<WorkbenchTicket>;
  projectEpics: ReadonlyArray<WorkbenchEpic>;
  jiraManagedTicketIds: ReadonlySet<WorkbenchTicketId>;
  effectiveBoardGroupMode: "none" | "epic";
}) {
  const showJiraImportedOnly =
    jiraBoardFilter !== null &&
    jiraBoardFilter.environmentId === environmentId &&
    jiraBoardFilter.projectId === selectedProject?.id;
  const boardTickets = showJiraImportedOnly
    ? projectTickets.filter((ticket) => jiraManagedTicketIds.has(ticket.id))
    : projectTickets;
  const boardEpics = showJiraImportedOnly
    ? projectEpics.filter((epic) => boardTickets.some((ticket) => ticket.epicId === epic.id))
    : projectEpics;
  const boardGroupModeForView = boardEpics.length > 0 ? effectiveBoardGroupMode : "none";
  return { showJiraImportedOnly, boardTickets, boardEpics, boardGroupModeForView };
}
