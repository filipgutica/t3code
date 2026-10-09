import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { ThreadExecutionStatus } from "./ThreadExecutionStatus";
import { resolveThreadExecutionStatusPresentation } from "./ThreadExecutionStatus.logic";

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T12:00:02.000Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { setInterval, clearInterval });
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("ticks only the hidden duration, preserves the live label and stops when work ends", async () => {
  let parentRenders = 0;
  const startedAt = "2026-10-09T12:00:00.000Z";
  function Row({ working }: { working: boolean }) {
    useEffect(() => {
      parentRenders += 1;
    });
    return (
      <ThreadExecutionStatus
        status={resolveThreadExecutionStatusPresentation({ kind: working ? "working" : "waiting" })}
        startedAt={startedAt}
      />
    );
  }
  await act(() => {
    renderer = create(<Row working />);
  });
  const duration = () => renderer!.root.findByProps({ className: "tabular-nums" });
  expect(duration().children).toEqual(["2s"]);
  expect(duration().props["aria-hidden"]).toBe(true);
  await act(() => vi.advanceTimersByTime(2_000));
  expect(duration().children).toEqual(["4s"]);
  expect(parentRenders).toBe(1);
  expect(renderer!.root.findByProps({ role: "status" }).children).toEqual(["Working"]);
  await act(() => renderer!.update(<Row working={false} />));
  expect(renderer!.root.findByProps({ role: "status" }).children).toEqual(["Waiting"]);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not start a clock for an unknown start and clears the clock on unmount", async () => {
  const status = resolveThreadExecutionStatusPresentation({ kind: "working", goalActive: true });
  await act(() => {
    renderer = create(<ThreadExecutionStatus status={status} startedAt="invalid" />);
  });
  expect(vi.getTimerCount()).toBe(0);
  expect(renderer!.root.findByProps({ role: "status" }).children).toEqual(["Goal"]);
  await act(() => vi.advanceTimersByTime(4_000));
  await act(() =>
    renderer!.update(
      <ThreadExecutionStatus status={status} startedAt="2026-10-09T12:00:00.000Z" />,
    ),
  );
  expect(vi.getTimerCount()).toBe(1);
  expect(renderer!.root.findByProps({ className: "tabular-nums" }).children).toEqual(["6s"]);
  await act(() => renderer!.unmount());
  expect(vi.getTimerCount()).toBe(0);
  renderer = undefined;
});
