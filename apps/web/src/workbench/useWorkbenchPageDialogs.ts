import {
  WorkbenchProjectId,
  WorkbenchEpicId,
  type ProjectId,
  type EnvironmentId,
  type WorkbenchEpic,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
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
  selection,
  setPendingAction,
  setError,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly projects: ReturnType<typeof useWorkbenchPageData>["projects"];
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
  const [editWorkspaceOpen, setEditWorkspaceOpen] = useState(false);
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [ticketDialogEpicId, setTicketDialogEpicId] = useState<WorkbenchEpicId | null>(null);
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
    if (environmentId === null || !selectedProject) return false;
    setPendingAction("update-project");
    setError(null);
    const result = await updateProject({
      environmentId,
      input: {
        id: selectedProject.id,
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
    if (environmentId === null || selectedProject === null) return false;
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
    if (environmentId === null || title.trim().length === 0) return false;
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
    if (environmentId === null || selectedProject === null) return false;
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

  const openTicketDialog = (epicId: WorkbenchEpicId | null = null) => {
    setError(null);
    setTicketDialogEpicId(epicId);
    setTicketDialogOpen(true);
  };
  const openEpicDialog = (onCreated?: (epicId: WorkbenchEpicId) => void) => {
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
    openEpicDialog,
    handleTicketDialogOpenChange,
    handleEpicDialogOpenChange,
  };
}
