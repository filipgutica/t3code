import { act, render } from "../../test/render";
import { EnvironmentId } from "@t3tools/contracts";
import { useEffect } from "react";
import { expect, it } from "vite-plus/test";
import { useWorkbenchSidebarFilters } from "./workbenchSidebarFilterState";
it("keeps the bell and search through sidebar remounts without leaking between environments", async () => {
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
  await using screens = new AsyncDisposableStack();
  let screen = screens.use(await render(<Sidebar environmentId={local} />));
  await act(() => filters.setSidebarSearch("feedback"));
  await act(() => filters.setOnlyActionable(true));
  await screen.unmount();
  screen = screens.use(await render(<Sidebar environmentId={local} />));
  expect(filters!.sidebarQuery).toBe("feedback");
  expect(filters!.onlyActionable).toBe(true);
  await screen.rerender(<Sidebar environmentId={remote} />);
  expect(filters!.sidebarQuery).toBe("");
  expect(filters!.onlyActionable).toBe(false);
  await act(() => filters.setSidebarSearch("waiting"));
  await screen.rerender(<Sidebar environmentId={local} />);
  expect(filters!.sidebarQuery).toBe("feedback");
  expect(filters!.onlyActionable).toBe(true);
  await act(() => filters.setSidebarSearch(""));
  expect(filters!.onlyActionable).toBe(true);
  await screen.rerender(<Sidebar environmentId={null} />);
  await act(() => filters.setOnlyActionable(true));
  expect(filters!.onlyActionable).toBe(false);
  await screen.rerender(<Sidebar environmentId={remote} />);
  expect(filters!.sidebarQuery).toBe("waiting");
  expect(filters!.onlyActionable).toBe(false);
});
