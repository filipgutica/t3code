import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, WorkbenchProject, WorkbenchRemoteProject } from "@t3tools/contracts";

export function getWorkbenchBoardRepositories({
  board,
  projects,
  environmentId,
}: {
  board: Pick<WorkbenchProject, "linkedProjectIds" | "remoteProjects">;
  projects: ReadonlyArray<EnvironmentProject>;
  environmentId: EnvironmentId | null;
}) {
  return projects.filter(
    (project) =>
      board.linkedProjectIds.includes(project.id) &&
      (environmentId === null ||
        project.environmentId ===
          (board.remoteProjects?.find((remote) => remote.projectId === project.id)?.environmentId ??
            environmentId)),
  );
}

function unavailableWorkbenchRepository(
  remote: WorkbenchRemoteProject,
  createdAt: string,
): EnvironmentProject {
  return {
    id: remote.projectId,
    environmentId: remote.environmentId,
    title: `${remote.title} · not connected`,
    workspaceRoot: "",
    defaultModelSelection: null,
    scripts: [],
    createdAt,
    updatedAt: createdAt,
  };
}

/** Retains remote repository names while their native host is disconnected. */
export function getWorkbenchProjects({
  projects,
  environmentId,
  connectedEnvironmentIds,
  boards,
}: {
  projects: ReadonlyArray<EnvironmentProject>;
  environmentId: EnvironmentId | null;
  connectedEnvironmentIds: ReadonlyArray<EnvironmentId>;
  boards: ReadonlyArray<WorkbenchProject>;
}) {
  const available = projects.filter(
    (project) =>
      project.environmentId === environmentId ||
      connectedEnvironmentIds.includes(project.environmentId),
  );
  for (const board of boards) {
    for (const remote of board.remoteProjects ?? []) {
      if (
        !available.some(
          (project) =>
            project.id === remote.projectId && project.environmentId === remote.environmentId,
        )
      ) {
        available.push(unavailableWorkbenchRepository(remote, board.createdAt));
      }
    }
  }
  return available;
}
