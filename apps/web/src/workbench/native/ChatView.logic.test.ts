import { pullRequestSurface, type RightPanelSurface } from "../../rightPanelStore";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { describe, expect, it } from "vite-plus/test";

import {
  shouldRetargetThreadPullRequestPanel,
  resolvePullRequestPanelEnvironment,
} from "../../components/ChatView.logic";

describe("proactive panels", () => {
  it("uses the selected PR environment beside a Thread, even when project identities collide", () => {
    const local = EnvironmentId.make("local");
    const reference = { projectId: "same-project", repository: "acme/repo", number: 42 };
    expect(
      resolvePullRequestPanelEnvironment(
        local,
        pullRequestSurface({ ...reference, environmentId: "remote" }),
      ),
    ).toEqual({ environmentId: EnvironmentId.make("remote"), isThreadEnvironment: false });
    expect(resolvePullRequestPanelEnvironment(local, pullRequestSurface(reference))).toEqual({
      environmentId: local,
      isThreadEnvironment: true,
    });
  });

  it("retargets a changed PR link only in the Thread's environment", () => {
    const previous = {
      projectId: ProjectId.make("project-1"),
      repository: "pingdotgg/t3code",
      number: 42,
      url: "https://github.com/pingdotgg/t3code/pull/42",
    };
    const current = {
      ...previous,
      number: 43,
      url: "https://github.com/pingdotgg/t3code/pull/43",
    };
    const surface = {
      id: "pull-request:previous",
      kind: "pull-request",
      projectId: previous.projectId,
      repository: "PingDotGG/T3Code",
      number: previous.number,
    } satisfies RightPanelSurface;

    const threadEnvironmentId = EnvironmentId.make("local");
    const retarget = (next: typeof current | null, selected: RightPanelSurface = surface) =>
      shouldRetargetThreadPullRequestPanel({
        previous,
        current: next,
        surface: selected,
        threadEnvironmentId,
      });
    expect(retarget(current, { ...surface, environmentId: "local" })).toBe(true);
    expect(retarget(current, { ...surface, environmentId: "remote" })).toBe(false);
  });
});
