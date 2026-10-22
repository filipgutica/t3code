import { act, render as renderBrowser, fakeTimers, stubGlobal } from "../../test/render";
import { StrictMode, useRef } from "react";
import { expect, it, vi } from "vite-plus/test";
import type { useWorkbenchSidebarReveal as UseWorkbenchSidebarReveal } from "./useWorkbenchSidebarReveal";

// Destination memory is intentionally module-scoped in the production hook.
async function setup() {
  vi.resetModules();
  const {
    useWorkbenchSidebarReveal,
  }: { useWorkbenchSidebarReveal: typeof UseWorkbenchSidebarReveal } =
    await import("./useWorkbenchSidebarReveal");
  let rowOffset = 20;
  let reducedMotion = false;
  const resources = new AsyncDisposableStack();
  try {
    resources.use(fakeTimers());
    resources.use(stubGlobal("matchMedia", () => ({ matches: reducedMotion })));
    const scrollIntoView = resources.use(
      vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(function (
        this: HTMLElement,
      ) {
        const viewport = this.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
        viewport.scrollTop = rowOffset > viewport.scrollTop ? rowOffset - 80 : rowOffset;
      }),
    );
    resources.use(vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100));
    resources.use(
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
        this: HTMLElement,
      ) {
        const top = this.hasAttribute("data-workbench-sidebar-surface")
          ? rowOffset -
            (this.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')?.scrollTop ?? 0)
          : 0;
        return new DOMRect(
          0,
          top,
          100,
          this.hasAttribute("data-workbench-sidebar-surface") ? 20 : 100,
        );
      }),
    );
    resources.use(
      vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (
        this: HTMLElement,
      ) {
        const bounds = this.getBoundingClientRect();
        return Object.assign([bounds], { item: () => bounds });
      }),
    );
    // The hook consumes DOM navigation refs without router context.
    const screen = resources.use(await renderBrowser(null, { router: false }));
    const host = screen.container;
    function Harness({
      activeKey = "ticket",
      onlyActionable = false,
      listKey = "list",
      showRow = true,
    }: {
      activeKey?: string | null;
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
        <div data-slot="scroll-area-viewport" style={{ height: 100, overflow: "auto" }}>
          <div ref={contentRef} style={{ height: 2000 }}>
            <div key={listKey} ref={navigationRef}>
              {showRow ? <div data-workbench-sidebar-surface="" data-active="true" /> : null}
            </div>
          </div>
        </div>
      );
    }
    const viewport = () => host.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    const row = () => host.querySelector<HTMLElement>("[data-workbench-sidebar-surface]")!;

    return {
      screen,
      Harness,
      viewport,
      row,
      scrollIntoView,
      get rowOffset() {
        return rowOffset;
      },
      set rowOffset(value: number) {
        rowOffset = value;
      },
      get reducedMotion() {
        return reducedMotion;
      },
      set reducedMotion(value: boolean) {
        reducedMotion = value;
      },
      [Symbol.asyncDispose]: () => resources.disposeAsync(),
    };
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
}

it("leaves a visible destination still, then reveals navigation to an offscreen row once", async () => {
  await using context = await setup();
  await act(() => context.screen.rerender(<context.Harness />));
  await act(() => context.screen.rerender(<context.Harness activeKey="visible-thread" />));
  expect(context.scrollIntoView).not.toHaveBeenCalled();
  context.rowOffset = 300;
  await act(() => context.screen.rerender(<context.Harness activeKey="new-thread" />));
  expect(context.viewport().scrollTop).toBe(220);
  expect(context.scrollIntoView).toHaveBeenCalledExactlyOnceWith({
    block: "center",
    inline: "nearest",
    behavior: "instant",
  });
  await act(() => vi.advanceTimersByTime(32));
  expect(context.row().hasAttribute("data-workbench-sidebar-reveal")).toBe(true);
  context.rowOffset = 600;
  await act(() => context.screen.rerender(<context.Harness activeKey="new-thread" />));
  expect(context.scrollIntoView).toHaveBeenCalledTimes(1);
});

it("waits for the active row to arrive after navigation", async () => {
  await using context = await setup();
  await act(() => context.screen.rerender(<context.Harness showRow={false} />));
  context.rowOffset = 300;
  await act(() => context.screen.rerender(<context.Harness />));
  expect(context.viewport().scrollTop).toBe(220);
});

it("reveals after a list remount, but not after an ordinary refresh or a focus scroll", async () => {
  await using context = await setup();
  await act(() => context.screen.rerender(<context.Harness />));
  context.rowOffset = 300;
  await act(() => context.screen.rerender(<context.Harness />));
  expect(context.scrollIntoView).not.toHaveBeenCalled();
  await act(() => context.screen.rerender(<context.Harness listKey="remounted" />));
  expect(context.viewport().scrollTop).toBe(220);
  // Tabbing to a control near the top scrolls the viewport without user scroll input.
  context.viewport().scrollTop = 0;
  await act(() => context.viewport().dispatchEvent(new Event("scroll")));
  expect(context.viewport().scrollTop).toBe(0);
  expect(context.scrollIntoView).toHaveBeenCalledTimes(1);
});

it("pulses a visible row on a filter switch and restarts the pulse on the reverse switch", async () => {
  await using context = await setup();
  await act(() => context.screen.rerender(<context.Harness />));
  await act(() => context.screen.rerender(<context.Harness onlyActionable />));
  await act(() => vi.advanceTimersByTime(32));
  expect(context.row().hasAttribute("data-workbench-sidebar-reveal")).toBe(true);
  await act(() => context.screen.rerender(<context.Harness />));
  expect(context.row().hasAttribute("data-workbench-sidebar-reveal")).toBe(false);
  await act(() => vi.advanceTimersByTime(32));
  expect(context.row().hasAttribute("data-workbench-sidebar-reveal")).toBe(true);
  expect(context.scrollIntoView).not.toHaveBeenCalled();
});

it("lets wheel input cancel a pending reveal, including when the row arrives later", async () => {
  await using context = await setup();
  await act(() => context.screen.rerender(<context.Harness />));
  await act(() => context.viewport().dispatchEvent(new Event("wheel")));
  context.rowOffset = 300;
  await act(() => context.screen.rerender(<context.Harness activeKey="thread" showRow={false} />));
  await act(() => vi.advanceTimersByTime(300));
  await act(() => context.screen.rerender(<context.Harness activeKey="thread" />));
  expect(context.scrollIntoView).not.toHaveBeenCalled();
  expect(context.viewport().scrollTop).toBe(0);
});

it.each(["touchmove", "keydown"])("does not reveal during %s scrolling", async (type) => {
  await using context = await setup();
  await context.screen.rerender(<context.Harness />);
  const event = type === "keydown" ? new KeyboardEvent(type, { key: "PageDown" }) : new Event(type);
  await act(() => context.viewport().dispatchEvent(event));
  context.rowOffset = 300;
  await context.screen.rerender(<context.Harness activeKey="thread" />);
  expect(context.scrollIntoView).not.toHaveBeenCalled();
});

it("uses instant scrolling and no pulse with reduced motion", async () => {
  await using context = await setup();
  context.reducedMotion = true;
  context.rowOffset = 300;
  await act(() => context.screen.rerender(<context.Harness />));
  await act(() => vi.advanceTimersByTime(32));
  expect(context.viewport().scrollTop).toBe(220);
  expect(context.scrollIntoView).toHaveBeenCalledWith(
    expect.objectContaining({ behavior: "instant" }),
  );
  expect(context.row().hasAttribute("data-workbench-sidebar-reveal")).toBe(false);
});

it("pulses a visible row reached from outside the sidebar, but not one picked in it", async () => {
  await using context = await setup();
  await act(() => context.screen.rerender(<context.Harness />));
  await act(() => vi.advanceTimersByTime(32));
  expect(context.row().hasAttribute("data-workbench-sidebar-reveal")).toBe(false);
  await act(() => context.screen.rerender(<context.Harness activeKey="created-thread" />));
  await act(() => vi.advanceTimersByTime(32));
  expect(context.row().hasAttribute("data-workbench-sidebar-reveal")).toBe(true);
  context.row().removeAttribute("data-workbench-sidebar-reveal");
  await act(() => context.row().dispatchEvent(new Event("pointerdown", { bubbles: true })));
  await act(() => context.screen.rerender(<context.Harness activeKey="clicked-thread" />));
  await act(() => vi.advanceTimersByTime(32));
  expect(context.row().hasAttribute("data-workbench-sidebar-reveal")).toBe(false);
  await act(() => context.screen.rerender(<context.Harness activeKey="elsewhere" />));
  context.row().removeAttribute("data-workbench-sidebar-reveal");
  await act(() => context.screen.rerender(<context.Harness activeKey="clicked-thread" />));
  await act(() => vi.advanceTimersByTime(32));
  expect(context.row().hasAttribute("data-workbench-sidebar-reveal")).toBe(true);
  // A click on the already-active row explains nothing after passing through no selection.
  context.row().removeAttribute("data-workbench-sidebar-reveal");
  await act(() => context.row().dispatchEvent(new Event("pointerdown", { bubbles: true })));
  await act(() => context.screen.rerender(<context.Harness activeKey={null} />));
  await act(() => context.screen.rerender(<context.Harness activeKey="clicked-thread" />));
  await act(() => vi.advanceTimersByTime(32));
  expect(context.row().hasAttribute("data-workbench-sidebar-reveal")).toBe(true);
  expect(context.scrollIntoView).not.toHaveBeenCalled();
});

it("pulses a new destination after the sidebar remounts, but not the same one", async () => {
  await using context = await setup();
  const remount = async (activeKey: string) => {
    await context.screen.rerender(null);
    await act(() =>
      context.screen.rerender(
        <StrictMode>
          <context.Harness activeKey={activeKey} />
        </StrictMode>,
      ),
    );
    await act(() => vi.advanceTimersByTime(32));
  };
  await remount("ticket");
  context.row().removeAttribute("data-workbench-sidebar-reveal");
  await remount("ticket");
  expect(context.row().hasAttribute("data-workbench-sidebar-reveal")).toBe(false);
  await remount("created-thread");
  expect(context.row().hasAttribute("data-workbench-sidebar-reveal")).toBe(true);
  expect(context.scrollIntoView).not.toHaveBeenCalled();
});

it("ignores an earlier click that changed nothing when a later navigation remounts the sidebar", async () => {
  await using context = await setup();
  using now = vi.spyOn(performance, "now").mockReturnValue(1_000);
  const remount = async (activeKey: string) => {
    await context.screen.rerender(null);
    await act(() => context.screen.rerender(<context.Harness activeKey={activeKey} />));
    await act(() => vi.advanceTimersByTime(32));
  };
  await act(() => context.screen.rerender(<context.Harness activeKey="current" />));
  await act(() => context.row().dispatchEvent(new Event("pointerdown", { bubbles: true })));
  now.mockReturnValue(5_000);
  await remount("previous");
  expect(context.row().hasAttribute("data-workbench-sidebar-reveal")).toBe(true);
});
