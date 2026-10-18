// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useWorkbenchSidebarReveal } from "./useWorkbenchSidebarReveal";
import { getWorkbenchSidebarRevealDecision } from "./workbenchSidebarReveal.logic";

let root: Root;
let host: HTMLDivElement;
let rowOffset: number;
let reducedMotion: boolean;
const scrollIntoView = vi.fn(function (this: HTMLElement) {
  const viewport = this.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
  viewport.scrollTop = rowOffset > viewport.scrollTop ? rowOffset - 80 : rowOffset;
});

function Harness({
  activeKey = "ticket",
  onlyActionable = false,
  listKey = "list",
  showRow = true,
}: {
  activeKey?: string;
  onlyActionable?: boolean;
  listKey?: string;
  showRow?: boolean;
}) {
  const navigationRef = useRef<HTMLDivElement>(null);
  const contentRef = useWorkbenchSidebarReveal({
    navigationRef,
    activeKey,
    onlyActionable,
    isSearching: false,
  });
  return (
    <div data-slot="scroll-area-viewport">
      <div ref={contentRef}>
        <div key={listKey} ref={navigationRef}>
          {showRow ? <div data-workbench-sidebar-surface="" data-active="true" /> : null}
        </div>
      </div>
    </div>
  );
}
const viewport = () => host.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
const row = () => host.querySelector<HTMLElement>("[data-workbench-sidebar-surface]")!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: reducedMotion }));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = this.hasAttribute("data-workbench-sidebar-surface")
      ? rowOffset -
        (this.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')?.scrollTop ?? 0)
      : 0;
    return new DOMRect(0, top, 100, this.hasAttribute("data-workbench-sidebar-surface") ? 20 : 100);
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (
    this: HTMLElement,
  ) {
    const bounds = this.getBoundingClientRect();
    return Object.assign([bounds], { item: () => bounds });
  });
  rowOffset = 20;
  reducedMotion = false;
  scrollIntoView.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("leaves a visible destination still, then reveals navigation to an offscreen row once", () => {
  act(() => root.render(<Harness />));
  act(() => root.render(<Harness activeKey="visible-thread" />));
  expect(scrollIntoView).not.toHaveBeenCalled();
  rowOffset = 300;
  act(() => root.render(<Harness activeKey="new-thread" />));
  expect(viewport().scrollTop).toBe(220);
  expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({
    block: "nearest",
    inline: "nearest",
    behavior: "instant",
  });
  act(() => vi.advanceTimersByTime(32));
  expect(row().hasAttribute("data-workbench-sidebar-reveal")).toBe(true);
  rowOffset = 600;
  act(() => root.render(<Harness activeKey="new-thread" />));
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
});

it("waits for the active row to arrive after navigation", () => {
  act(() => root.render(<Harness showRow={false} />));
  rowOffset = 300;
  act(() => root.render(<Harness />));
  expect(viewport().scrollTop).toBe(220);
});

it("reveals after a list remount, but not after an ordinary refresh or a focus scroll", () => {
  act(() => root.render(<Harness />));
  rowOffset = 300;
  act(() => root.render(<Harness />));
  expect(scrollIntoView).not.toHaveBeenCalled();
  act(() => root.render(<Harness listKey="remounted" />));
  expect(viewport().scrollTop).toBe(220);
  // Tabbing to a control near the top scrolls the viewport without user scroll input.
  viewport().scrollTop = 0;
  act(() => viewport().dispatchEvent(new Event("scroll")));
  expect(viewport().scrollTop).toBe(0);
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
});

it("pulses a visible row on a filter switch and restarts the pulse on the reverse switch", () => {
  act(() => root.render(<Harness />));
  act(() => root.render(<Harness onlyActionable />));
  act(() => vi.advanceTimersByTime(32));
  expect(row().hasAttribute("data-workbench-sidebar-reveal")).toBe(true);
  act(() => root.render(<Harness />));
  expect(row().hasAttribute("data-workbench-sidebar-reveal")).toBe(false);
  act(() => vi.advanceTimersByTime(32));
  expect(row().hasAttribute("data-workbench-sidebar-reveal")).toBe(true);
  expect(scrollIntoView).not.toHaveBeenCalled();
});

it("lets wheel input cancel a pending reveal, including when the row arrives later", () => {
  act(() => root.render(<Harness />));
  act(() => viewport().dispatchEvent(new Event("wheel")));
  rowOffset = 300;
  act(() => root.render(<Harness activeKey="thread" showRow={false} />));
  act(() => vi.advanceTimersByTime(300));
  act(() => root.render(<Harness activeKey="thread" />));
  expect(scrollIntoView).not.toHaveBeenCalled();
  expect(viewport().scrollTop).toBe(0);
});

it.each(["touchmove", "keydown"])("does not reveal during %s scrolling", (type) => {
  act(() => root.render(<Harness />));
  const event = type === "keydown" ? new KeyboardEvent(type, { key: "PageDown" }) : new Event(type);
  act(() => viewport().dispatchEvent(event));
  rowOffset = 300;
  act(() => root.render(<Harness activeKey="thread" />));
  expect(scrollIntoView).not.toHaveBeenCalled();
});

it("uses instant scrolling and no pulse with reduced motion", () => {
  reducedMotion = true;
  rowOffset = 300;
  act(() => root.render(<Harness />));
  act(() => vi.advanceTimersByTime(32));
  expect(viewport().scrollTop).toBe(220);
  expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "instant" }));
  expect(row().hasAttribute("data-workbench-sidebar-reveal")).toBe(false);
});

it("pulses a visible row reached from outside the sidebar, but not one picked in it", () => {
  act(() => root.render(<Harness />));
  act(() => vi.advanceTimersByTime(32));
  expect(row().hasAttribute("data-workbench-sidebar-reveal")).toBe(false);
  act(() => root.render(<Harness activeKey="created-thread" />));
  act(() => vi.advanceTimersByTime(32));
  expect(row().hasAttribute("data-workbench-sidebar-reveal")).toBe(true);
  row().removeAttribute("data-workbench-sidebar-reveal");
  act(() => row().dispatchEvent(new Event("pointerdown", { bubbles: true })));
  act(() => root.render(<Harness activeKey="clicked-thread" />));
  act(() => vi.advanceTimersByTime(32));
  expect(row().hasAttribute("data-workbench-sidebar-reveal")).toBe(false);
  expect(scrollIntoView).not.toHaveBeenCalled();
});

it("only requests movement for an offscreen reveal and pulses filters and outside destinations", () => {
  const decide = (
    reason: Parameters<typeof getWorkbenchSidebarRevealDecision>[0]["reason"],
    options: { fullyVisible?: boolean; userScrolling?: boolean; selectedInSidebar?: boolean } = {},
  ) =>
    getWorkbenchSidebarRevealDecision({
      reason,
      fullyVisible: options.fullyVisible ?? true,
      userScrolling: options.userScrolling ?? false,
      selectedInSidebar: options.selectedInSidebar ?? false,
    });
  expect(decide(null, { fullyVisible: false })).toEqual({ scroll: false, pulse: false });
  expect(decide("destination", { selectedInSidebar: true })).toEqual({
    scroll: false,
    pulse: false,
  });
  expect(decide("destination")).toEqual({ scroll: false, pulse: true });
  expect(decide("filter")).toEqual({ scroll: false, pulse: true });
  expect(decide("reset")).toEqual({ scroll: false, pulse: false });
  expect(decide("reset", { fullyVisible: false, userScrolling: true })).toEqual({
    scroll: false,
    pulse: false,
  });
});
