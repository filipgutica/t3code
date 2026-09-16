import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { matchesWorkbenchTicketSearch, useWorkbenchTicketSearch } from "./useWorkbenchTicketSearch";

describe("Workbench ticket search", () => {
  it("matches titles and Jira keys without case or surrounding whitespace", () => {
    expect(
      matchesWorkbenchTicketSearch({ title: "Fix login", jiraKey: "MA-5360", query: " LOGIN " }),
    ).toBe(true);
    expect(
      matchesWorkbenchTicketSearch({ title: "Fix login", jiraKey: "MA-5360", query: "ma-536" }),
    ).toBe(true);
    expect(matchesWorkbenchTicketSearch({ title: "Fix login", query: "  " })).toBe(true);
    expect(matchesWorkbenchTicketSearch({ title: "Fix login", query: "billing" })).toBe(false);
  });

  let renderer: ReactTestRenderer | undefined;
  let search: ReturnType<typeof useWorkbenchTicketSearch>;
  function Harness() {
    const current = useWorkbenchTicketSearch();
    useLayoutEffect(() => {
      search = current;
    });
    return null;
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    act(() => {
      renderer = create(<Harness />);
    });
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("waits 200 ms after the last keystroke before filtering", () => {
    act(() => search.setText("log"));
    act(() => vi.advanceTimersByTime(150));
    act(() => search.setText("login"));
    act(() => vi.advanceTimersByTime(199));
    expect(search.text).toBe("login");
    expect(search.query).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(search.query).toBe("login");
  });
  it("clears immediately and never revives a stale query while typing again", () => {
    act(() => search.setText("login"));
    act(() => vi.advanceTimersByTime(200));
    act(() => search.setText("billing"));
    act(() => search.setText(""));
    expect(search.query).toBe("");
    act(() => search.setText("jira"));
    expect(search.query).toBe("");
    act(() => vi.advanceTimersByTime(200));
    expect(search.query).toBe("jira");
    act(() => search.setText("   "));
    expect(search.query).toBe("");
  });
  it("cancels pending filtering when the board unmounts", () => {
    act(() => search.setText("login"));
    act(() => renderer?.unmount());
    renderer = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });
});
