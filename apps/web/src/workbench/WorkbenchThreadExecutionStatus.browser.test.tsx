import { act, render, fakeTimers } from "../../test/render";
import { useEffect } from "react";
import { expect, it, vi } from "vite-plus/test";
import { WorkbenchThreadExecutionStatus } from "./WorkbenchThreadExecutionStatus";
import { resolveWorkbenchThreadExecutionStatusPresentation } from "./WorkbenchThreadExecutionStatus.logic";
it("ticks only the hidden duration, preserves the live label and stops when work pauses", async () => {
  using _timers = fakeTimers();
  vi.setSystemTime(new Date("2026-10-09T12:00:02.000Z"));
  let parentRenders = 0;
  const startedAt = "2026-10-09T12:00:00.000Z";
  function Row({ kind }: { kind: "working" | "waiting" }) {
    useEffect(() => {
      parentRenders += 1;
    });
    return (
      <WorkbenchThreadExecutionStatus
        status={resolveWorkbenchThreadExecutionStatusPresentation({ kind })}
        startedAt={startedAt}
      />
    );
  }
  // This standalone clock has no navigation; router timers would obscure its cleanup contract.
  await using screen = await render(<Row kind="working" />, { router: false });
  const duration = () => screen.container.querySelector(".tabular-nums")!;
  expect(duration().textContent).toBe("2s");
  expect(duration().getAttribute("aria-hidden")).toBe("true");
  await act(() => vi.advanceTimersByTime(2000));
  expect(duration().textContent).toBe("4s");
  expect(parentRenders).toBe(1);
  await expect.element(screen.getByRole("status")).toHaveTextContent("Working");
  await screen.rerender(<Row kind="waiting" />);
  await expect.element(screen.getByRole("status")).toHaveTextContent("Waiting");
  expect(vi.getTimerCount()).toBe(0);
});
it("does not start a clock for an unknown start and clears the clock on unmount", async () => {
  using _timers = fakeTimers();
  vi.setSystemTime(new Date("2026-10-09T12:00:02.000Z"));
  const status = resolveWorkbenchThreadExecutionStatusPresentation({
    kind: "working",
    goalActive: true,
  });
  // This standalone clock has no navigation; router timers would obscure its cleanup contract.
  await using screen = await render(
    <WorkbenchThreadExecutionStatus status={status} startedAt="invalid" />,
    { router: false },
  );
  expect(vi.getTimerCount()).toBe(0);
  await expect.element(screen.getByRole("status")).toHaveTextContent("Goal");
  await act(() => vi.advanceTimersByTime(4000));
  await screen.rerender(
    <WorkbenchThreadExecutionStatus status={status} startedAt="2026-10-09T12:00:00.000Z" />,
  );
  expect(vi.getTimerCount()).toBe(1);
  expect(screen.container.querySelector(".tabular-nums")?.textContent).toBe("6s");
  await screen.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
