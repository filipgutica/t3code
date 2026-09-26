import { useWorkbenchJiraSync, type WorkbenchJiraSyncNotice } from "./useWorkbenchJiraSync";
import { useWorkbenchJiraMigration } from "./useWorkbenchJiraMigration";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  WorkbenchJiraBindingId,
  type EnvironmentId,
  type WorkbenchProjectId,
  type WorkbenchProject,
  type WorkbenchJiraBinding,
  type WorkbenchJiraConnectionId,
  type WorkbenchJiraBoardConfiguration,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { useAtomCommand } from "../state/use-atom-command";
import { randomUUID } from "../lib/utils";
import { workbenchEnvironment } from "./state";
import { failureMessage } from "./workbenchPageCommands";
import { getWorkbenchJiraBindingSprints } from "./workbenchJira.logic";
import type { WorkbenchJiraCreateDraft, WorkbenchJiraUpdateDraft } from "./WorkbenchJiraDialog";

type PendingJiraMigration = {
  readonly binding: WorkbenchJiraBinding;
  readonly migrationComplete: boolean;
};

export function useWorkbenchJiraBindings({
  environmentId,
  selectedProjectId,
  selectedProject,
  refreshJiraSnapshot,
  refreshWorkbenchSnapshot,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly selectedProjectId: WorkbenchProjectId | null;
  readonly selectedProject: WorkbenchProject | null;
  readonly refreshJiraSnapshot: () => unknown;
  readonly refreshWorkbenchSnapshot: () => unknown;
}) {
  const jiraListProjects = useAtomCommand(workbenchEnvironment.jiraListProjects, {
    reportFailure: false,
  });
  const jiraListBoards = useAtomCommand(workbenchEnvironment.jiraListBoards, {
    reportFailure: false,
  });
  const jiraListSprints = useAtomCommand(workbenchEnvironment.jiraListSprints, {
    reportFailure: false,
  });
  const jiraGetBoardConfiguration = useAtomCommand(workbenchEnvironment.jiraGetBoardConfiguration, {
    reportFailure: false,
  });
  const jiraCreateBinding = useAtomCommand(workbenchEnvironment.jiraCreateBinding, {
    reportFailure: false,
  });
  const jiraUpdateBinding = useAtomCommand(workbenchEnvironment.jiraUpdateBinding, {
    reportFailure: false,
  });
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [jiraPendingAction, setJiraPendingAction] = useState<string | null>(null);
  const [jiraSyncNotice, setJiraSyncNotice] = useState<WorkbenchJiraSyncNotice | null>(null);
  const statusEnvironmentRef = useRef(environmentId);
  const jiraScopeRef = useRef({ environmentId, projectId: selectedProjectId });
  const pendingJiraMigrationBindingsRef = useRef(new Map<string, PendingJiraMigration>());
  const jiraMigrationKey = (projectId: WorkbenchProjectId) =>
    `${environmentId ?? "none"}:${projectId}`;
  useEffect(() => {
    const previousScope = jiraScopeRef.current;
    jiraScopeRef.current = { environmentId, projectId: selectedProjectId };
    statusEnvironmentRef.current = environmentId;
    if (
      previousScope.environmentId === environmentId &&
      previousScope.projectId === selectedProjectId
    )
      return;
    pendingJiraMigrationBindingsRef.current.clear();
    // Jira feedback and retry state belong to the active environment and Workspace.
    setJiraError(null);
    setJiraSyncNotice(null);
  }, [environmentId, selectedProjectId]);
  const { jiraSyncBinding, syncJiraBinding } = useWorkbenchJiraSync({
    environmentId,
    statusEnvironmentRef,
    setJiraPendingAction,
    setJiraError,
    refreshJiraSnapshot,
    refreshWorkbenchSnapshot,
    setJiraSyncNotice,
  });
  const { wasJiraMigrationCommitted, migrateJiraLocalData } = useWorkbenchJiraMigration({
    environmentId,
    statusEnvironmentRef,
    setJiraPendingAction,
    setJiraError,
    refreshJiraSnapshot,
    refreshWorkbenchSnapshot,
  });

  const listJiraProjectsForConnection = async (connectionId: WorkbenchJiraConnectionId) => {
    if (environmentId === null) return null;
    setJiraPendingAction("projects");
    setJiraError(null);
    const result = await jiraListProjects({ environmentId, input: { connectionId } });
    setJiraPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setJiraError(failureMessage(result));
      return null;
    }
    return result.value;
  };

  const listJiraBoardsForProject = async (
    connectionId: WorkbenchJiraConnectionId,
    projectKeyOrId: string,
  ) => {
    if (environmentId === null) return null;
    setJiraPendingAction("boards");
    setJiraError(null);
    const result = await jiraListBoards({
      environmentId,
      input: { connectionId, projectKeyOrId },
    });
    setJiraPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setJiraError(failureMessage(result));
      return null;
    }
    return result.value;
  };

  const listJiraSprintsForBoard = async (
    connectionId: WorkbenchJiraConnectionId,
    boardId: number,
  ) => {
    if (environmentId === null) return null;
    setJiraPendingAction("sprints");
    setJiraError(null);
    const result = await jiraListSprints({ environmentId, input: { connectionId, boardId } });
    setJiraPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setJiraError(failureMessage(result));
      return null;
    }
    return result.value;
  };

  const getJiraBoardConfiguration = async (
    connectionId: WorkbenchJiraConnectionId,
    boardId: number,
  ): Promise<WorkbenchJiraBoardConfiguration | null> => {
    if (environmentId === null) return null;
    setJiraPendingAction("configuration");
    setJiraError(null);
    const result = await jiraGetBoardConfiguration({
      environmentId,
      input: { connectionId, boardId },
    });
    setJiraPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setJiraError(failureMessage(result));
      return null;
    }
    return result.value;
  };

  const createJiraBindingForWorkspace = async (draft: WorkbenchJiraCreateDraft) => {
    const firstSprint = draft.sprints[0];
    if (environmentId === null || selectedProject === null || !firstSprint) return false;
    const migrationKey = jiraMigrationKey(selectedProject.id);
    const pendingMigration = pendingJiraMigrationBindingsRef.current.get(migrationKey) ?? null;
    const pendingBinding = pendingMigration?.binding ?? null;
    if (
      pendingBinding !== null &&
      !matchesPendingJiraBinding({ binding: pendingBinding, projectId: selectedProject.id, draft })
    ) {
      setJiraError("Finish the pending local data migration before changing the Jira mirror.");
      return false;
    }
    setJiraPendingAction("create-binding");
    setJiraError(null);
    const result =
      pendingBinding === null
        ? await jiraCreateBinding({
            environmentId,
            input: {
              id: WorkbenchJiraBindingId.make(randomUUID()),
              projectId: selectedProject.id,
              connectionId: draft.connectionId,
              jiraProjectId: draft.jiraProject.id,
              jiraProjectKey: draft.jiraProject.key,
              jiraProjectName: draft.jiraProject.name,
              boardId: draft.board.id,
              boardName: draft.board.name,
              sprintId: firstSprint.id,
              sprintName: firstSprint.name,
              selectedSprints: draft.sprints.map(({ id, name }) => ({ id, name })),
              defaultPrimaryT3ProjectId: draft.defaultPrimaryT3ProjectId,
              defaultRepositoryProjectIds: draft.defaultRepositoryProjectIds,
              statusMappings: draft.statusMappings,
              localMigrationPending: draft.localDataAction !== "none",
              followActiveSprint: draft.followActiveSprint,
              boardMode: draft.boardMode,
              createdAt: new Date().toISOString(),
            },
          })
        : { _tag: "Success" as const, value: pendingBinding };
    setJiraPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setJiraError(failureMessage(result));
      return false;
    }
    const binding = result.value;
    const migrationComplete =
      draft.localDataAction === "none" ||
      pendingMigration?.migrationComplete === true ||
      (pendingBinding !== null && (await wasJiraMigrationCommitted(pendingBinding)));
    pendingJiraMigrationBindingsRef.current.set(migrationKey, { binding, migrationComplete });
    return finishBindingMigration({ binding, migrationKey, migrationComplete, draft });
  };

  const acceptBindingUpdate = (
    result: Awaited<ReturnType<typeof jiraUpdateBinding>>,
  ): result is Extract<Awaited<ReturnType<typeof jiraUpdateBinding>>, { _tag: "Success" }> => {
    setJiraPendingAction(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setJiraError(failureMessage(result));
      return false;
    }
    return true;
  };

  const updateJiraBindingForWorkspace = async (draft: WorkbenchJiraUpdateDraft) => {
    const firstSprint = draft.sprints[0];
    if (environmentId === null || !firstSprint) return false;
    setJiraPendingAction("update-binding");
    setJiraError(null);
    const migrationKey = jiraMigrationKey(draft.binding.projectId);
    const pendingMigration = pendingJiraMigrationBindingsRef.current.get(migrationKey);
    const migrationComplete =
      draft.localDataAction === "none" ||
      pendingMigration?.migrationComplete === true ||
      (pendingMigration !== undefined &&
        (await wasJiraMigrationCommitted(pendingMigration.binding)));
    const result = await jiraUpdateBinding({
      environmentId,
      input: {
        id: draft.binding.id,
        sprintId: firstSprint.id,
        sprintName: firstSprint.name,
        selectedSprints: draft.sprints.map(({ id, name }) => ({ id, name })),
        defaultPrimaryT3ProjectId: draft.defaultPrimaryT3ProjectId,
        defaultRepositoryProjectIds: draft.defaultRepositoryProjectIds,
        statusMappings: draft.statusMappings,
        followActiveSprint: draft.followActiveSprint,
        boardMode: draft.boardMode,
        active: draft.binding.active,
        ...(migrationComplete ? {} : { localMigrationPending: true }),
        updatedAt: new Date().toISOString(),
      },
    });
    if (!acceptBindingUpdate(result)) return false;
    pendingJiraMigrationBindingsRef.current.set(migrationKey, {
      binding: result.value,
      migrationComplete,
    });
    return finishBindingMigration({
      binding: result.value,
      migrationKey,
      migrationComplete,
      draft,
    });
  };

  const finishBindingMigration = async ({
    binding,
    migrationKey,
    migrationComplete,
    draft,
  }: {
    binding: WorkbenchJiraBinding;
    migrationKey: string;
    migrationComplete: boolean;
    draft: WorkbenchJiraCreateDraft | WorkbenchJiraUpdateDraft;
  }) => {
    if (!migrationComplete && draft.localDataAction !== "none") {
      const migration = await migrateJiraLocalData({
        binding,
        action: draft.localDataAction,
        tickets: draft.localTickets,
        epics: draft.localEpics,
      });
      if (migration === null && !(await wasJiraMigrationCommitted(binding))) return false;
      migrationComplete = true;
      pendingJiraMigrationBindingsRef.current.set(migrationKey, { binding, migrationComplete });
    }
    // A newly created mirror is not useful until its first Jira projection is
    // available. Keep the dialog pending while this initial import runs; the
    // sync notice below makes the result visible after the dialog closes.
    const syncResult = await syncJiraBinding(binding);
    if (syncResult === null) return false;
    pendingJiraMigrationBindingsRef.current.delete(migrationKey);
    return true;
  };

  const setJiraBindingActive = async (binding: WorkbenchJiraBinding, active: boolean) => {
    if (environmentId === null) return false;
    setJiraPendingAction(active ? "resume-binding" : "pause-binding");
    setJiraError(null);
    const result = await jiraUpdateBinding({
      environmentId,
      input: {
        id: binding.id,
        sprintId: binding.sprintId,
        sprintName: binding.sprintName,
        selectedSprints: getWorkbenchJiraBindingSprints(binding),
        defaultPrimaryT3ProjectId: binding.defaultPrimaryT3ProjectId,
        defaultRepositoryProjectIds: binding.defaultRepositoryProjectIds,
        statusMappings: binding.statusMappings,
        followActiveSprint: binding.followActiveSprint,
        boardMode: binding.boardMode,
        active,
        updatedAt: new Date().toISOString(),
      },
    });
    if (!acceptBindingUpdate(result)) return false;
    return true;
  };

  return {
    jiraError,
    setJiraError,
    jiraPendingAction,
    setJiraPendingAction,
    jiraSyncNotice,
    setJiraSyncNotice,
    statusEnvironmentRef,
    pendingJiraMigrationBindingsRef,
    jiraSyncBinding,
    listJiraProjectsForConnection,
    listJiraBoardsForProject,
    listJiraSprintsForBoard,
    getJiraBoardConfiguration,
    createJiraBindingForWorkspace,
    updateJiraBindingForWorkspace,
    setJiraBindingActive,
    syncJiraBinding,
  };
}

function matchesPendingJiraBinding({
  binding,
  projectId,
  draft,
}: {
  binding: WorkbenchJiraBinding;
  projectId: WorkbenchProjectId;
  draft: WorkbenchJiraCreateDraft;
}) {
  return (
    binding.projectId === projectId &&
    binding.connectionId === draft.connectionId &&
    binding.jiraProjectId === draft.jiraProject.id &&
    binding.boardId === draft.board.id
  );
}
