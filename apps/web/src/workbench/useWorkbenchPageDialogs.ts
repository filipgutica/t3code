import { WorkbenchProjectId, type ProjectId, type EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { withWorkbenchEnvironmentSearch } from "./workbenchNavigation";
import type { WorkbenchConversationDraft } from "./workbenchTicketDraft.logic";
import { useAtomCommand } from "../state/use-atom-command";
import { randomUUID } from "../lib/utils";
import { workbenchEnvironment } from "./state";
import { reportWorkbenchCommandFailure } from "./workbenchPageCommands";
import type { WorkbenchCreateTicketDraft } from "./WorkbenchForms";
import type { useWorkbenchPageData } from "./useWorkbenchPageData";
import type { useWorkbenchPageSelection } from "./useWorkbenchPageSelection";

export function useWorkbenchPageDialogs({
  environmentId,
  projects,
  canOperate,
  selection,
  setPendingAction,
  setError,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly projects: ReturnType<typeof useWorkbenchPageData>["projects"];
  readonly canOperate: boolean;
  readonly selection: ReturnType<typeof useWorkbenchPageSelection>;
  readonly setPendingAction: (action: string | null) => void;
  readonly setError: (message: string | null) => void;
}) {
  const {
    selectedProject,
    setAwaitingProjectId,
    setSelectedProjectId,
    setSelectedTicketId,
    setAwaitingTicketId,
    updateRouteSelection,
  } = selection;
  const createProject = useAtomCommand(workbenchEnvironment.createProject, {
    reportFailure: false,
  });
  const updateProject = useAtomCommand(workbenchEnvironment.updateProject, {
    reportFailure: false,
  });
  const createTicket = useAtomCommand(workbenchEnvironment.createTicket, { reportFailure: false });
  const navigate = useNavigate();
  const [editWorkspaceOpen, setEditWorkspaceOpen] = useState(false);
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const submitProject = async (title: string, linkedProjectIds: ReadonlyArray<ProjectId>) => {
    if (!canOperate || environmentId === null) return false;
    setPendingAction("create-project");
    setError(null);
    const id = WorkbenchProjectId.make(randomUUID());
    const result = await createProject({
      environmentId,
      input: {
        id,
        title,
        linkedProjectIds,
        createdAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (reportWorkbenchCommandFailure(result, setError)) return false;
    setAwaitingProjectId(id);
    setSelectedProjectId(id);
    setSelectedTicketId(null);
    await updateRouteSelection(id);
    return true;
  };

  const saveWorkspace = async (title: string, linkedProjectIds: ReadonlyArray<ProjectId>) => {
    if (
      !canOperate ||
      environmentId === null ||
      !selectedProject ||
      selectedProject.archivedAt != null
    )
      return false;
    setPendingAction("update-project");
    setError(null);
    const result = await updateProject({
      environmentId,
      input: {
        id: selectedProject.id,
        expectedRevision: selectedProject.revision,
        title,
        linkedProjectIds,
        updatedAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (reportWorkbenchCommandFailure(result, setError)) return false;
    return true;
  };

  const submitTicket = async (draft: WorkbenchCreateTicketDraft) => {
    if (
      !canOperate ||
      environmentId === null ||
      selectedProject === null ||
      selectedProject.archivedAt != null
    )
      return false;
    setPendingAction("create-ticket");
    setError(null);
    if (!draft.repositoryProjectIds.every((id) => projects.some((project) => project.id === id))) {
      setPendingAction(null);
      setError("A selected T3 Project is no longer available.");
      return false;
    }
    const result = await createTicket({
      environmentId,
      input: {
        ...draft,
        projectId: selectedProject.id,
        createdAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (reportWorkbenchCommandFailure(result, setError)) return false;
    const id = result.value.id;
    setAwaitingTicketId(id);
    setSelectedTicketId(id);
    await updateRouteSelection(selectedProject.id, id);
    return true;
  };

  // New ticket starts a fresh preparation; begin replaces the intent with its durable id.
  const openTicketConversation = () => {
    if (
      !canOperate ||
      environmentId === null ||
      !selectedProject ||
      selectedProject.archivedAt != null
    )
      return;
    setError(null);
    void navigate({
      to: "/workbench",
      search: withWorkbenchEnvironmentSearch(environmentId, {
        workbenchProjectId: selectedProject.id,
        create: "ticket" as const,
      }),
    });
  };
  const closeTicketConversation = () => {
    setError(null);
    if (selectedProject) void updateRouteSelection(selectedProject.id);
  };
  // Both draft creation and promotion select the same durable id and conversation.
  const openCreatedTicket = (draft: WorkbenchConversationDraft) => {
    if (!selectedProject) return;
    setAwaitingTicketId(draft.id);
    setSelectedTicketId(draft.id);
    void updateRouteSelection(selectedProject.id, draft.id);
  };
  const openDraftThread = (draft: WorkbenchConversationDraft) => {
    if (environmentId === null) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: draft.threadId },
    });
  };
  const openTicketDialog = () => {
    if (!canOperate || selectedProject?.archivedAt != null) return;
    setError(null);
    setTicketDialogOpen(true);
  };
  const handleTicketDialogOpenChange = (open: boolean) => {
    setTicketDialogOpen(open);
    if (!open) setError(null);
  };
  return {
    editWorkspaceOpen,
    setEditWorkspaceOpen,
    ticketDialogOpen,
    submitProject,
    saveWorkspace,
    submitTicket,
    openTicketDialog,
    openTicketConversation,
    closeTicketConversation,
    openCreatedTicket,
    openDraftThread,
    handleTicketDialogOpenChange,
  };
}
