import { AsyncResult } from "effect/reactivity";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  WorkbenchJiraBindingId,
  WorkbenchJiraConnectionId,
  WorkbenchProjectId,
  type WorkbenchJiraBinding,
} from "@t3tools/contracts";
import { useWorkbenchPageRefresh } from "./useWorkbenchPageRefresh";

const environmentId = EnvironmentId.make("refresh-host");
const binding: WorkbenchJiraBinding = {
  id: WorkbenchJiraBindingId.make("binding"),
  projectId: WorkbenchProjectId.make("workspace"),
  connectionId: WorkbenchJiraConnectionId.make("connection"),
  jiraProjectId: "10000",
  jiraProjectKey: "WB",
  jiraProjectName: "Workbench",
  boardId: 42,
  boardName: "Board",
  sprintId: 7,
  sprintName: "Sprint",
  defaultPrimaryT3ProjectId: ProjectId.make("repository"),
  defaultRepositoryProjectIds: [],
  statusMappings: [],
  selectedSprints: [],
  observedActiveSprintIds: [],
  boardColumns: [],
  followActiveSprint: false,
  boardMode: "mapped",
  active: true,
  localMigrationPending: true,
  lastSyncedAt: null,
  lastSyncError: null,
  createdAt: "2026-10-17T00:00:00.000Z",
  updatedAt: "2026-10-17T00:00:00.000Z",
};
type Options = Parameters<typeof useWorkbenchPageRefresh>[0];
let renderer: ReactTestRenderer | undefined;
const refreshJiraSnapshot = vi.fn();
const jiraSyncBinding = vi.fn<Options["jiraSyncBinding"]>();
const options = (): Options => ({
  environmentId,
  jiraBinding: binding,
  jiraDialogOpen: false,
  jiraPendingAction: null,
  jiraSyncBinding,
  pendingJiraMigrationBindingsRef: { current: new Map() },
  hasLocalMigrationData: true,
  refreshJiraSnapshot,
  refreshWorkbenchSnapshot: vi.fn(),
  setJiraError: vi.fn(),
});
function Consumer(props: Options) {
  useWorkbenchPageRefresh(props);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("window", {
    setInterval,
    clearInterval,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Workbench page Jira refresh", () => {
  it("observes another client's completed migration while automatic sync is suppressed", async () => {
    const props = options();
    await act(async () => {
      renderer = create(createElement(Consumer, props));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(refreshJiraSnapshot).toHaveBeenCalledTimes(1);
    expect(jiraSyncBinding).not.toHaveBeenCalled();

    // The refreshed Jira query reports the migration completed by another client.
    jiraSyncBinding.mockReturnValue(new Promise(() => {}));
    await act(async () =>
      renderer?.update(
        createElement(Consumer, {
          ...props,
          jiraBinding: { ...binding, localMigrationPending: false },
        }),
      ),
    );
    expect(jiraSyncBinding).toHaveBeenCalledTimes(1);
  });

  it("skips snapshot polls only while a sync is running, then resumes them", async () => {
    let finish!: (value: Awaited<ReturnType<Options["jiraSyncBinding"]>>) => void;
    jiraSyncBinding.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const props = { ...options(), hasLocalMigrationData: false };
    await act(async () => {
      renderer = create(createElement(Consumer, props));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(refreshJiraSnapshot).not.toHaveBeenCalled();
    expect(jiraSyncBinding).toHaveBeenCalledTimes(1);
    await act(async () =>
      finish(
        AsyncResult.success({
          bindingId: binding.id,
          syncedAt: binding.updatedAt,
          activated: 0,
          updated: 0,
          deactivated: 0,
          links: [],
        }),
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(refreshJiraSnapshot).toHaveBeenCalledTimes(1);

    await act(async () =>
      renderer?.update(
        createElement(Consumer, {
          ...props,
          jiraDialogOpen: true,
          jiraPendingAction: "sync",
        }),
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(refreshJiraSnapshot).toHaveBeenCalledTimes(1);
    await act(async () =>
      renderer?.update(
        createElement(Consumer, {
          ...props,
          jiraDialogOpen: true,
          jiraPendingAction: null,
        }),
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(refreshJiraSnapshot).toHaveBeenCalledTimes(2);
  });
});
