import { EnvironmentId } from "@t3tools/contracts";
import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const observed = vi.hoisted(() => ({ projects: [] as unknown[], onValue: vi.fn() }));
vi.mock("~/state/entities", () => ({
  useProjects: () => observed.projects,
  useServerConfigs: () =>
    new Map([["local", { environment: { capabilities: { threadPullRequests: true } } }]]),
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("~/state/threads", () => ({ threadEnvironment: {} }));

import { usePullRequestLinking } from "./usePullRequestLinking";

const environmentId = EnvironmentId.make("local");
let renderer: ReactTestRenderer;
function Probe() {
  const { canLinkAny } = usePullRequestLinking(environmentId);
  useEffect(() => observed.onValue(canLinkAny), [canLinkAny]);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  observed.projects = [];
  observed.onValue.mockClear();
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("offers Ticket PR linking only when the environment has a linkable Git host", () => {
  observed.projects = [{ environmentId, repositoryIdentity: null }];
  act(() => {
    renderer = create(<Probe />);
  });
  expect(observed.onValue).toHaveBeenLastCalledWith(false);

  observed.projects = [
    {
      environmentId,
      repositoryIdentity: {
        canonicalKey: "github.com/acme/web",
        displayName: "acme/web",
        provider: "github",
        locator: { remoteUrl: "https://github.com/acme/web.git" },
      },
    },
  ];
  act(() => renderer.update(<Probe />));
  expect(observed.onValue).toHaveBeenLastCalledWith(true);

  observed.projects = [
    {
      environmentId,
      repositoryIdentity: {
        canonicalKey: "code.example.test/group/project",
        displayName: "group/project",
        provider: "unknown",
        locator: { remoteUrl: "https://code.example.test/group/project.git" },
      },
    },
  ];
  act(() => renderer.update(<Probe />));
  expect(observed.onValue).toHaveBeenLastCalledWith(true);
});
