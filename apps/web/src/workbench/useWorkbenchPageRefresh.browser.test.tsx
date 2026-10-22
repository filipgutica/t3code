import { AsyncResult } from "effect/reactivity";
import { createElement } from "react";
import { act, render, fakeTimers } from "../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";
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
function setup() {
  const resources = new AsyncDisposableStack();
  resources.use(fakeTimers());
  vi.clearAllMocks();
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
  return {
    refreshJiraSnapshot,
    jiraSyncBinding,
    options,
    Consumer,
    resources,
    [Symbol.asyncDispose]: () => resources.disposeAsync(),
  };
}
describe("Workbench page Jira refresh", () => {
  it("observes another client's completed migration while automatic sync is suppressed", async () => {
    await using fixture = setup();
    const props = fixture.options();
    // The hook uses the browser's window directly; isolate its polling timer from router timers.
    const screen = fixture.resources.use(
      await render(createElement(fixture.Consumer, props), { router: false }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(fixture.refreshJiraSnapshot).toHaveBeenCalledTimes(1);
    expect(fixture.jiraSyncBinding).not.toHaveBeenCalled();
    // The refreshed Jira query reports the migration completed by another client.
    fixture.jiraSyncBinding.mockReturnValue(new Promise(() => {}));
    await screen.rerender(
      createElement(fixture.Consumer, {
        ...props,
        jiraBinding: { ...binding, localMigrationPending: false },
      }),
    );
    expect(fixture.jiraSyncBinding).toHaveBeenCalledTimes(1);
  });
  it("skips snapshot polls only while a sync is running, then resumes them", async () => {
    await using fixture = setup();
    let finish!: (value: Awaited<ReturnType<Options["jiraSyncBinding"]>>) => void;
    fixture.jiraSyncBinding.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const props = { ...fixture.options(), hasLocalMigrationData: false };
    // The hook uses the browser's window directly; isolate its polling timer from router timers.
    const screen = fixture.resources.use(
      await render(createElement(fixture.Consumer, props), { router: false }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(fixture.refreshJiraSnapshot).not.toHaveBeenCalled();
    expect(fixture.jiraSyncBinding).toHaveBeenCalledTimes(1);
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
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(fixture.refreshJiraSnapshot).toHaveBeenCalledTimes(1);
    await screen.rerender(
      createElement(fixture.Consumer, {
        ...props,
        jiraDialogOpen: true,
        jiraPendingAction: "sync",
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(fixture.refreshJiraSnapshot).toHaveBeenCalledTimes(1);
    await screen.rerender(
      createElement(fixture.Consumer, {
        ...props,
        jiraDialogOpen: true,
        jiraPendingAction: null,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(fixture.refreshJiraSnapshot).toHaveBeenCalledTimes(2);
  });
});
