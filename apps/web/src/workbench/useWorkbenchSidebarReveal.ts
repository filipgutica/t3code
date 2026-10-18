import { useLayoutEffect, useRef, type RefObject } from "react";
import { useStableCallback } from "../hooks/useStableCallback";
import {
  getWorkbenchSidebarRevealDecision,
  getWorkbenchSidebarRevealReason,
  type WorkbenchSidebarRevealSnapshot,
  type WorkbenchSidebarRevealReason,
} from "./workbenchSidebarReveal.logic";

const scrollQuietMs = 250;
const activeRowSelector = '[data-workbench-sidebar-surface][data-active="true"]';

/**
 * Route changes between Workbench pages and Threads remount the sidebar, so the destination
 * and the surface that last received input must outlive a single hook instance.
 */
const revealMemory: { activeKey: string | null | undefined; inputSurface: Element | null } = {
  activeKey: undefined,
  inputSurface: null,
};

export function useWorkbenchSidebarReveal({
  navigationRef,
  activeKey,
  onlyActionable,
  isSearching,
}: {
  navigationRef: RefObject<HTMLElement | null>;
  activeKey: string | null;
  onlyActionable: boolean;
  isSearching: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const previous = useRef<WorkbenchSidebarRevealSnapshot | null>(null);
  const pending = useRef<WorkbenchSidebarRevealReason>(null);
  const lastScrollInput = useRef(-Infinity);
  const pulsingRow = useRef<HTMLElement | null>(null);
  const pulseFrame = useRef<number | null>(null);

  const check = useStableCallback(() => {
    const viewport = contentRef.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport) return;
    const navigation = navigationRef.current;
    const userScrolling = performance.now() - lastScrollInput.current < scrollQuietMs;
    const next = {
      activeKey,
      onlyActionable,
      isSearching,
      navigation,
    };
    const remembered =
      revealMemory.activeKey === undefined
        ? null
        : { ...next, activeKey: revealMemory.activeKey, navigation: null };
    pending.current =
      getWorkbenchSidebarRevealReason({ previous: previous.current ?? remembered, next }) ??
      pending.current;
    previous.current = next;
    revealMemory.activeKey = activeKey;
    if (!activeKey || isSearching || userScrolling) {
      pending.current = null;
      revealMemory.inputSurface = null;
      return;
    }
    if (!pending.current) return;
    const row = navigation?.querySelector<HTMLElement>(activeRowSelector);
    // Wait for the selected Thread's Assignment and disclosure to reach the list.
    if (!row || row.getClientRects().length === 0 || viewport.clientHeight === 0) return;
    const bounds = row.getBoundingClientRect();
    const viewportBounds = viewport.getBoundingClientRect();
    const top = viewportBounds.top + viewport.clientTop;
    const decision = getWorkbenchSidebarRevealDecision({
      reason: pending.current,
      fullyVisible: bounds.top >= top && bounds.bottom <= top + viewport.clientHeight,
      userScrolling,
      selectedInSidebar: isSelectedInSidebar(row),
    });
    pending.current = null;
    // Input only explains the destination change it caused.
    revealMemory.inputSurface = null;
    const scrollTop = viewport.scrollTop;
    if (decision.scroll) {
      // Instant scrolling also avoids an animation competing with subsequent user input.
      // Centering keeps the rows around a revealed destination in view.
      row.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    }
    if (!decision.pulse && viewport.scrollTop === scrollTop) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (pulseFrame.current !== null) cancelAnimationFrame(pulseFrame.current);
    pulsingRow.current?.removeAttribute("data-workbench-sidebar-reveal");
    // Separate the removal and addition so a second reveal restarts the finite animation.
    pulseFrame.current = requestAnimationFrame(() => {
      pulseFrame.current = requestAnimationFrame(() => {
        pulseFrame.current = null;
        // A new Thread's row is re-rendered as its data settles; pulse the row now on screen.
        const target = row.isConnected
          ? row
          : navigationRef.current?.querySelector<HTMLElement>(activeRowSelector);
        if (!target) return;
        pulsingRow.current = target;
        target.setAttribute("data-workbench-sidebar-reveal", "");
      });
    });
  });

  useLayoutEffect(() => {
    const viewport = contentRef.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport) return;
    const onInput = () => {
      lastScrollInput.current = performance.now();
      pending.current = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
        onInput();
      }
    };
    const onDocumentInput = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
      revealMemory.inputSurface =
        event.target instanceof Element
          ? event.target.closest("[data-workbench-sidebar-surface]")
          : null;
    };
    const onScroll = () => {
      if (performance.now() - lastScrollInput.current < scrollQuietMs) onInput();
      check();
    };
    const onAnimationEnd = (event: AnimationEvent) => {
      if (
        event.animationName === "workbench-sidebar-reveal" &&
        event.target === pulsingRow.current
      ) {
        pulsingRow.current?.removeAttribute("data-workbench-sidebar-reveal");
        pulsingRow.current = null;
      }
    };
    document.addEventListener("pointerdown", onDocumentInput, { capture: true, passive: true });
    document.addEventListener("keydown", onDocumentInput, { capture: true });
    viewport.addEventListener("wheel", onInput, { passive: true });
    viewport.addEventListener("touchmove", onInput, { passive: true });
    viewport.addEventListener("keydown", onKeyDown);
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("animationend", onAnimationEnd);
    return () => {
      document.removeEventListener("pointerdown", onDocumentInput, { capture: true });
      document.removeEventListener("keydown", onDocumentInput, { capture: true });
      viewport.removeEventListener("wheel", onInput);
      viewport.removeEventListener("touchmove", onInput);
      viewport.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("animationend", onAnimationEnd);
      // A scheduled pulse survives a remount; its frame callback finds the row on screen.
      pulsingRow.current?.removeAttribute("data-workbench-sidebar-reveal");
    };
  }, [check]);
  useLayoutEffect(() => check());
  return contentRef;
}

/** A remount replaces the row element, so a disconnected input surface still names this row. */
function isSelectedInSidebar(row: HTMLElement) {
  const surface = revealMemory.inputSurface;
  return (
    (surface !== null && (surface === row || !surface.isConnected)) ||
    row.contains(document.activeElement)
  );
}
