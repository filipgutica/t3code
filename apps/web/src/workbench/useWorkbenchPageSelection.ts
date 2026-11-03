import type {
  EnvironmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WorkbenchSnapshot,
  WorkbenchTicket,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { WorkbenchSearch } from "./workbenchSearch";
import { withWorkbenchEnvironmentSearch } from "./workbenchNavigation";

type WorkbenchSelectionIds = {
  readonly projectId: WorkbenchProjectId | null;
  readonly ticketId: WorkbenchTicketId | null;
};

function workbenchRouteSelection(
  projectId: WorkbenchProjectId | undefined,
  ticketId: WorkbenchTicketId | undefined,
): WorkbenchSelectionIds {
  return { projectId: projectId ?? null, ticketId: ticketId ?? null };
}

function sameWorkbenchSelection(left: WorkbenchSelectionIds, right: WorkbenchSelectionIds) {
  return left.projectId === right.projectId && left.ticketId === right.ticketId;
}

function projectedWorkbenchCreationWaits(
  snapshot: WorkbenchSnapshot | null,
  awaiting: WorkbenchSelectionIds,
) {
  return {
    project:
      awaiting.projectId !== null &&
      snapshot?.projects.some((project) => project.id === awaiting.projectId),
    ticket:
      awaiting.ticketId !== null &&
      (snapshot?.tickets.some((ticket) => ticket.id === awaiting.ticketId) ||
        snapshot?.ticketDrafts?.some((draft) => draft.id === awaiting.ticketId)),
  };
}

function isAwaitingRecord({
  awaitingId,
  selectedId,
  records,
}: {
  awaitingId: string | null;
  selectedId: string | null;
  records: ReadonlyArray<{ readonly id: string }> | undefined;
}) {
  return (
    awaitingId !== null &&
    awaitingId === selectedId &&
    !records?.some((record) => record.id === awaitingId)
  );
}

export function useWorkbenchPageSelection({
  environmentId,
  initialProjectId,
  initialTicketId,
  snapshot,
  tickets,
  pendingAction,
  setError,
  excludedProjectIds,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly initialProjectId: WorkbenchProjectId | undefined;
  readonly initialTicketId: WorkbenchTicketId | undefined;
  readonly snapshot: WorkbenchSnapshot | null;
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly pendingAction: string | null;
  readonly setError: (message: string | null) => void;
  readonly excludedProjectIds?: ReadonlySet<WorkbenchProjectId>;
}) {
  const navigate = useNavigate({ from: "/workbench" });
  const routeSelection = workbenchRouteSelection(initialProjectId, initialTicketId);
  const [selectedProjectId, setSelectedProjectId] = useState<WorkbenchProjectId | null>(
    routeSelection.projectId,
  );
  const [selectedTicketId, setSelectedTicketId] = useState<WorkbenchTicketId | null>(
    routeSelection.ticketId,
  );
  const [awaitingProjectId, setAwaitingProjectId] = useState<WorkbenchProjectId | null>(null);
  const [awaitingTicketId, setAwaitingTicketId] = useState<WorkbenchTicketId | null>(null);
  const [previousRouteSelection, setPreviousRouteSelection] = useState(routeSelection);
  if (!sameWorkbenchSelection(previousRouteSelection, routeSelection)) {
    setPreviousRouteSelection(routeSelection);
    setSelectedProjectId(routeSelection.projectId);
    setSelectedTicketId(routeSelection.ticketId);
  }
  const projectedCreationWaits = projectedWorkbenchCreationWaits(snapshot, {
    projectId: awaitingProjectId,
    ticketId: awaitingTicketId,
  });
  if (projectedCreationWaits.project) setAwaitingProjectId(null);
  if (projectedCreationWaits.ticket) setAwaitingTicketId(null);
  const selectedRouteMatches = sameWorkbenchSelection(routeSelection, {
    projectId: selectedProjectId,
    ticketId: selectedTicketId,
  });
  const { awaitingSelectedProject, selectedProject, selectedTicket } =
    resolveWorkbenchSelectedRecords({
      snapshot,
      tickets,
      awaitingProjectId,
      selectedProjectId,
      selectedTicketId,
      excludedProjectIds,
    });
  const updateRouteSelection = (projectId: WorkbenchProjectId, ticketId?: WorkbenchTicketId) => {
    return navigate({
      to: "/workbench",
      search: withWorkbenchEnvironmentSearch(
        environmentId,
        ticketId === undefined
          ? { workbenchProjectId: projectId }
          : { workbenchProjectId: projectId, ticketId },
      ),
      replace: true,
    });
  };

  const closeWorkItem = () => {
    setAwaitingTicketId(null);
    setSelectedTicketId(null);
    if (selectedProject) void updateRouteSelection(selectedProject.id);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- normalizes the external router after authoritative records disappear, while preserving pending creation routes
  useEffect(() => {
    if (snapshot === null) return;
    // Let a new route selection reach local state before normalizing missing records.
    if (!selectedRouteMatches) return;
    if (
      isAwaitingRecord({
        awaitingId: awaitingProjectId,
        selectedId: selectedProjectId,
        records: snapshot?.projects,
      })
    )
      return;
    if (
      isAwaitingRecord({
        awaitingId: awaitingTicketId,
        selectedId: selectedTicketId,
        records: [...snapshot.tickets, ...(snapshot.ticketDrafts ?? [])],
      })
    )
      return;
    // A draft uses the future ticket id in the route before a Ticket record exists.
    if (
      snapshot.ticketDrafts?.some(
        (draft) =>
          draft.id === selectedTicketId &&
          draft.projectId === selectedProject?.id &&
          draft.phase !== "working",
      )
    )
      return;
    if (pendingAction === "create-project" || pendingAction === "delete-project") return;
    const search = normalizedWorkbenchSelectionSearch({
      selectedProject,
      selectedTicket,
      selectedProjectId,
      selectedTicketId,
    });
    if (search === null) return;
    void navigate({
      to: "/workbench",
      search: withWorkbenchEnvironmentSearch(environmentId, { ...search }),
      replace: true,
    });
  }, [
    navigate,
    environmentId,
    awaitingProjectId,
    awaitingTicketId,
    pendingAction,
    selectedProject,
    selectedProjectId,
    selectedTicket,
    selectedTicketId,
    snapshot,
    selectedRouteMatches,
  ]);

  const openWorkspaceDialog = () => {
    setError(null);
    void navigate({
      to: "/workbench",
      search: withWorkbenchEnvironmentSearch(
        environmentId,
        selectedProject
          ? { workbenchProjectId: selectedProject.id, create: "workspace" as const }
          : { create: "workspace" as const },
      ),
      replace: true,
    });
  };
  const handleWorkspaceDialogOpenChange = (open: boolean) => {
    if (open) {
      openWorkspaceDialog();
      return;
    }
    setError(null);
    void navigate({
      to: "/workbench",
      search: (previous: WorkbenchSearch): WorkbenchSearch => ({
        ...(environmentId ? { environmentId } : {}),
        ...(previous.workbenchProjectId ? { workbenchProjectId: previous.workbenchProjectId } : {}),
        ...(previous.ticketId ? { ticketId: previous.ticketId } : {}),
      }),
      replace: true,
    });
  };
  return {
    selectedProjectId,
    setSelectedProjectId,
    selectedTicketId,
    setSelectedTicketId,
    awaitingTicketId,
    setAwaitingProjectId,
    setAwaitingTicketId,
    awaitingSelectedProject,
    selectedProject,
    selectedTicket,
    updateRouteSelection,
    closeWorkItem,
    openWorkspaceDialog,
    handleWorkspaceDialogOpenChange,
  };
}

function resolveWorkbenchSelectedRecords({
  snapshot,
  tickets,
  awaitingProjectId,
  selectedProjectId,
  selectedTicketId,
  excludedProjectIds,
}: {
  snapshot: WorkbenchSnapshot | null;
  tickets: ReadonlyArray<WorkbenchTicket>;
  awaitingProjectId: WorkbenchProjectId | null;
  selectedProjectId: WorkbenchProjectId | null;
  selectedTicketId: WorkbenchTicketId | null;
  excludedProjectIds: ReadonlySet<WorkbenchProjectId> | undefined;
}) {
  const awaitingSelectedProject = isAwaitingRecord({
    awaitingId: awaitingProjectId,
    selectedId: selectedProjectId,
    records: snapshot?.projects,
  });
  const selectedProject = awaitingSelectedProject
    ? null
    : (snapshot?.projects.find(
        (project) => project.id === selectedProjectId && !excludedProjectIds?.has(project.id),
      ) ??
      snapshot?.projects.find(
        (project) => project.archivedAt == null && !excludedProjectIds?.has(project.id),
      ) ??
      null);
  const selectedTicket =
    tickets.find(
      (ticket) => ticket.id === selectedTicketId && ticket.projectId === selectedProject?.id,
    ) ?? null;
  return { awaitingSelectedProject, selectedProject, selectedTicket };
}

function normalizedWorkbenchSelectionSearch({
  selectedProject,
  selectedTicket,
  selectedProjectId,
  selectedTicketId,
}: Pick<
  ReturnType<typeof resolveWorkbenchSelectedRecords>,
  "selectedProject" | "selectedTicket"
> & {
  selectedProjectId: WorkbenchProjectId | null;
  selectedTicketId: WorkbenchTicketId | null;
}): WorkbenchSearch | null {
  const projectId = selectedProject?.id ?? null;
  const ticketId = selectedTicket?.id ?? null;
  if (projectId === selectedProjectId && ticketId === selectedTicketId) return null;
  if (projectId === null) return {};
  if (ticketId !== null) return { workbenchProjectId: projectId, ticketId };
  return { workbenchProjectId: projectId };
}
