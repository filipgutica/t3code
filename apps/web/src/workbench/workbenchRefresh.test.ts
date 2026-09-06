import { describe, expect, it, vi } from "@effect/vitest";

import { subscribeToWorkbenchRefresh, type WorkbenchRefreshTarget } from "./workbenchRefresh";

describe("Workbench refresh subscription", () => {
  it("refreshes on the interval and when the window regains focus", () => {
    vi.useFakeTimers();
    try {
      const focusHandlers = new Set<() => void>();
      const onlineHandlers = new Set<() => void>();
      const visibilityHandlers = new Set<() => void>();
      const document = {
        visibilityState: "visible" as DocumentVisibilityState,
        addEventListener: (_type: "visibilitychange", handler: () => void) => {
          visibilityHandlers.add(handler);
        },
        removeEventListener: (_type: "visibilitychange", handler: () => void) => {
          visibilityHandlers.delete(handler);
        },
      };
      const target: WorkbenchRefreshTarget = {
        setInterval,
        clearInterval,
        document,
        navigator: { onLine: true },
        addEventListener: (_type, handler) => {
          if (_type === "focus") focusHandlers.add(handler);
          else onlineHandlers.add(handler);
        },
        removeEventListener: (_type, handler) => {
          if (_type === "focus") focusHandlers.delete(handler);
          else onlineHandlers.delete(handler);
        },
      };
      const refresh = vi.fn();

      const unsubscribe = subscribeToWorkbenchRefresh({
        target,
        refresh,
        intervalMs: 15_000,
      });
      vi.advanceTimersByTime(15_000);
      expect(refresh).toHaveBeenCalledTimes(1);

      for (const handler of focusHandlers) handler();
      expect(refresh).toHaveBeenCalledTimes(2);

      unsubscribe();
      vi.advanceTimersByTime(15_000);
      for (const handler of focusHandlers) handler();
      for (const handler of onlineHandlers) handler();
      for (const handler of visibilityHandlers) handler();
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips refresh while hidden or offline and catches up when visible and online", () => {
    vi.useFakeTimers();
    try {
      const focusHandlers = new Set<() => void>();
      const onlineHandlers = new Set<() => void>();
      const visibilityHandlers = new Set<() => void>();
      const document = {
        visibilityState: "visible" as DocumentVisibilityState,
        addEventListener: (_type: "visibilitychange", handler: () => void) => {
          visibilityHandlers.add(handler);
        },
        removeEventListener: (_type: "visibilitychange", handler: () => void) => {
          visibilityHandlers.delete(handler);
        },
      };
      const navigator = { onLine: true };
      const target: WorkbenchRefreshTarget = {
        setInterval,
        clearInterval,
        document,
        navigator,
        addEventListener: (type, handler) => {
          if (type === "focus") focusHandlers.add(handler);
          else onlineHandlers.add(handler);
        },
        removeEventListener: (type, handler) => {
          if (type === "focus") focusHandlers.delete(handler);
          else onlineHandlers.delete(handler);
        },
      };
      const refresh = vi.fn();
      const unsubscribe = subscribeToWorkbenchRefresh({
        target,
        refresh,
        intervalMs: 15_000,
      });

      document.visibilityState = "hidden";
      vi.advanceTimersByTime(15_000);
      for (const handler of focusHandlers) handler();
      expect(refresh).not.toHaveBeenCalled();

      document.visibilityState = "visible";
      for (const handler of visibilityHandlers) handler();
      expect(refresh).toHaveBeenCalledTimes(1);

      navigator.onLine = false;
      vi.advanceTimersByTime(15_000);
      expect(refresh).toHaveBeenCalledTimes(1);

      navigator.onLine = true;
      for (const handler of onlineHandlers) handler();
      expect(refresh).toHaveBeenCalledTimes(2);

      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });
});
