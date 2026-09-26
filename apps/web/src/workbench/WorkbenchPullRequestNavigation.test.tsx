import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { useOpenChangeRequestLink } from "../lib/openPullRequestLink";
import { WorkbenchPullRequestPreviewProvider } from "./WorkbenchPullRequestPreview";
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

vi.mock("./WorkbenchPullRequestSheet", () => ({
  WorkbenchPullRequestSheet: ({
    selection,
    onClose,
  }: {
    selection: { environmentId: string; reference: { number: number; projectId: string } };
    onClose: () => void;
  }) => {
    const open = useOpenChangeRequestLink();
    return (
      <div
        role="dialog"
        data-environment={selection.environmentId}
        data-project={selection.reference.projectId}
      >
        Pull request #{selection.reference.number}
        <a
          href="https://github.com/acme/repo/pull/43"
          onClick={(event) =>
            open(
              event,
              "https://github.com/acme/repo/pull/43",
              undefined,
              EnvironmentId.make(selection.environmentId),
            )
          }
        >
          Related pull request
        </a>
        <button onClick={onClose}>Close</button>
      </div>
    );
  },
}));

describe("Workbench pull request navigation", () => {
  it("opens and closes a ticket pull request without leaving its environment or page", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <WorkbenchPullRequestPreviewProvider>
            <div data-ticket="selected">Ticket context</div>
            <WorkbenchPullRequestLink
              environmentId={EnvironmentId.make("local")}
              pullRequest={{
                number: 42,
                url: "https://github.com/acme/repo/pull/42",
                state: "merged",
              }}
            />
          </WorkbenchPullRequestPreviewProvider>,
        );
      });

      const preventDefault = vi.fn();
      const stopPropagation = vi.fn();
      const link = renderer?.root.findByProps({ href: "https://github.com/acme/repo/pull/42" });
      for (const keys of [
        { metaKey: true, ctrlKey: false },
        { metaKey: false, ctrlKey: true },
      ]) {
        const modifiedPreventDefault = vi.fn();
        await act(() => {
          link?.props.onClick({
            preventDefault: modifiedPreventDefault,
            stopPropagation: vi.fn(),
            ...keys,
          });
        });
        expect(modifiedPreventDefault).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
      }
      await act(() => {
        link?.props.onClick({ preventDefault, stopPropagation, metaKey: false, ctrlKey: false });
      });

      expect(preventDefault).toHaveBeenCalledOnce();
      expect(stopPropagation).toHaveBeenCalledOnce();
      expect(navigate).not.toHaveBeenCalled();
      const dialog = renderer?.root.findByProps({ role: "dialog" });
      expect(dialog?.props["data-environment"]).toBe("local");
      expect(dialog?.props["data-project"]).toBe("repo");
      expect(dialog?.children).toContain("42");
      expect(renderer?.root.findByProps({ "data-ticket": "selected" }).children).toEqual([
        "Ticket context",
      ]);
      await act(() =>
        dialog?.findByType("a").props.onClick({
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          metaKey: false,
          ctrlKey: false,
        }),
      );
      expect(renderer?.root.findByProps({ role: "dialog" }).children).toContain("43");
      expect(navigate).not.toHaveBeenCalled();
      // A sidebar popover can remove its link after the sheet takes focus.
      await act(() =>
        renderer?.update(
          <WorkbenchPullRequestPreviewProvider>
            <div data-ticket="selected">Ticket context</div>
          </WorkbenchPullRequestPreviewProvider>,
        ),
      );
      const retainedDialog = renderer?.root.findByProps({ role: "dialog" });
      expect(retainedDialog?.children).toContain("43");
      await act(() => retainedDialog?.findByType("button").props.onClick());
      expect(renderer?.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      await act(() => renderer?.unmount());
      vi.unstubAllGlobals();
      navigate.mockClear();
    }
  });
});
