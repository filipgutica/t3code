import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { WorkbenchPullRequestLink } from "./WorkbenchPullRequestLink";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("../state/entities", () => ({
  useProjects: () => [
    {
      id: ProjectId.make("other-repo"),
      environmentId: EnvironmentId.make("remote"),
      repositoryIdentity: {
        provider: "github",
        canonicalKey: "github.com/acme/repo",
        displayName: "acme/repo",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/acme/repo.git",
        },
      },
    },
    {
      id: ProjectId.make("repo"),
      environmentId: EnvironmentId.make("local"),
      repositoryIdentity: {
        provider: "github",
        canonicalKey: "github.com/acme/repo",
        displayName: "acme/repo",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/acme/repo.git",
        },
      },
    },
  ],
  useServerConfigs: () =>
    new Map([
      [
        EnvironmentId.make("remote"),
        { environment: { capabilities: { pullRequests: true, threadPullRequests: true } } },
      ],
      [
        EnvironmentId.make("local"),
        { environment: { capabilities: { pullRequests: true, threadPullRequests: true } } },
      ],
    ]),
}));
vi.mock("../state/environments", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make("remote"),
}));
vi.mock("../state/pullRequests", () => ({
  linkedPullRequestDetailAtom: () => null,
  useSharedPullRequestSummary: () => null,
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, dataUpdatedAt: null }),
}));
vi.mock("../components/ui/tooltip", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Tooltip: Passthrough, TooltipPopup: Passthrough, TooltipTrigger: Passthrough };
});

describe("Workbench pull request navigation", () => {
  it("opens a ticket pull request in the core PR page on the selected environment", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <WorkbenchPullRequestLink
            environmentId={EnvironmentId.make("local")}
            pullRequest={{
              number: 42,
              url: "https://github.com/acme/repo/pull/42",
              state: "merged",
            }}
          />,
        );
      });

      const preventDefault = vi.fn();
      const stopPropagation = vi.fn();
      const link = renderer?.root.findByProps({ href: "https://github.com/acme/repo/pull/42" });
      await act(() => {
        link?.props.onClick({ preventDefault, stopPropagation, metaKey: false, ctrlKey: false });
      });

      expect(preventDefault).toHaveBeenCalledOnce();
      expect(stopPropagation).toHaveBeenCalledOnce();
      expect(navigate).toHaveBeenCalledWith({
        to: "/pull-requests",
        search: {
          involvement: "all",
          state: "all",
          repository: "acme/repo",
          number: 42,
          selectedHost: "github.com",
          selectedProjectId: ProjectId.make("repo"),
          selectedEnvironmentId: EnvironmentId.make("local"),
        },
      });

      navigate.mockClear();
      const modifiedPreventDefault = vi.fn();
      await act(() => {
        link?.props.onClick({
          preventDefault: modifiedPreventDefault,
          stopPropagation: vi.fn(),
          metaKey: true,
          ctrlKey: false,
        });
      });
      expect(modifiedPreventDefault).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      await act(() => renderer?.unmount());
      vi.unstubAllGlobals();
      navigate.mockClear();
    }
  });
});
