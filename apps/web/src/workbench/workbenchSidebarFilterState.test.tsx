import { EnvironmentId } from "@t3tools/contracts";
import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { useWorkbenchSidebarFilters } from "./workbenchSidebarFilterState";

let renderer: ReactTestRenderer;
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("keeps the bell and search through sidebar remounts without leaking between environments", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const local = EnvironmentId.make("sidebar-filter-local");
  const remote = EnvironmentId.make("sidebar-filter-remote");
  let filters: ReturnType<typeof useWorkbenchSidebarFilters>;
  function Sidebar({ environmentId }: { environmentId: EnvironmentId | null }) {
    const current = useWorkbenchSidebarFilters(environmentId);
    useEffect(() => {
      filters = current;
    }, [current]);
    return null;
  }
  act(() => {
    renderer = create(<Sidebar environmentId={local} />);
  });
  act(() => filters.setSidebarSearch("feedback"));
  act(() => filters.setOnlyActionable(true));
  act(() => renderer.unmount());
  act(() => {
    renderer = create(<Sidebar environmentId={local} />);
  });
  expect(filters!.sidebarQuery).toBe("feedback");
  expect(filters!.onlyActionable).toBe(true);
  act(() => renderer.update(<Sidebar environmentId={remote} />));
  expect(filters!.sidebarQuery).toBe("");
  expect(filters!.onlyActionable).toBe(false);
  act(() => filters.setSidebarSearch("waiting"));
  act(() => renderer.update(<Sidebar environmentId={local} />));
  expect(filters!.sidebarQuery).toBe("feedback");
  expect(filters!.onlyActionable).toBe(true);
  act(() => filters.setSidebarSearch(""));
  expect(filters!.onlyActionable).toBe(true);
  act(() => renderer.update(<Sidebar environmentId={null} />));
  act(() => filters.setOnlyActionable(true));
  expect(filters!.onlyActionable).toBe(false);
  act(() => renderer.update(<Sidebar environmentId={remote} />));
  expect(filters!.sidebarQuery).toBe("waiting");
  expect(filters!.onlyActionable).toBe(false);
});
