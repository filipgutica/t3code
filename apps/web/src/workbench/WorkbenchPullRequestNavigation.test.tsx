import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { useOpenChangeRequestLink } from "../lib/openPullRequestLink";
import {
  useOpenWorkbenchPullRequest,
  WorkbenchPullRequestPreviewProvider,
} from "./WorkbenchPullRequestPreview";
import { WorkbenchPullRequestLink } from "./WorkbenchPullRequestLink";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";

const { navigate, location } = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { href: "/workbench?ticketId=ticket", environmentId: "", threadId: "" },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ ...location, pathname: location.href.split("?")[0] }),
  useSearch: () => ({}),
  useParams: ({ select }: { select: (params: typeof location) => unknown }) => select(location),
}));
const emptyThreadShells: never[] = [];
vi.mock("../state/entities", () => ({
  useThreadShells: () => emptyThreadShells,
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
    selection: {
      environmentId: string;
      reference: { number: number; projectId: string };
      linkedThread?: { title: string };
    };
    onClose: () => void;
  }) => {
    const open = useOpenChangeRequestLink(
      location.threadId
        ? scopeThreadRef(
            EnvironmentId.make(location.environmentId),
            ThreadId.make(location.threadId),
          )
        : undefined,
    );
    return (
      <div
        role="dialog"
        data-environment={selection.environmentId}
        data-project={selection.reference.projectId}
      >
        Pull request #{selection.reference.number}
        {selection.linkedThread ? <span>{selection.linkedThread.title}</span> : null}
        <a
          href="https://github.com/acme/repo/pull/42"
          onClick={(event) =>
            open(
              event,
              "https://github.com/acme/repo/pull/42",
              undefined,
              EnvironmentId.make(selection.environmentId),
            )
          }
        >
          This pull request
        </a>
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
  it("keeps focused attention destinations in the preview sheet while a Thread is active", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    location.href = "/local/thread/reading";
    location.environmentId = "local";
    location.threadId = "reading";
    const threadRef = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("reading"));
    const FocusedAttentionLink = () => {
      const open = useOpenWorkbenchPullRequest();
      return (
        <button
          onClick={() =>
            open?.({
              environmentId: EnvironmentId.make("remote"),
              reference: {
                projectId: ProjectId.make("other-repo"),
                repository: "acme/repo",
                number: 42,
              },
              focus: { kind: "checks" },
            })
          }
        >
          Failed checks
        </button>
      );
    };
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <WorkbenchPullRequestPreviewProvider>
            <FocusedAttentionLink />
          </WorkbenchPullRequestPreviewProvider>,
        );
      });
      await act(() => renderer?.root.findByType("button").props.onClick());
      expect(renderer?.root.findByProps({ role: "dialog" }).children).toContain("42");
      expect(
        selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef),
      ).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      await act(() =>
        renderer?.root.findAllByType("a")[1]?.props.onClick({
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          metaKey: false,
          ctrlKey: false,
        }),
      );
      expect(renderer?.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
      expect(
        selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef),
      ).toMatchObject({
        kind: "pull-request",
        environmentId: "remote",
        projectId: "other-repo",
        number: 43,
      });
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      await act(() => renderer?.unmount());
      location.href = "/workbench?ticketId=ticket";
      location.environmentId = "";
      location.threadId = "";
      useRightPanelStore.setState({ byThreadKey: {} });
      navigate.mockClear();
      vi.unstubAllGlobals();
    }
  });

  it.each(["acme/repo", "acme/linked-repo"])(
    "opens %s beside the active thread without changing its route",
    async (repository) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      location.href = "/local/thread/reading";
      location.environmentId = "local";
      location.threadId = "reading";
      const threadRef = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("reading"));
      let renderer: ReactTestRenderer | undefined;
      try {
        await act(() => {
          renderer = create(
            <WorkbenchPullRequestPreviewProvider>
              <WorkbenchPullRequestLink
                environmentId={EnvironmentId.make("remote")}
                linkedThread={{ threadId: ThreadId.make("source-thread"), title: "Source thread" }}
                pullRequest={{
                  number: 42,
                  url: `https://github.com/${repository}/pull/42`,
                  state: "open",
                }}
              />
            </WorkbenchPullRequestPreviewProvider>,
          );
        });
        await act(() => {
          renderer?.root
            .findByProps({ href: `https://github.com/${repository}/pull/42` })
            .props.onClick({
              preventDefault: vi.fn(),
              stopPropagation: vi.fn(),
              metaKey: false,
              ctrlKey: false,
            });
        });
        expect(
          selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef),
        ).toMatchObject({
          kind: "pull-request",
          environmentId: "remote",
          projectId: "other-repo",
          repository,
          number: 42,
        });
        expect(navigate).not.toHaveBeenCalled();
        expect(renderer?.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
      } finally {
        await act(() => renderer?.unmount());
        location.href = "/workbench?ticketId=ticket";
        location.environmentId = "";
        location.threadId = "";
        useRightPanelStore.setState({ byThreadKey: {} });
        navigate.mockClear();
        vi.unstubAllGlobals();
      }
    },
  );

  it("preserves ticket context until navigation, then dismisses the pull request", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <WorkbenchPullRequestPreviewProvider>
            <div data-ticket="selected">Ticket context</div>
            <WorkbenchPullRequestLink
              environmentId={EnvironmentId.make("local")}
              linkedThread={{ threadId: ThreadId.make("ticket-thread"), title: "Ticket thread" }}
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
        dialog?.findByProps({ href: "https://github.com/acme/repo/pull/42" }).props.onClick({
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          metaKey: false,
          ctrlKey: false,
        }),
      );
      expect(renderer?.root.findByProps({ role: "dialog" }).findByType("span").children).toEqual([
        "Ticket thread",
      ]);
      await act(() =>
        dialog?.findByProps({ href: "https://github.com/acme/repo/pull/43" }).props.onClick({
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          metaKey: false,
          ctrlKey: false,
        }),
      );
      expect(renderer?.root.findByProps({ role: "dialog" }).children).toContain("43");
      expect(renderer?.root.findByProps({ role: "dialog" }).findAllByType("span")).toHaveLength(0);
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
      location.href = "/draft/new-thread";
      await act(() =>
        renderer?.update(
          <WorkbenchPullRequestPreviewProvider>
            <div>Checkout thread</div>
          </WorkbenchPullRequestPreviewProvider>,
        ),
      );
      expect(renderer?.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      await act(() => renderer?.unmount());
      vi.unstubAllGlobals();
      navigate.mockClear();
      location.href = "/workbench?ticketId=ticket";
    }
  });
});
