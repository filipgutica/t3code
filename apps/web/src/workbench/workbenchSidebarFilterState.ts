import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

interface SidebarFilters {
  readonly query: string;
  readonly onlyActionable: boolean;
}
const defaultFilters: SidebarFilters = { query: "", onlyActionable: false };

// Survive sidebar-sheet dismissal and Thread navigation within this client session.
const useSidebarFilters = create<{
  readonly filters: ReadonlyMap<EnvironmentId, SidebarFilters>;
  readonly update: (environmentId: EnvironmentId, patch: Partial<SidebarFilters>) => void;
}>((set) => ({
  filters: new Map(),
  update: (environmentId, patch) =>
    set((state) => {
      const filters = new Map(state.filters);
      filters.set(environmentId, { ...(filters.get(environmentId) ?? defaultFilters), ...patch });
      return { filters };
    }),
}));

export function useWorkbenchSidebarFilters(environmentId: EnvironmentId | null) {
  const current = useSidebarFilters((state) =>
    environmentId === null ? defaultFilters : (state.filters.get(environmentId) ?? defaultFilters),
  );
  const update = useSidebarFilters((state) => state.update);
  return {
    sidebarQuery: current.query,
    onlyActionable: current.onlyActionable,
    setSidebarSearch: (query: string) => {
      if (environmentId !== null) update(environmentId, { query });
    },
    setOnlyActionable: (onlyActionable: boolean) => {
      if (environmentId !== null) update(environmentId, { onlyActionable });
    },
  };
}
