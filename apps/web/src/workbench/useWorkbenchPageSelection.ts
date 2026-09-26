import type {
  EnvironmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WorkbenchEpicId,
  WorkbenchSnapshot,
  WorkbenchTicket,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { WorkbenchSearch } from "./workbenchSearch";
import { withWorkbenchEnvironmentSearch } from "./workbenchNavigation";

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
  initialEpicId,
  snapshot,
  tickets,
  pendingAction,
  setError,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly initialProjectId: WorkbenchProjectId | undefined;
  readonly initialTicketId: WorkbenchTicketId | undefined;
  readonly initialEpicId: WorkbenchEpicId | undefined;
  readonly snapshot: WorkbenchSnapshot | null;
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly pendingAction: string | null;
  readonly setError: (message: string | null) => void;
}) {
  const navigate = useNavigate({ from: "/workbench" });
  const [selectedProjectId, setSelectedProjectId] = useState<WorkbenchProjectId | null>(
    initialProjectId ?? null,
  );
  const [selectedTicketId, setSelectedTicketId] = useState<WorkbenchTicketId | null>(
    initialTicketId ?? null,
  );
  const [selectedEpicId, setSelectedEpicId] = useState<WorkbenchEpicId | null>(
    initialEpicId ?? null,
  );
  const [awaitingProjectId, setAwaitingProjectId] = useState<WorkbenchProjectId | null>(null);
  const [awaitingTicketId, setAwaitingTicketId] = useState<WorkbenchTicketId | null>(null);
  const [awaitingEpicId, setAwaitingEpicId] = useState<WorkbenchEpicId | null>(null);
  const { awaitingSelectedProject, selectedProject, selectedEpic, selectedTicket } =
    resolveWorkbenchSelectedRecords({
      snapshot,
      tickets,
      awaitingProjectId,
      selectedProjectId,
      awaitingEpicId,
      selectedEpicId,
      selectedTicketId,
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

  const updateEpicRouteSelection = (projectId: WorkbenchProjectId, epicId: WorkbenchEpicId) => {
    return navigate({
      to: "/workbench",
      search: withWorkbenchEnvironmentSearch(environmentId, {
        workbenchProjectId: projectId,
        epicId,
      }),
      replace: true,
    });
  };

  const closeWorkItem = () => {
    setAwaitingTicketId(null);
    setAwaitingEpicId(null);
    setSelectedTicketId(null);
    setSelectedEpicId(null);
    if (selectedProject) void updateRouteSelection(selectedProject.id);
  };

  useEffect(() => {
    // Route search is an external selection source and can change through browser history.
    // oxlint-disable-next-line react/set-state-in-effect
    setSelectedProjectId(initialProjectId ?? null);
    setSelectedTicketId(initialTicketId ?? null);
    setSelectedEpicId(initialEpicId ?? null);
  }, [initialEpicId, initialProjectId, initialTicketId]);

  useEffect(() => {
    if (snapshot === null) return;
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
        records: snapshot?.tickets,
      })
    )
      return;
    if (
      isAwaitingRecord({
        awaitingId: awaitingEpicId,
        selectedId: selectedEpicId,
        records: snapshot?.epics,
      })
    )
      return;
    if (selectedProject === null || pendingAction === "create-project") return;
    const ticketId = selectedTicket?.id ?? null;
    const epicId = ticketId === null ? (selectedEpic?.id ?? null) : null;
    if (
      selectedProject.id === selectedProjectId &&
      ticketId === selectedTicketId &&
      epicId === selectedEpicId
    )
      return;
    void navigate({
      to: "/workbench",
      search: withWorkbenchEnvironmentSearch(
        environmentId,
        ticketId
          ? { workbenchProjectId: selectedProject.id, ticketId }
          : epicId
            ? { workbenchProjectId: selectedProject.id, epicId }
            : { workbenchProjectId: selectedProject.id },
      ),
      replace: true,
    });
  }, [
    navigate,
    environmentId,
    awaitingProjectId,
    awaitingEpicId,
    awaitingTicketId,
    pendingAction,
    selectedProject,
    selectedProjectId,
    selectedEpic,
    selectedEpicId,
    selectedTicket,
    selectedTicketId,
    snapshot,
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
        ...(previous.ticketId
          ? { ticketId: previous.ticketId }
          : previous.epicId
            ? { epicId: previous.epicId }
            : {}),
      }),
      replace: true,
    });
  };
  return {
    selectedProjectId,
    setSelectedProjectId,
    selectedTicketId,
    setSelectedTicketId,
    selectedEpicId,
    setSelectedEpicId,
    setAwaitingProjectId,
    setAwaitingTicketId,
    setAwaitingEpicId,
    awaitingSelectedProject,
    selectedProject,
    selectedEpic,
    selectedTicket,
    updateRouteSelection,
    updateEpicRouteSelection,
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
  awaitingEpicId,
  selectedEpicId,
  selectedTicketId,
}: {
  snapshot: WorkbenchSnapshot | null;
  tickets: ReadonlyArray<WorkbenchTicket>;
  awaitingProjectId: WorkbenchProjectId | null;
  selectedProjectId: WorkbenchProjectId | null;
  awaitingEpicId: WorkbenchEpicId | null;
  selectedEpicId: WorkbenchEpicId | null;
  selectedTicketId: WorkbenchTicketId | null;
}) {
  const awaitingSelectedProject = isAwaitingRecord({
    awaitingId: awaitingProjectId,
    selectedId: selectedProjectId,
    records: snapshot?.projects,
  });
  const selectedProject = awaitingSelectedProject
    ? null
    : (snapshot?.projects.find((project) => project.id === selectedProjectId) ??
      snapshot?.projects[0] ??
      null);
  const awaitingSelectedEpic = isAwaitingRecord({
    awaitingId: awaitingEpicId,
    selectedId: selectedEpicId,
    records: snapshot?.epics,
  });
  const selectedEpic = awaitingSelectedEpic
    ? null
    : (snapshot?.epics.find(
        (epic) => epic.id === selectedEpicId && epic.projectId === selectedProject?.id,
      ) ?? null);
  const selectedTicket =
    tickets.find(
      (ticket) => ticket.id === selectedTicketId && ticket.projectId === selectedProject?.id,
    ) ?? null;
  return { awaitingSelectedProject, selectedProject, selectedEpic, selectedTicket };
}
