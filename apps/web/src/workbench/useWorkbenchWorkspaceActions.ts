import type {
  EnvironmentId,
  WorkbenchProject,
  WorkbenchProjectId,
  WorkbenchSnapshot,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { reportWorkbenchCommandFailure } from "./workbenchPageCommands";
import { withWorkbenchEnvironmentSearch } from "./workbenchNavigation";

export function useWorkbenchWorkspaceActions({
  environmentId,
  snapshot,
  pendingAction,
  setPendingAction,
  setError,
}: {
  environmentId: EnvironmentId | null;
  snapshot: WorkbenchSnapshot | null;
  pendingAction: string | null;
  setPendingAction: (action: string | null) => void;
  setError: (message: string | null) => void;
}) {
  const navigate = useNavigate();
  const archiveProject = useAtomCommand(workbenchEnvironment.archiveProject, {
    reportFailure: false,
  });
  const deleteProject = useAtomCommand(workbenchEnvironment.deleteProject, {
    reportFailure: false,
  });
  const canArchive = useAtomValue(
    workbenchEnvironment.archiveProject.permissionAtom(environmentId),
  );
  const canDelete = useAtomValue(workbenchEnvironment.deleteProject.permissionAtom(environmentId));
  const currentEnvironment = useRef(environmentId);
  useEffect(() => {
    currentEnvironment.current = environmentId;
  }, [environmentId]);
  const [deletedWorkspaces, setDeletedWorkspaces] = useState<
    ReadonlyArray<{
      environmentId: EnvironmentId;
      id: WorkbenchProjectId;
    }>
  >([]);
  const [deletion, setDeletion] = useState<{
    environmentId: EnvironmentId;
    workspace: WorkbenchProject;
    ticketCount: number;
    epicCount: number;
  } | null>(null);
  const setArchived = async (workspace: WorkbenchProject) => {
    if (!canArchive || environmentId === null || pendingAction !== null) return;
    setError(null);
    setPendingAction("archive-project");
    const updatedAt = new Date().toISOString();
    const result = await archiveProject({
      environmentId,
      input: {
        id: workspace.id,
        expectedRevision: workspace.revision ?? 0,
        archivedAt: workspace.archivedAt != null ? null : updatedAt,
        updatedAt,
      },
    });
    setPendingAction(null);
    if (currentEnvironment.current !== environmentId) return;
    reportWorkbenchCommandFailure(result, setError);
  };
  const requestDeletion = (workspace: WorkbenchProject) => {
    if (!canDelete || !snapshot || environmentId === null || pendingAction !== null) return;
    setError(null);
    setDeletion({
      environmentId,
      workspace,
      ticketCount: snapshot.tickets.filter((ticket) => ticket.projectId === workspace.id).length,
      epicCount: snapshot.epics.filter((epic) => epic.projectId === workspace.id).length,
    });
  };
  const removeWorkspace = async () => {
    if (
      !canDelete ||
      environmentId === null ||
      deletion === null ||
      deletion.environmentId !== environmentId ||
      pendingAction !== null
    )
      return;
    setError(null);
    setPendingAction("delete-project");
    try {
      const result = await deleteProject({
        environmentId,
        input: {
          id: deletion.workspace.id,
          expectedRevision: deletion.workspace.revision ?? 0,
          expectedTicketCount: deletion.ticketCount,
          expectedEpicCount: deletion.epicCount,
          deletedAt: new Date().toISOString(),
        },
      });
      if (result._tag === "Success") {
        setDeletedWorkspaces((previous) => [
          ...previous,
          { environmentId, id: deletion.workspace.id },
        ]);
      }
      if (currentEnvironment.current !== environmentId) return;
      if (reportWorkbenchCommandFailure(result, setError)) return;
      const next = snapshot?.projects.find(
        (workspace) =>
          workspace.id !== deletion.workspace.id &&
          workspace.archivedAt == null &&
          !deletedWorkspaces.some(
            (deleted) => deleted.environmentId === environmentId && deleted.id === workspace.id,
          ),
      );
      try {
        await navigate({
          to: "/workbench",
          search: withWorkbenchEnvironmentSearch(
            environmentId,
            next ? { workbenchProjectId: next.id } : {},
          ),
          replace: true,
        });
      } catch (cause) {
        if (currentEnvironment.current === environmentId) {
          const detail = cause instanceof Error ? ` ${cause.message}` : "";
          setError(`Workspace deleted, but Workbench could not open another Workspace.${detail}`);
        }
      }
      setDeletion(null);
    } finally {
      setPendingAction(null);
    }
  };
  const closeDeletion = () => {
    if (pendingAction !== null) return;
    setDeletion(null);
    setError(null);
  };
  return {
    canArchive,
    canDelete,
    deletion: deletion?.environmentId === environmentId ? deletion : null,
    deletedProjectIds: new Set(
      deletedWorkspaces
        .filter((workspace) => workspace.environmentId === environmentId)
        .map((workspace) => workspace.id),
    ),
    setArchived,
    requestDeletion,
    removeWorkspace,
    closeDeletion,
  };
}
