import type {
  EnvironmentId,
  ProjectId,
  ServerProvider,
  ThreadId,
  WorkbenchAssignment,
  WorkbenchProject,
  WorkbenchProjectId,
} from "@t3tools/contracts";

import type { WorkbenchRemoteThreadStart } from "./startWorkbenchTicket";

/** A Board's linked Project on another machine, named live when that machine is saved here. */
export interface WorkbenchRemoteRepository {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly title: string;
  readonly environmentLabel: string;
}

const WORKBENCH_UNKNOWN_MACHINE_LABEL = "Unknown machine";

/**
 * Each Board's linked Projects on other machines, by Board. A Board names a Project by id alone,
 * and copied data can give two Boards the same id on different machines, so each resolves its own.
 */
export function getWorkbenchRemoteRepositories({
  boards,
  projects,
  environmentLabels,
}: {
  readonly boards: ReadonlyArray<Pick<WorkbenchProject, "id" | "remoteProjects">>;
  /** Native Projects from every connected environment. */
  readonly projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly environmentId: EnvironmentId;
    readonly title: string;
  }>;
  /** Native labels of the environments saved on this client. */
  readonly environmentLabels: ReadonlyMap<EnvironmentId, string>;
}): ReadonlyMap<WorkbenchProjectId, ReadonlyMap<ProjectId, WorkbenchRemoteRepository>> {
  return new Map(
    boards.map((board) => [
      board.id,
      new Map(
        (
          Object.entries(board.remoteProjects ?? {}) as Array<
            [ProjectId, NonNullable<WorkbenchProject["remoteProjects"]>[ProjectId]]
          >
        ).map(([id, link]) => {
          const live = projects.find(
            (project) => project.id === id && project.environmentId === link.environmentId,
          );
          return [
            id,
            {
              id,
              environmentId: link.environmentId,
              title: live?.title ?? link.projectTitle,
              environmentLabel: environmentLabels.get(link.environmentId) ?? link.environmentLabel,
            },
          ];
        }),
      ),
    ]),
  );
}

export const formatWorkbenchRemoteRepositoryTitle = (
  repository: Pick<WorkbenchRemoteRepository, "title" | "environmentLabel">,
) => `${repository.title} · ${repository.environmentLabel}`;

/** A Board's repository names by id: its Projects on the host, then those on other machines. */
export const getWorkbenchBoardRepositoriesById = ({
  hostProjects,
  remoteRepositories,
}: {
  readonly hostProjects: ReadonlyArray<{ readonly id: ProjectId; readonly title: string }>;
  readonly remoteRepositories: ReadonlyMap<ProjectId, WorkbenchRemoteRepository> | undefined;
}): ReadonlyMap<ProjectId, { readonly id: ProjectId; readonly title: string }> =>
  new Map([
    ...hostProjects.map(
      (project) => [project.id, { id: project.id, title: project.title }] as const,
    ),
    ...[...(remoteRepositories?.values() ?? [])].map(
      (repository) =>
        [
          repository.id,
          { id: repository.id, title: formatWorkbenchRemoteRepositoryTitle(repository) },
        ] as const,
    ),
  ]);

/** The machine a remote Assignment's Thread runs on, by its saved or stored label. */
export const getWorkbenchAssignmentMachineLabel = ({
  assignment,
  repositories,
  environmentLabels,
}: {
  readonly assignment: Pick<WorkbenchAssignment, "environmentId" | "projectId">;
  readonly repositories: ReadonlyMap<
    ProjectId,
    Pick<WorkbenchRemoteRepository, "environmentLabel">
  >;
  readonly environmentLabels: ReadonlyMap<EnvironmentId, string>;
}) =>
  (assignment.environmentId && environmentLabels.get(assignment.environmentId)) ??
  (assignment.projectId && repositories.get(assignment.projectId)?.environmentLabel) ??
  WORKBENCH_UNKNOWN_MACHINE_LABEL;

/** A Ticket repository on another machine, as that machine can start a Thread in it now. */
export interface WorkbenchStartThreadRemoteRepository {
  readonly id: ProjectId;
  /** The repository and its machine. */
  readonly title: string;
  /** The native Project on its machine; null while that machine cannot start a Thread. */
  readonly project: WorkbenchRemoteThreadStart["project"] | null;
  /** The providers that machine runs. */
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly unavailableReason: string | null;
}

/**
 * The Ticket's repositories on other machines. A Thread starts only where shells are live and this
 * client's session there may change Threads, which the launch itself requires.
 */
export const getWorkbenchStartThreadRemoteRepositories = ({
  repositoryProjectIds,
  remoteRepositories,
  projects,
  liveEnvironmentIds,
  operableEnvironmentIds,
  providersByEnvironment,
}: {
  readonly repositoryProjectIds: ReadonlyArray<ProjectId>;
  readonly remoteRepositories: ReadonlyMap<ProjectId, WorkbenchRemoteRepository>;
  /** Native Projects from every connected environment. */
  readonly projects: ReadonlyArray<WorkbenchRemoteThreadStart["project"]>;
  readonly liveEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly operableEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly providersByEnvironment: ReadonlyMap<EnvironmentId, ReadonlyArray<ServerProvider>>;
}): ReadonlyArray<WorkbenchStartThreadRemoteRepository> =>
  repositoryProjectIds.flatMap((id) => {
    const repository = remoteRepositories.get(id);
    if (repository === undefined) return [];
    const { environmentId, environmentLabel } = repository;
    const project = liveEnvironmentIds.has(environmentId)
      ? (projects.find(
          (candidate) => candidate.id === id && candidate.environmentId === environmentId,
        ) ?? null)
      : null;
    const unavailableReason = !liveEnvironmentIds.has(environmentId)
      ? `${environmentLabel} is not connected`
      : project === null
        ? `Not found on ${environmentLabel}`
        : !operableEnvironmentIds.has(environmentId)
          ? `This connection cannot start Threads on ${environmentLabel}`
          : null;
    return [
      {
        id,
        title: formatWorkbenchRemoteRepositoryTitle(repository),
        project: unavailableReason === null ? project : null,
        providers: providersByEnvironment.get(environmentId) ?? [],
        unavailableReason,
      },
    ];
  });

/** A native Project the Board dialog offers, from this machine or another connected one. */
export interface WorkbenchBoardProjectOption {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly title: string;
  /** Null for a Project on the Board host. */
  readonly environmentLabel: string | null;
}

export const workbenchBoardProjectOptionKey = (
  option: Pick<WorkbenchBoardProjectOption, "id" | "environmentId">,
) => `${option.environmentId}:${option.id}`;

/** Keys of the options a Board already links, matched by machine since one id can be on two. */
export const getWorkbenchBoardLinkedOptionKeys = (
  options: ReadonlyArray<WorkbenchBoardProjectOption>,
  board: Pick<WorkbenchProject, "linkedProjectIds" | "remoteProjects"> | undefined,
): ReadonlySet<string> =>
  new Set(
    options
      .filter(
        (option) =>
          board?.linkedProjectIds.includes(option.id) === true &&
          (board.remoteProjects?.[option.id]?.environmentId ?? null) ===
            (option.environmentLabel === null ? null : option.environmentId),
      )
      .map(workbenchBoardProjectOptionKey),
  );

/**
 * Why an option cannot join the Board, or null. A Board names each Project by id alone, so a
 * second Project with a selected id is refused, as is a remote one whose id the host also has
 * (copied data).
 */
export function getWorkbenchBoardProjectUnavailableReason({
  option,
  options,
  selectedKeys,
}: {
  readonly option: WorkbenchBoardProjectOption;
  readonly options: ReadonlyArray<WorkbenchBoardProjectOption>;
  readonly selectedKeys: ReadonlySet<string>;
}): string | null {
  const key = workbenchBoardProjectOptionKey(option);
  if (selectedKeys.has(key)) return null;
  const sameId = options.filter(
    (candidate) => candidate.id === option.id && workbenchBoardProjectOptionKey(candidate) !== key,
  );
  if (sameId.some((candidate) => selectedKeys.has(workbenchBoardProjectOptionKey(candidate)))) {
    return "A Project with the same ID is already on this Board.";
  }
  if (option.environmentLabel !== null && sameId.some((c) => c.environmentLabel === null)) {
    return "A Project on this machine has the same ID.";
  }
  return null;
}

/** The Board's selected Projects as ordered ids plus entries for those on other machines. */
export function getWorkbenchBoardProjectSelection(
  selected: ReadonlyArray<WorkbenchBoardProjectOption>,
): {
  readonly linkedProjectIds: ReadonlyArray<ProjectId>;
  readonly remoteProjects: NonNullable<WorkbenchProject["remoteProjects"]>;
  readonly hasHostProject: boolean;
} {
  const remoteProjects: Record<
    ProjectId,
    NonNullable<WorkbenchProject["remoteProjects"]>[ProjectId]
  > = {};
  for (const option of selected) {
    if (option.environmentLabel === null) continue;
    remoteProjects[option.id] = {
      environmentId: option.environmentId,
      environmentLabel: option.environmentLabel,
      projectTitle: option.title,
    };
  }
  return {
    linkedProjectIds: selected.map((option) => option.id),
    remoteProjects,
    hasHostProject: selected.some((option) => option.environmentLabel === null),
  };
}

/** What a new Board's selection lacks: any Project, or one on the host. */
export const getWorkbenchBoardSelectionGap = (
  selection: ReturnType<typeof getWorkbenchBoardProjectSelection>,
  creating: boolean,
): "empty" | "host-project" | null => {
  // An edit only adds links; saved ones stay even when none can be picked right now.
  if (!creating) return null;
  if (selection.linkedProjectIds.length === 0) return "empty";
  // Planning runs on the Board host, so a new Board starts with a Project there.
  return selection.hasHostProject ? null : "host-project";
};

/**
 * Threads a Ticket can link: unassigned Threads in its repositories, each from the machine that
 * links that repository. A remote Thread whose id the host already has is left out, because a
 * Board names each Thread by id alone, as is one that never ran: a Board shows that as Not started.
 */
export function getWorkbenchAttachableThreads<
  Thread extends {
    readonly id: ThreadId;
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly latestRun: unknown;
  },
>({
  hostEnvironmentId,
  repositoryProjectIds,
  remoteRepositories,
  threads,
  assignedThreadIds,
  reservedThreadIds,
  hostThreadIds,
}: {
  readonly hostEnvironmentId: EnvironmentId;
  readonly repositoryProjectIds: ReadonlyArray<ProjectId>;
  readonly remoteRepositories: ReadonlyMap<
    ProjectId,
    Pick<WorkbenchRemoteRepository, "environmentId">
  >;
  readonly threads: ReadonlyArray<Thread>;
  readonly assignedThreadIds: ReadonlySet<ThreadId>;
  readonly reservedThreadIds: ReadonlySet<ThreadId>;
  /** Live and archived Threads on the host. */
  readonly hostThreadIds: ReadonlySet<ThreadId>;
}): ReadonlyArray<Thread> {
  return threads.filter((thread) => {
    if (!repositoryProjectIds.includes(thread.projectId)) return false;
    if (assignedThreadIds.has(thread.id) || reservedThreadIds.has(thread.id)) return false;
    const remote = remoteRepositories.get(thread.projectId);
    return remote === undefined
      ? thread.environmentId === hostEnvironmentId
      : thread.environmentId === remote.environmentId &&
          !hostThreadIds.has(thread.id) &&
          thread.latestRun !== null;
  });
}
