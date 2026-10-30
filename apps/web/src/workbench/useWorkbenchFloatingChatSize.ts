import * as Schema from "effect/Schema";
import { type PointerEvent, useEffect, useRef, useState } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";

const STORAGE_KEY = "t3code:workbench-floating-chat-size";
const SizeSchema = Schema.Struct({
  width: Schema.Finite,
  /** Null until the user drags the top edge; the panel then uses its default height. */
  height: Schema.NullOr(Schema.Finite),
});
type Size = typeof SizeSchema.Type;

const DEFAULT_SIZE: Size = { width: 576, height: null };
const MIN_WIDTH = 360;
const MIN_HEIGHT = 280;
// The panel sits 1rem inside the ticket on each side.
const CONTAINER_INSET = 32;

export type WorkbenchFloatingChatResizeEdge = "left" | "top" | "top-left";

const CURSORS: Record<WorkbenchFloatingChatResizeEdge, string> = {
  left: "ew-resize",
  top: "ns-resize",
  "top-left": "nwse-resize",
};

const readSize = (): Size => {
  try {
    return getLocalStorageItem(STORAGE_KEY, SizeSchema) ?? DEFAULT_SIZE;
  } catch {
    return DEFAULT_SIZE;
  }
};

/** The panel's height as last saved; the CSS default, min(540px, 70vh), until the user drags it. */
export const readWorkbenchFloatingChatHeight = () =>
  readSize().height ?? Math.min(540, window.innerHeight * 0.7);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const endDragStyles = () => {
  document.body.style.removeProperty("cursor");
  document.body.style.removeProperty("user-select");
};

/**
 * The panel is anchored bottom-right, so dragging its left edge sets the width, its top
 * edge the height, and its top-left corner both. The size persists when a drag ends.
 */
export function useWorkbenchFloatingChatSize() {
  const [size, setSize] = useState(readSize);
  const drag = useRef<{
    edge: WorkbenchFloatingChatResizeEdge;
    pointerId: number;
    startX: number;
    startY: number;
    start: { width: number; height: number };
    max: { width: number; height: number };
    next: Size;
    frame: number | null;
  } | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels the drag animation frame and releases document cursor/selection styles if the chat unmounts during resizing
  useEffect(
    () => () => {
      const active = drag.current;
      if (active?.frame != null) cancelAnimationFrame(active.frame);
      if (active) endDragStyles();
    },
    [],
  );

  const finish = (pointerId: number) => {
    const active = drag.current;
    if (!active || active.pointerId !== pointerId) return;
    drag.current = null;
    if (active.frame !== null) cancelAnimationFrame(active.frame);
    endDragStyles();
    setSize(active.next);
    try {
      setLocalStorageItem(STORAGE_KEY, active.next, SizeSchema);
    } catch (error) {
      console.error("Could not persist the ticket chat size.", error);
    }
  };

  const handlers = (edge: WorkbenchFloatingChatResizeEdge) => ({
    onPointerDown(event: PointerEvent<HTMLElement>) {
      const panel = event.currentTarget.parentElement;
      const container = panel?.parentElement;
      if (event.button !== 0 || drag.current || !panel || !container) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}
      const rect = panel.getBoundingClientRect();
      drag.current = {
        edge,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        start: { width: rect.width, height: rect.height },
        max: {
          width: Math.max(MIN_WIDTH, container.clientWidth - CONTAINER_INSET),
          height: Math.max(MIN_HEIGHT, container.clientHeight - CONTAINER_INSET),
        },
        next: size,
        frame: null,
      };
      document.body.style.cursor = CURSORS[edge];
      document.body.style.userSelect = "none";
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      const { start, max } = active;
      active.next = {
        width:
          active.edge === "top"
            ? size.width
            : clamp(start.width + active.startX - event.clientX, MIN_WIDTH, max.width),
        height:
          active.edge === "left"
            ? size.height
            : clamp(start.height + active.startY - event.clientY, MIN_HEIGHT, max.height),
      };
      // One render per frame keeps the drag smooth; the chat inside does not rerender.
      if (active.frame == null) {
        active.frame = requestAnimationFrame(() => {
          active.frame = null;
          setSize(active.next);
        });
      }
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event.pointerId),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event.pointerId),
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => finish(event.pointerId),
  });

  return { size, handlers };
}
