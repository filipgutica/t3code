import { useLayoutEffect, useRef, type RefObject } from "react";
import { useStableCallback } from "../hooks/useStableCallback";
import {
  getWorkbenchSidebarRevealDecision,
  getWorkbenchSidebarRevealReason,
  type WorkbenchSidebarRevealSnapshot,
  type WorkbenchSidebarRevealReason,
} from "./workbenchSidebarReveal.logic";

const scrollQuietMs = 250;
// Navigation follows a click within a frame or two; older input caused no destination change.
const inputAttributionMs = 1000;
const activeRowSelector = '[data-workbench-sidebar-surface][data-active="true"]';

/**
 * Route changes between Workbench pages and Threads remount the sidebar, so the destination
 * and the sidebar input that explains a change must outlive a single hook instance.
 */
const revealMemory: {
  activeKey: string | null | undefined;
  input: { surface: Element | null; at: number } | null;
  selectedSurface: Element | null;
} = { activeKey: undefined, input: null, selectedSurface: null };

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

  const pulse = (row: HTMLElement) => {
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
  };

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
    rememberDestination(activeKey);
    if (!activeKey || isSearching || userScrolling) {
      pending.current = null;
      revealMemory.selectedSurface = null;
      return;
    }
    if (!pending.current) return;
    const row = navigation?.querySelector<HTMLElement>(activeRowSelector);
    // Wait for the selected Thread's Assignment and disclosure to reach the list.
    if (!row || row.getClientRects().length === 0 || viewport.clientHeight === 0) return;
    const decision = getWorkbenchSidebarRevealDecision({
      reason: pending.current,
      fullyVisible: isFullyVisible(row, viewport),
      selectedInSidebar: isSelectedInSidebar(row),
    });
    pending.current = null;
    revealMemory.selectedSurface = null;
    const scrollTop = viewport.scrollTop;
    if (decision.scroll) {
      // Instant scrolling also avoids an animation competing with subsequent user input.
      // Centering keeps the rows around a revealed destination in view.
      row.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    }
    if (decision.pulse || viewport.scrollTop !== scrollTop) pulse(row);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns sidebar scroll/input/animation DOM listeners and releases them when the viewport unmounts
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
      revealMemory.input = {
        surface:
          event.target instanceof Element
            ? event.target.closest("[data-workbench-sidebar-surface]")
            : null,
        at: performance.now(),
      };
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the committed active sidebar row and scrolls/pulses its DOM only when navigation requires a reveal
  useLayoutEffect(() => check());
  return contentRef;
}

/** A remount replaces the row element, so a disconnected input surface still names this row. */
function isSelectedInSidebar(row: HTMLElement) {
  const surface = revealMemory.selectedSurface;
  return (
    (surface !== null && (surface === row || !surface.isConnected)) ||
    row.contains(document.activeElement)
  );
}

/** Input explains only the destination change that follows it, not a later one. */
function rememberDestination(activeKey: string | null) {
  if (revealMemory.activeKey !== undefined && revealMemory.activeKey !== activeKey) {
    const input = revealMemory.input;
    revealMemory.selectedSurface =
      input && performance.now() - input.at < inputAttributionMs ? input.surface : null;
    revealMemory.input = null;
  }
  revealMemory.activeKey = activeKey;
}

function isFullyVisible(row: HTMLElement, viewport: HTMLElement) {
  const bounds = row.getBoundingClientRect();
  const top = viewport.getBoundingClientRect().top + viewport.clientTop;
  return bounds.top >= top && bounds.bottom <= top + viewport.clientHeight;
}
