import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useClosedViewStore } from "../../closedViewStore";
import {
  pullRequestSurface,
  selectActiveRightPanelSurface,
  useRightPanelStore,
} from "../../rightPanelStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));

beforeEach(() => {
  useClosedViewStore.setState({ entries: [] });
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    userActionRevisionByThreadKey: {},
    closeRevisionByThreadKey: {},
  });
});

describe("rightPanelStore", () => {
  const linkedPullRequest = pullRequestSurface({
    projectId: "project-a",
    repository: "pingdotgg/t3code",
    number: 42,
  });

  it.each([
    { name: "pull request", surface: linkedPullRequest },
    { name: "pull request list", surface: { id: "pull-requests", kind: "pull-requests" } as const },
  ])("keeps a foreign pull request active across later local $name updates", ({ surface }) => {
    const store = useRightPanelStore.getState();
    store.openPullRequest(refA, {
      environmentId: "env-2",
      projectId: "project-a",
      repository: "pingdotgg/t3code",
      number: 41,
    });
    const foreignSurface = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      refA,
    );
    const nextTurnRevision = store.getUserActionRevision(refA);

    expect(store.openProactive(refA, surface, nextTurnRevision)).toBe(false);
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toBe(
      foreignSurface,
    );
  });
});
