import { EnvironmentId } from "@t3tools/contracts";
import { useEffect } from "react";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";

const observed = vi.hoisted(() => ({ projects: [] as unknown[], onValue: vi.fn() }));
vi.mock("~/state/entities", () => ({
  useProjects: () => observed.projects,
  useServerConfigs: () =>
    new Map([["local", { environment: { capabilities: { threadPullRequests: true } } }]]),
  readProjects: () => observed.projects,
  readEnvironmentSupportsServerBrowser: () => false,
  useEnvironmentSupportsServerBrowser: () => false,
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("~/state/threads", () => ({ threadEnvironment: {} }));

import { usePullRequestLinking } from "./usePullRequestLinking";

const environmentId = EnvironmentId.make("local");
function Probe() {
  const { canLinkAny } = usePullRequestLinking(environmentId);
  useEffect(() => observed.onValue(canLinkAny), [canLinkAny]);
  return null;
}

it("offers Ticket PR linking only when the environment has a linkable Git host", async () => {
  observed.onValue.mockClear();
  observed.projects = [{ environmentId, repositoryIdentity: null }];
  await using screen = await render(<Probe />, { router: false });
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
  await screen.rerender(<Probe />);
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
  await screen.rerender(<Probe />);
  expect(observed.onValue).toHaveBeenLastCalledWith(true);
});

vi.mock("~/state/server", async (original) => {
  const actual = await original<typeof import("~/state/server")>();
  const { Atom } = await import("effect/reactivity");
  return {
    ...actual,
    environmentServerConfigsAtom: Atom.make(
      new Map(
        ["local", "remote"].map((id) => [
          EnvironmentId.make(id),
          { environment: { capabilities: { pullRequests: true, threadPullRequests: true } } },
        ]),
      ),
    ),
  };
});
