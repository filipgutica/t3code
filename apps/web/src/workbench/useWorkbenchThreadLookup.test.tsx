import { EnvironmentId } from "@t3tools/contracts";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

import { useArchivedThreadSnapshots } from "../lib/archivedThreadsState";
import { useWorkbenchOmittedThreads } from "./useWorkbenchOmittedThreads";
import { useWorkbenchThreadLookup } from "./useWorkbenchThreadLookup";

vi.mock("../state/entities", () => ({ useThreadShells: () => [] }));
vi.mock("../lib/archivedThreadsState", () => ({ useArchivedThreadSnapshots: vi.fn() }));
vi.mock("./useWorkbenchOmittedThreads", () => ({ useWorkbenchOmittedThreads: vi.fn() }));

it("waits for omitted Threads, reports failed reads, and retries them", async () => {
  const retry = vi.fn();
  const refreshArchivedThreads = vi.fn();
  vi.mocked(useArchivedThreadSnapshots).mockReturnValue({
    snapshots: [],
    error: null,
    isLoading: false,
    refresh: refreshArchivedThreads,
  });
  vi.mocked(useWorkbenchOmittedThreads).mockReturnValue({ status: "pending", retry });
  const observe = vi.fn<(lookup: ReturnType<typeof useWorkbenchThreadLookup>) => void>();
  function Harness() {
    observe(
      useWorkbenchThreadLookup({
        environmentId: EnvironmentId.make("lookup-environment"),
        snapshot: null,
      }),
    );
    return null;
  }

  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(<Harness />);
    });
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadLookupReady: false, threadLookupError: null }),
    );

    vi.mocked(useWorkbenchOmittedThreads).mockReturnValue({ status: "failed", retry });
    await act(() => renderer?.update(<Harness />));
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({
        threadLookupReady: false,
        threadLookupError: "Could not load some older settled Threads.",
      }),
    );
    observe.mock.lastCall?.[0].refreshThreadLookup();
    expect(retry).toHaveBeenCalledOnce();
    expect(refreshArchivedThreads).toHaveBeenCalledOnce();

    vi.mocked(useWorkbenchOmittedThreads).mockReturnValue({ status: "ready", retry });
    await act(() => renderer?.update(<Harness />));
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadLookupReady: true, threadLookupError: null }),
    );
  } finally {
    await act(() => renderer?.unmount());
  }
});
