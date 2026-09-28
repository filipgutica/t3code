import type { EnvironmentId, ProjectId, WorkbenchProjectId } from "@t3tools/contracts";
import { useCallback } from "react";
import { create } from "zustand";

export interface WorkbenchBoardScope {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: WorkbenchProjectId | null;
}

interface WorkbenchBoardView {
  readonly searchText: string;
  readonly groupMode: "none" | "epic";
  readonly repositoryId: ProjectId | null;
  readonly mobileColumnId: string | null;
}

const DEFAULT_VIEW: WorkbenchBoardView = {
  searchText: "",
  groupMode: "none",
  repositoryId: null,
  mobileColumnId: null,
};

// View preferences belong to this client session, not to the shared Ticket snapshot.
const useBoardViews = create<{
  readonly views: ReadonlyMap<string, WorkbenchBoardView>;
  readonly update: (key: string, patch: Partial<WorkbenchBoardView>) => void;
}>((set) => ({
  views: new Map(),
  update: (key, patch) =>
    set((state) => {
      const previous = state.views.get(key) ?? DEFAULT_VIEW;
      const next = { ...previous, ...patch };
      if (
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
}));

export function useWorkbenchBoardView(scope: WorkbenchBoardScope) {
  const key =
    scope.environmentId !== null && scope.projectId !== null
      ? JSON.stringify([scope.environmentId, scope.projectId])
      : null;
  const view = useBoardViews((state) =>
    key === null ? DEFAULT_VIEW : (state.views.get(key) ?? DEFAULT_VIEW),
  );
  const update = useBoardViews((state) => state.update);
  const setView = useCallback(
    (patch: Partial<WorkbenchBoardView>) => {
      if (key !== null) update(key, patch);
    },
    [key, update],
  );
  return { view, setView, scopeKey: key };
}
