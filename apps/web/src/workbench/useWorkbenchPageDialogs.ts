import {
  WorkbenchProjectId,
  WorkbenchEpicId,
  type ProjectId,
  type EnvironmentId,
  type WorkbenchEpic,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
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
  localOnlySupported,
  selection,
  setPendingAction,
  setError,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly projects: ReturnType<typeof useWorkbenchPageData>["projects"];
  readonly localOnlySupported: boolean;
  readonly selection: ReturnType<typeof useWorkbenchPageSelection>;
  readonly setPendingAction: (action: string | null) => void;
  readonly setError: (message: string | null) => void;
}) {
  const {
    selectedProject,
    setAwaitingProjectId,
    setSelectedProjectId,
    setSelectedTicketId,
    setSelectedEpicId,
    setAwaitingTicketId,
    setAwaitingEpicId,
    updateRouteSelection,
    updateEpicRouteSelection,
  } = selection;
  const createProject = useAtomCommand(workbenchEnvironment.createProject, {
    reportFailure: false,
  });
  const updateProject = useAtomCommand(workbenchEnvironment.updateProject, {
    reportFailure: false,
  });
  const createEpic = useAtomCommand(workbenchEnvironment.createEpic, { reportFailure: false });
  const updateEpic = useAtomCommand(workbenchEnvironment.updateEpic, { reportFailure: false });
  const createTicket = useAtomCommand(workbenchEnvironment.createTicket, { reportFailure: false });
  const navigate = useNavigate();
  const [editWorkspaceOpen, setEditWorkspaceOpen] = useState(false);
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [ticketDialogEpicId, setTicketDialogEpicId] = useState<WorkbenchEpicId | null>(null);
  // Seeds a new conversation's Epic; a resumed draft keeps the Epic it already has.
  const [conversationEpicId, setConversationEpicId] = useState<WorkbenchEpicId | null>(null);
  const [epicDialogOpen, setEpicDialogOpen] = useState(false);
  const epicCreatedRef = useRef<((epicId: WorkbenchEpicId) => void) | null>(null);
  const submitProject = async (title: string, linkedProjectIds: ReadonlyArray<ProjectId>) => {
    if (environmentId === null) return false;
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
    setSelectedEpicId(null);
    await updateRouteSelection(id);
    return true;
  };

  const saveWorkspace = async (title: string, linkedProjectIds: ReadonlyArray<ProjectId>) => {
    if (environmentId === null || !selectedProject || selectedProject.archivedAt != null)
      return false;
    setPendingAction("update-project");
    setError(null);
    const result = await updateProject({
      environmentId,
      input: {
        id: selectedProject.id,
        expectedRevision: selectedProject.revision ?? 0,
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
    if (environmentId === null || selectedProject === null || selectedProject.archivedAt != null)
      return false;
    if (draft.localOnly && !localOnlySupported) {
      setError("Update this environment before creating local-only Tickets.");
      return false;
    }
    setPendingAction("create-ticket");
    setError(null);
    const primaryProject = projects.find((project) => project.id === draft.primaryT3ProjectId);
    if (!primaryProject) {
      setPendingAction(null);
      setError("The selected T3 Project is no longer available.");
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
    setAwaitingEpicId(null);
    setSelectedTicketId(id);
    setSelectedEpicId(null);
    await updateRouteSelection(selectedProject.id, id);
    return true;
  };

  const saveEpicContent = async (epic: WorkbenchEpic, title: string, markdown: string) => {
    if (environmentId === null || selectedProject?.archivedAt != null || title.trim().length === 0)
      return false;
    setPendingAction(`update-epic:${epic.id}`);
    setError(null);
    const result = await updateEpic({
      environmentId,
      input: {
        id: epic.id,
        title: title.trim(),
        markdown: markdown.trim(),
        updatedAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (reportWorkbenchCommandFailure(result, setError)) return false;
    return true;
  };

  const submitEpic = async (title: string, markdown: string) => {
    if (environmentId === null || selectedProject === null || selectedProject.archivedAt != null)
      return false;
    const onCreated = epicCreatedRef.current;
    setPendingAction("create-epic");
    setError(null);
    const id = WorkbenchEpicId.make(randomUUID());
    const result = await createEpic({
      environmentId,
      input: {
        id,
        projectId: selectedProject.id,
        title,
        markdown,
        createdAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (reportWorkbenchCommandFailure(result, setError)) return false;
    if (onCreated) {
      onCreated(id);
      return true;
    }
    setAwaitingEpicId(id);
    setAwaitingTicketId(null);
    setSelectedEpicId(id);
    setSelectedTicketId(null);
    await updateEpicRouteSelection(selectedProject.id, id);
    return true;
  };

  // New ticket starts a fresh preparation; begin replaces the intent with its durable id.
  const openTicketConversation = (epicId: WorkbenchEpicId | null = null) => {
    if (environmentId === null || !selectedProject || selectedProject.archivedAt != null) return;
    setError(null);
    setConversationEpicId(epicId);
    setAwaitingTicketId(null);
    setAwaitingEpicId(null);
    setSelectedTicketId(null);
    setSelectedEpicId(null);
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
    setConversationEpicId(null);
    if (selectedProject) void updateRouteSelection(selectedProject.id);
  };
  // Both draft creation and promotion select the same durable id and conversation.
  const openCreatedTicket = (draft: WorkbenchConversationDraft) => {
    if (!selectedProject) return;
    setConversationEpicId(null);
    setAwaitingTicketId(draft.id);
    setAwaitingEpicId(null);
    setSelectedTicketId(draft.id);
    setSelectedEpicId(null);
    void updateRouteSelection(selectedProject.id, draft.id);
  };
  const openDraftThread = (draft: WorkbenchConversationDraft) => {
    if (environmentId === null) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: draft.threadId },
      search: { workbench: true },
    });
  };
  const openTicketDialog = (epicId: WorkbenchEpicId | null = null) => {
    if (selectedProject?.archivedAt != null) return;
    setError(null);
    setTicketDialogEpicId(epicId);
    setTicketDialogOpen(true);
  };
  const openEpicDialog = (onCreated?: (epicId: WorkbenchEpicId) => void) => {
    if (selectedProject?.archivedAt != null) return;
    epicCreatedRef.current = onCreated ?? null;
    setError(null);
    setEpicDialogOpen(true);
  };
  const handleTicketDialogOpenChange = (open: boolean) => {
    setTicketDialogOpen(open);
    if (!open) setError(null);
  };
  const handleEpicDialogOpenChange = (open: boolean) => {
    setEpicDialogOpen(open);
    if (!open) {
      epicCreatedRef.current = null;
      setError(null);
    }
  };
  return {
    editWorkspaceOpen,
    setEditWorkspaceOpen,
    ticketDialogOpen,
    ticketDialogEpicId,
    epicDialogOpen,
    submitProject,
    saveWorkspace,
    submitTicket,
    saveEpicContent,
    submitEpic,
    openTicketDialog,
    conversationEpicId,
    openTicketConversation,
    closeTicketConversation,
    openCreatedTicket,
    openDraftThread,
    openEpicDialog,
    handleTicketDialogOpenChange,
    handleEpicDialogOpenChange,
  };
}
