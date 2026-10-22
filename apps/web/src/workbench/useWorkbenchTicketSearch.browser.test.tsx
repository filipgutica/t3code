import { EnvironmentId, WorkbenchProjectId } from "@t3tools/contracts";
import { useLayoutEffect } from "react";
import { act, render, fakeTimers } from "../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";
import { matchesWorkbenchTicketSearch, useWorkbenchTicketSearch } from "./useWorkbenchTicketSearch";
describe("Workbench ticket search", async () => {
  it("matches titles and Jira keys without case or surrounding whitespace", async () => {
    expect(
      matchesWorkbenchTicketSearch({ title: "Fix login", jiraKey: "MA-5360", query: " LOGIN " }),
    ).toBe(true);
    expect(
      matchesWorkbenchTicketSearch({ title: "Fix login", jiraKey: "MA-5360", query: "ma-536" }),
    ).toBe(true);
    expect(matchesWorkbenchTicketSearch({ title: "Fix login", query: "  " })).toBe(true);
    expect(matchesWorkbenchTicketSearch({ title: "Fix login", query: "billing" })).toBe(false);
  });
  async function setup() {
    await using resources = new AsyncDisposableStack();
    resources.use(fakeTimers());
    let search!: ReturnType<typeof useWorkbenchTicketSearch>;
    function Harness({
      projectId = WorkbenchProjectId.make("search-workspace"),
    }: {
      projectId?: WorkbenchProjectId;
    }) {
      const current = useWorkbenchTicketSearch({
        environmentId: EnvironmentId.make("search-test"),
        projectId,
      });
      useLayoutEffect(() => {
        search = current;
      });
      return null;
    }
    // Debounce cleanup is independent of navigation; router timers would obscure it.
    const screen = resources.use(await render(<Harness />, { router: false }));
    await act(() => search.setText(""));
    const owned = resources.move();
    return {
      get search() {
        return search;
      },
      screen,
      Harness,
      [Symbol.asyncDispose]: () => owned.disposeAsync(),
    };
  }
  it("waits 200 ms after the last keystroke before filtering", async () => {
    await using fixture = await setup();
    await act(() => fixture.search.setText("log"));
    await act(() => vi.advanceTimersByTime(150));
    await act(() => fixture.search.setText("login"));
    await act(() => vi.advanceTimersByTime(199));
    expect(fixture.search.text).toBe("login");
    expect(fixture.search.query).toBe("");
    await act(() => vi.advanceTimersByTime(1));
    expect(fixture.search.query).toBe("login");
  });
  it("clears immediately and never revives a stale query while typing again", async () => {
    await using fixture = await setup();
    await act(() => fixture.search.setText("login"));
    await act(() => vi.advanceTimersByTime(200));
    await act(() => fixture.search.setText("billing"));
    await act(() => fixture.search.setText(""));
    expect(fixture.search.query).toBe("");
    await act(() => fixture.search.setText("jira"));
    expect(fixture.search.query).toBe("");
    await act(() => vi.advanceTimersByTime(200));
    expect(fixture.search.query).toBe("jira");
    await act(() => fixture.search.setText("   "));
    expect(fixture.search.query).toBe("");
  });
  it("cancels a pending search when switching workspaces without leaking the query", async () => {
    await using fixture = await setup();
    await act(() => fixture.search.setText("login"));
    await fixture.screen.rerender(
      <fixture.Harness projectId={WorkbenchProjectId.make("another-search-workspace")} />,
    );
    expect(fixture.search.text).toBe("");
    expect(fixture.search.query).toBe("");
    expect(vi.getTimerCount()).toBe(0);
    await act(() => vi.advanceTimersByTime(200));
    expect(fixture.search.query).toBe("");
    await fixture.screen.rerender(<fixture.Harness />);
    expect(fixture.search.text).toBe("login");
    expect(fixture.search.query).toBe("login");
  });
  it("cancels pending filtering when the board unmounts", async () => {
    await using fixture = await setup();
    await act(() => fixture.search.setText("login"));
    await fixture.screen.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
