import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isUncPath,
  isWindowsDrivePath,
  normalizeProjectPathForDispatch,
} from "@t3tools/shared/path";
import {
  repositoryGroupingKeyOf,
  type EnvironmentId,
  type ProjectId,
  type WorkbenchProject,
  type WorkbenchRemoteProject,
  type WorkbenchThreadRepository,
} from "@t3tools/contracts";

type WorkbenchBoardLinks = {
  readonly linkedProjectIds: WorkbenchProject["linkedProjectIds"];
  readonly remoteProjects?: WorkbenchProject["remoteProjects"] | undefined;
  readonly repositoryKeys?: WorkbenchProject["repositoryKeys"] | undefined;
  readonly defaultEnvironmentId?: WorkbenchProject["defaultEnvironmentId"] | undefined;
};

/**
 * The machine-independent identity of a Project: its git remote plus its path inside the
 * repository. Null when either is unknown, so monorepo subprojects never merge by accident.
 * Only Windows roots compare without case; the path inside the repository keeps its case, so
 * `Services/API` and `services/api` stay apart.
 */
export function getWorkbenchRepositoryKey(project: EnvironmentProject): string | null {
  const identity = project.repositoryIdentity;
  const rootPath = identity?.rootPath?.trim();
  if (project.isScratch || !identity || !rootPath) return null;
  const windows = isWindowsDrivePath(rootPath) || isUncPath(rootPath);
  const normalize = (path: string) => {
    const normalized = normalizeProjectPathForDispatch(path);
    return windows ? normalized.replaceAll("\\", "/") : normalized;
  };
  const fold = (path: string) => (windows ? path.toLowerCase() : path);
  const root = normalize(rootPath);
  const workspace = normalize(project.workspaceRoot);
  const remote = repositoryGroupingKeyOf(identity).toLowerCase();
  if (fold(workspace) === fold(root)) return remote;
  if (!fold(workspace).startsWith(`${fold(root)}/`)) return null;
  return `${remote}::${workspace.slice(root.length + 1)}`;
}

/** Keys a Board's repositories, falling back to the Project itself when its identity is unknown. */
export function makeWorkbenchRepositoryKeyOf({
  board,
  projects,
}: {
  board: Pick<WorkbenchBoardLinks, "repositoryKeys"> | undefined;
  projects: ReadonlyArray<EnvironmentProject>;
}) {
  const stored = new Map(
    board?.repositoryKeys?.map(({ projectId, repositoryKey }) => [projectId, repositoryKey]),
  );
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  return (projectId: ProjectId) => {
    const live = projectsById.get(projectId);
    return (
      stored.get(projectId) ?? (live && getWorkbenchRepositoryKey(live)) ?? `project:${projectId}`
    );
  };
}

/**
 * Keys a linked Project the way the server does: by its stored key only, so a link stored
 * without one matches nothing else.
 */
function makeWorkbenchStoredKeyOf(board: Pick<WorkbenchBoardLinks, "repositoryKeys"> | undefined) {
  const stored = new Map(
    board?.repositoryKeys?.map(({ projectId, repositoryKey }) => [projectId, repositoryKey]),
  );
  return (projectId: ProjectId) => stored.get(projectId) ?? `project:${projectId}`;
}

/** Repository keys the Board has not stored yet but this client can derive. */
export function getMissingWorkbenchRepositoryKeys({
  board,
  projects,
}: {
  board: WorkbenchBoardLinks;
  projects: ReadonlyArray<EnvironmentProject>;
}) {
  return board.linkedProjectIds.flatMap((projectId) => {
    if (board.repositoryKeys?.some((entry) => entry.projectId === projectId)) return [];
    const project = projects.find((candidate) => candidate.id === projectId);
    const repositoryKey = project ? getWorkbenchRepositoryKey(project) : null;
    return repositoryKey === null ? [] : [{ projectId, repositoryKey }];
  });
}

/**
 * Keeps one Project per repository, so a repository linked on several machines shows once. The
 * Projects a Ticket names win, then the Board's machine, then its default machine.
 */
function collapseByRepository<T extends EnvironmentProject>({
  projects,
  keyOf,
  preferredEnvironmentIds,
  preferredProjectIds = [],
}: {
  projects: ReadonlyArray<T>;
  keyOf: (projectId: ProjectId) => string;
  preferredEnvironmentIds: ReadonlyArray<EnvironmentId | null | undefined>;
  preferredProjectIds?: ReadonlyArray<ProjectId> | undefined;
}) {
  const rank = (project: T) => {
    if (preferredProjectIds.includes(project.id)) return -1;
    const index = preferredEnvironmentIds.indexOf(project.environmentId);
    return index === -1 ? preferredEnvironmentIds.length : index;
  };
  const chosen = new Map<string, T>();
  for (const project of projects) {
    const key = keyOf(project.id);
    const current = chosen.get(key);
    if (current === undefined || rank(project) < rank(current)) chosen.set(key, project);
  }
  const kept = new Set(chosen.values());
  // A Ticket's saved checkouts all stay, even two of one repository, so its scope still validates.
  return projects.filter(
    (project) => kept.has(project) || preferredProjectIds.includes(project.id),
  );
}

/** Every Project the Board links, each on its own link's machine. */
export function getWorkbenchBoardLinkedProjects({
  board,
  projects,
  environmentId,
}: {
  board: WorkbenchBoardLinks;
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

export function getWorkbenchBoardRepositories({
  board,
  projects,
  environmentId,
  ticketProjectIds,
}: {
  board: WorkbenchBoardLinks;
  projects: ReadonlyArray<EnvironmentProject>;
  environmentId: EnvironmentId | null;
  /** The selected Ticket's repositories, which stay visible so its scope remains valid. */
  ticketProjectIds?: ReadonlyArray<ProjectId> | undefined;
}) {
  const linked = getWorkbenchBoardLinkedProjects({ board, projects, environmentId });
  const keyOf = makeWorkbenchRepositoryKeyOf({ board, projects });
  return collapseByRepository({
    projects: linked,
    keyOf,
    preferredEnvironmentIds: [
      // A repository added to a Ticket then stays on the Ticket's machine.
      linked.find((project) => ticketProjectIds?.includes(project.id))?.environmentId,
      fullestEnvironment({ projects: linked, keyOf, environmentId }),
      environmentId,
      board.defaultEnvironmentId,
    ],
    preferredProjectIds: ticketProjectIds,
  });
}

/**
 * The machine linking the most repositories, so a new Ticket can pick them on one machine. The
 * Board's machine wins ties.
 */
function fullestEnvironment({
  projects,
  keyOf,
  environmentId,
}: {
  projects: ReadonlyArray<EnvironmentProject>;
  keyOf: (projectId: ProjectId) => string;
  environmentId: EnvironmentId | null;
}) {
  const keysByEnvironment = new Map<EnvironmentId, Set<string>>();
  for (const project of projects) {
    const keys = keysByEnvironment.get(project.environmentId) ?? new Set<string>();
    keys.add(keyOf(project.id));
    keysByEnvironment.set(project.environmentId, keys);
  }
  const coverage = (id: EnvironmentId | null) =>
    id === null ? 0 : (keysByEnvironment.get(id)?.size ?? 0);
  let fullest = environmentId;
  for (const id of keysByEnvironment.keys()) if (coverage(id) > coverage(fullest)) fullest = id;
  return fullest;
}

export type ResolveWorkbenchTicketRepositories = (
  projectIds: ReadonlyArray<ProjectId>,
) => ReadonlyArray<ProjectId> | null;

/**
 * Maps chosen repositories to one machine's Board links, since pickers show one checkout per
 * repository: the Board's machine when it links them all, else its default machine, else the
 * fullest. Null when no machine links every chosen repository.
 */
export function resolveWorkbenchTicketRepositories({
  board,
  projects,
  environmentId,
  projectIds,
}: {
  board: WorkbenchBoardLinks;
  projects: ReadonlyArray<EnvironmentProject>;
  environmentId: EnvironmentId | null;
  projectIds: ReadonlyArray<ProjectId>;
}) {
  const linked = getWorkbenchBoardLinkedProjects({ board, projects, environmentId });
  const keyOf = makeWorkbenchRepositoryKeyOf({ board, projects });
  const machines = new Set([
    environmentId,
    board.defaultEnvironmentId,
    fullestEnvironment({ projects: linked, keyOf, environmentId }),
    ...linked.map((project) => project.environmentId),
  ]);
  for (const machine of machines) {
    const here = linked.filter((project) => project.environmentId === machine);
    const mapped = projectIds.flatMap((id) => {
      const match =
        here.find((project) => project.id === id) ??
        here.find((project) => keyOf(project.id) === keyOf(id));
      return match ? [match.id] : [];
    });
    if (projectIds.length > 0 && new Set(mapped).size === projectIds.length) return mapped;
  }
  return null;
}

/** One Edit Board row: a repository and its checkout on each machine, the Board's machine first. */
export type WorkbenchRepositoryChoice = {
  readonly key: string;
  readonly checkouts: ReadonlyArray<EnvironmentProject>;
  /** Every Board link of this repository, including ones on machines that are offline. */
  readonly linkedProjectIds: ReadonlyArray<ProjectId>;
};

/**
 * Lists each repository once for Edit Board. On each machine a reachable checkout stands for
 * it, a linked one first, so a replaced Project can be linked while its old link stays.
 */
export function getWorkbenchRepositoryChoices({
  board,
  projects,
  environmentId,
}: {
  board: Pick<WorkbenchBoardLinks, "linkedProjectIds" | "remoteProjects" | "repositoryKeys">;
  projects: ReadonlyArray<EnvironmentProject>;
  environmentId: EnvironmentId | null;
}): ReadonlyArray<WorkbenchRepositoryChoice> {
  const keyOf = makeWorkbenchRepositoryKeyOf({ board, projects });
  // A link selected in this draft has no placeholder yet if its machine disconnects.
  const offline = (board.remoteProjects ?? []).flatMap((remote) =>
    board.linkedProjectIds.includes(remote.projectId) &&
    !projects.some(
      (project) =>
        project.id === remote.projectId && project.environmentId === remote.environmentId,
    )
      ? [unavailableWorkbenchRepository(remote, "")]
      : [],
  );
  const rank = (project: EnvironmentProject) =>
    (project.workspaceRoot === "" ? 2 : 0) + (board.linkedProjectIds.includes(project.id) ? 0 : 1);
  const rows = new Map<string, EnvironmentProject[]>();
  for (const project of [...projects, ...offline]) {
    const key = keyOf(project.id);
    const checkouts = rows.get(key) ?? [];
    const index = checkouts.findIndex(
      (checkout) => checkout.environmentId === project.environmentId,
    );
    if (index === -1) checkouts.push(project);
    else if (rank(project) < rank(checkouts[index]!)) checkouts[index] = project;
    rows.set(key, checkouts);
  }
  return Array.from(rows, ([key, checkouts]) => ({
    key,
    checkouts: checkouts.toSorted(
      (left, right) =>
        Number(right.environmentId === environmentId) -
        Number(left.environmentId === environmentId),
    ),
    linkedProjectIds: board.linkedProjectIds.filter((id) => keyOf(id) === key),
  }));
}

/**
 * Links every reachable checkout of each repository the Board links, so a Ticket can run on any
 * machine that checks out all of its repositories. `row` selects or clears one repository. Keys
 * of new links are kept so a link stays in its row if its machine disconnects.
 */
export function linkWorkbenchRepositoryCheckouts({
  board,
  projects,
  environmentId,
  row,
}: {
  board: Pick<WorkbenchBoardLinks, "linkedProjectIds" | "remoteProjects" | "repositoryKeys">;
  projects: ReadonlyArray<EnvironmentProject>;
  environmentId: EnvironmentId | null;
  row?: { readonly choice: WorkbenchRepositoryChoice; readonly checked: boolean } | undefined;
}) {
  const removed = new Set(row && !row.checked ? row.choice.linkedProjectIds : []);
  const linkedProjectIds = board.linkedProjectIds.filter((id) => !removed.has(id));
  const linkedSet = new Set(linkedProjectIds);
  const choices = getWorkbenchRepositoryChoices({ board, projects, environmentId });
  const added = choices.flatMap((choice) =>
    (row?.checked && row.choice.key === choice.key) ||
    choice.linkedProjectIds.some((id) => linkedSet.has(id))
      ? choice.checkouts
          .filter((checkout) => checkout.workspaceRoot !== "" && !linkedSet.has(checkout.id))
          .map((checkout) => ({ checkout, key: choice.key }))
      : [],
  );
  return {
    linkedProjectIds: [...linkedProjectIds, ...added.map(({ checkout }) => checkout.id)],
    remoteProjects: [
      ...(board.remoteProjects ?? []).filter((remote) => !removed.has(remote.projectId)),
      ...added.flatMap(({ checkout }) =>
        checkout.environmentId === environmentId
          ? []
          : [
              {
                projectId: checkout.id,
                environmentId: checkout.environmentId,
                title: checkout.title,
              },
            ],
      ),
    ],
    repositoryKeys: [
      ...(board.repositoryKeys ?? []).filter((entry) => !removed.has(entry.projectId)),
      ...added.map(({ checkout, key }) => ({ projectId: checkout.id, repositoryKey: key })),
    ],
  };
}

export interface WorkbenchThreadMachine {
  readonly environmentId: EnvironmentId;
  /** This machine's checkout of each Ticket repository, keyed by the Ticket's Project ID. */
  readonly projectsByRepository: ReadonlyMap<ProjectId, EnvironmentProject>;
}

/** The machine a Board link lives on. */
export function getWorkbenchLinkEnvironment({
  board,
  boardEnvironmentId,
  projectId,
}: {
  board: Pick<WorkbenchBoardLinks, "remoteProjects"> | undefined;
  boardEnvironmentId: EnvironmentId;
  projectId: ProjectId;
}) {
  return (
    board?.remoteProjects?.find((remote) => remote.projectId === projectId)?.environmentId ??
    boardEnvironmentId
  );
}

/**
 * Machines that check out every repository in the Ticket's scope. A linked Project counts only
 * on its own machine; elsewhere a checkout must match its repository key.
 */
export function getWorkbenchThreadMachines({
  board,
  boardEnvironmentId,
  repositoryProjectIds,
  projects,
}: {
  board:
    | Pick<WorkbenchBoardLinks, "linkedProjectIds" | "remoteProjects" | "repositoryKeys">
    | undefined;
  boardEnvironmentId: EnvironmentId;
  repositoryProjectIds: ReadonlyArray<ProjectId>;
  projects: ReadonlyArray<EnvironmentProject>;
}): ReadonlyArray<WorkbenchThreadMachine> {
  const storedKeyOf = makeWorkbenchStoredKeyOf(board);
  // A linked checkout keeps its stored key, on its link's machine only; an unlinked one joins
  // under the key it derives.
  const checkoutKeyOf = (project: EnvironmentProject) => {
    if (!board?.linkedProjectIds.includes(project.id)) return getWorkbenchRepositoryKey(project);
    const linkEnvironmentId = getWorkbenchLinkEnvironment({
      board,
      boardEnvironmentId,
      projectId: project.id,
    });
    return linkEnvironmentId === project.environmentId ? storedKeyOf(project.id) : null;
  };
  const reachable = projects.filter((project) => project.workspaceRoot !== "");
  const environmentIds = [...new Set(reachable.map((project) => project.environmentId))];
  const checkoutOn = (environmentId: EnvironmentId, repositoryProjectId: ProjectId) => {
    const linkedHere =
      getWorkbenchLinkEnvironment({ board, boardEnvironmentId, projectId: repositoryProjectId }) ===
      environmentId;
    const candidates = reachable.filter(
      (project) =>
        project.environmentId === environmentId &&
        ((linkedHere && project.id === repositoryProjectId) ||
          checkoutKeyOf(project) === storedKeyOf(repositoryProjectId)),
    );
    // Several checkouts on one machine: prefer the one the Ticket already names.
    return candidates.find((project) => project.id === repositoryProjectId) ?? candidates[0];
  };
  return environmentIds.flatMap((environmentId) => {
    const projectsByRepository = new Map<ProjectId, EnvironmentProject>();
    for (const repositoryProjectId of repositoryProjectIds) {
      const match = checkoutOn(environmentId, repositoryProjectId);
      if (match === undefined) return [];
      projectsByRepository.set(repositoryProjectId, match);
    }
    return [{ environmentId, projectsByRepository }];
  });
}

/**
 * Ticket worktrees exist only on the Board's machine for the Ticket's own linked checkouts, so a
 * machine using any other checkout runs the Thread in that checkout.
 */
export const isWorkbenchCheckoutOnly = (
  machine: WorkbenchThreadMachine,
  boardEnvironmentId: EnvironmentId,
) =>
  machine.environmentId !== boardEnvironmentId ||
  [...machine.projectsByRepository].some(([savedId, project]) => project.id !== savedId);

/** An explicit pick wins; then the Board default, the Board's machine, and any other machine. */
export function chooseWorkbenchThreadMachine({
  machines,
  picked,
  defaultEnvironmentId,
  boardEnvironmentId,
  scopeEnvironmentId,
}: {
  machines: ReadonlyArray<WorkbenchThreadMachine>;
  picked: EnvironmentId | undefined;
  defaultEnvironmentId: EnvironmentId | undefined;
  boardEnvironmentId: EnvironmentId;
  scopeEnvironmentId: EnvironmentId | undefined;
}) {
  if (picked !== undefined) return machines.find((machine) => machine.environmentId === picked);
  for (const candidate of [defaultEnvironmentId, boardEnvironmentId, scopeEnvironmentId]) {
    const machine = machines.find((entry) => entry.environmentId === candidate);
    if (machine) return machine;
  }
  return machines[0];
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

/**
 * Whether a Thread works in one of the Ticket's repositories, on any machine. Null means it
 * does not; `repository` names the Board repository a not-yet-linked checkout joins.
 */
export function matchWorkbenchTicketThread({
  board,
  boardEnvironmentId,
  repositoryProjectIds,
  projects,
  thread,
}: {
  board: WorkbenchBoardLinks | undefined;
  boardEnvironmentId: EnvironmentId;
  repositoryProjectIds: ReadonlyArray<ProjectId>;
  projects: ReadonlyArray<EnvironmentProject>;
  thread: { readonly projectId: ProjectId; readonly environmentId: EnvironmentId };
}): { readonly repository?: WorkbenchThreadRepository } | null {
  const keyOf = makeWorkbenchStoredKeyOf(board);
  const ticketKeys = new Set(repositoryProjectIds.map(keyOf));
  if (board?.linkedProjectIds.includes(thread.projectId)) {
    const linkedEnvironmentId =
      board.remoteProjects?.find((remote) => remote.projectId === thread.projectId)
        ?.environmentId ?? boardEnvironmentId;
    return linkedEnvironmentId === thread.environmentId && ticketKeys.has(keyOf(thread.projectId))
      ? {}
      : null;
  }
  const project = projects.find(
    (candidate) =>
      candidate.id === thread.projectId && candidate.environmentId === thread.environmentId,
  );
  const repositoryKey = project ? getWorkbenchRepositoryKey(project) : null;
  if (project === undefined || repositoryKey === null || !ticketKeys.has(repositoryKey))
    return null;
  return { repository: { repositoryKey, title: project.title } };
}

/** The saved Ticket repository a Thread's checkout stands for, which may be on another machine. */
export function matchWorkbenchSavedRepository({
  board,
  projects,
  projectId,
  savedProjectIds,
}: {
  board: WorkbenchBoardLinks | undefined;
  projects: ReadonlyArray<EnvironmentProject>;
  projectId: ProjectId | undefined;
  savedProjectIds: ReadonlyArray<ProjectId>;
}) {
  if (projectId === undefined || savedProjectIds.includes(projectId)) return projectId;
  const keyOf = makeWorkbenchRepositoryKeyOf({ board, projects });
  return savedProjectIds.find((savedId) => keyOf(savedId) === keyOf(projectId)) ?? projectId;
}
