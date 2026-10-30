import type {
  EnvironmentId,
  ProjectId,
  WorkbenchProject,
  WorkbenchProjectId,
} from "@t3tools/contracts";
import { create } from "zustand";

export interface WorkbenchBoardScope {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: WorkbenchProjectId | null;
}

interface WorkbenchBoardView {
  readonly attentionMode: "all" | "attention" | "replies";
  readonly searchText: string;
  readonly groupMode: "none" | "epic";
  readonly repositoryId: ProjectId | null;
  readonly mobileColumnId: string | null;
}

const DEFAULT_VIEW: WorkbenchBoardView = {
  attentionMode: "all",
  searchText: "",
  groupMode: "none",
  repositoryId: null,
  mobileColumnId: null,
};

// View preferences belong to this client session, not to the shared Ticket snapshot.
export const useWorkbenchBoardViewStore = create<{
  readonly views: ReadonlyMap<string, WorkbenchBoardView>;
  readonly mountedBoards: ReadonlyMap<string, number>;
  readonly mountBoard: (key: string) => () => void;
  readonly update: (key: string, patch: Partial<WorkbenchBoardView>) => void;
  readonly reconcileRepositories: (
    environmentId: EnvironmentId,
    projects: ReadonlyArray<Pick<WorkbenchProject, "id" | "linkedProjectIds">> | null,
  ) => void;
}>((set) => ({
  views: new Map(),
  mountedBoards: new Map(),
  mountBoard: (key) => {
    set((state) => ({
      mountedBoards: new Map(state.mountedBoards).set(key, (state.mountedBoards.get(key) ?? 0) + 1),
    }));
    let mounted = true;
    return () => {
      if (!mounted) return;
      mounted = false;
      set((state) => {
        const mountedBoards = new Map(state.mountedBoards);
        const count = mountedBoards.get(key) ?? 0;
        if (count > 1) mountedBoards.set(key, count - 1);
        else mountedBoards.delete(key);
        return { mountedBoards };
      });
    };
  },
  update: (key, patch) =>
    set((state) => {
      const previous = state.views.get(key) ?? DEFAULT_VIEW;
      const next = { ...previous, ...patch };
      if (
        previous.attentionMode === next.attentionMode &&
        previous.searchText === next.searchText &&
        previous.groupMode === next.groupMode &&
        previous.repositoryId === next.repositoryId &&
        previous.mobileColumnId === next.mobileColumnId
      )
        return state;
      const views = new Map(state.views);
      views.set(key, next);
      return { views };
    }),
  reconcileRepositories: (environmentId, projects) =>
    set((state) => {
      if (projects === null) return state;
      const projectsById = new Map(projects.map((project) => [project.id, project]));
      let views: Map<string, WorkbenchBoardView> | undefined;
      for (const [key, view] of state.views) {
        if (!state.mountedBoards.has(key)) continue;
        if (view.repositoryId === null) continue;
        const [owner, projectId] = JSON.parse(key) as [EnvironmentId, WorkbenchProjectId];
        if (owner !== environmentId) continue;
        const project = projectsById.get(projectId);
        if (!project || project.linkedProjectIds.includes(view.repositoryId)) continue;
        views ??= new Map(state.views);
        views.set(key, { ...view, repositoryId: null });
      }
      return views === undefined ? state : { views };
    }),
}));

export function useWorkbenchBoardView(scope: WorkbenchBoardScope) {
  const key =
    scope.environmentId !== null && scope.projectId !== null
      ? JSON.stringify([scope.environmentId, scope.projectId])
      : null;
  const view = useWorkbenchBoardViewStore((state) =>
    key === null ? DEFAULT_VIEW : (state.views.get(key) ?? DEFAULT_VIEW),
  );
  const update = useWorkbenchBoardViewStore((state) => state.update);
  const setView = (patch: Partial<WorkbenchBoardView>) => {
    if (key !== null) update(key, patch);
  };
  return { view, setView, scopeKey: key };
}
