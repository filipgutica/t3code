import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { type ReactNode } from "react";
import { act, render } from "../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

import { useOpenChangeRequestLink } from "../lib/openPullRequestLink";
import { WorkbenchPullRequestPreviewProvider } from "./WorkbenchPullRequestPreview";
import { WorkbenchPullRequestLink } from "./WorkbenchPullRequestLink";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";

const { navigate, location } = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { href: "/workbench?ticketId=ticket", environmentId: "", threadId: "" },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
  useLocation: () => ({ ...location, pathname: location.href.split("?")[0] }),
  useSearch: () => ({}),
  useParams: ({ select }: { select: (params: typeof location) => unknown }) => select(location),
}));
const emptyThreadShells: never[] = [];
vi.mock("../state/entities", async () => {
  const { EnvironmentId, ProjectId } = await import("@t3tools/contracts");
  const projects = [
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
  ] as const;
  return {
    readEnvironmentSupportsServerBrowser: () => false,
    useEnvironmentSupportsServerBrowser: () => false,
    useThreadShells: () => emptyThreadShells,
    useProjects: () => projects,
    readProjects: () => projects,
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
  };
});
vi.mock("../state/environments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/environments")>()),
  usePrimaryEnvironmentId: () => EnvironmentId.make("remote"),
}));
vi.mock("../state/pullRequests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/pullRequests")>()),
  linkedPullRequestDetailAtom: () => null,
  useSharedPullRequestSummary: () => null,
}));
vi.mock("../state/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/query")>()),
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

function setup() {
  navigate.mockClear();
  location.href = "/workbench?ticketId=ticket";
  location.environmentId = "";
  location.threadId = "";
  useRightPanelStore.setState({ byThreadKey: {} });
  return {
    [Symbol.dispose]() {
      useRightPanelStore.setState({ byThreadKey: {} });
    },
  };
}

async function click(link: Element, keys: { metaKey?: boolean; ctrlKey?: boolean } = {}) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...keys });
  using stopped = vi.spyOn(event, "stopPropagation");
  let observed = false;
  let prevented = false;
  // Observe the application's decision before preventing this fixture's external navigation.
  const keepFixtureOpen = (candidate: Event) => {
    if (candidate !== event) return;
    observed = true;
    prevented = candidate.defaultPrevented;
    candidate.preventDefault();
  };
  window.addEventListener("click", keepFixtureOpen);
  try {
    await act(() => {
      link.dispatchEvent(event);
    });
    return {
      prevented: observed ? prevented : event.defaultPrevented,
      stopped: stopped.mock.calls.length,
    };
  } finally {
    window.removeEventListener("click", keepFixtureOpen);
  }
}

describe("Workbench pull request navigation", () => {
  it.each(["acme/repo", "acme/linked-repo"])(
    "opens %s beside the active thread without changing its route",
    async (repository) => {
      using _state = setup();
      location.href = "/local/thread/reading";
      location.environmentId = "local";
      location.threadId = "reading";
      const threadRef = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("reading"));
      await using screen = await render(
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
      await click(screen.container.querySelector('a[aria-label*="in T3 Code"]')!);
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
      await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    },
  );

  it("preserves ticket context until navigation, then dismisses the pull request", async () => {
    using _state = setup();
    await using screen = await render(
      <WorkbenchPullRequestPreviewProvider>
        <div data-ticket="selected">Ticket context</div>
        <WorkbenchPullRequestLink
          environmentId={EnvironmentId.make("local")}
          linkedThread={{ threadId: ThreadId.make("ticket-thread"), title: "Ticket thread" }}
          pullRequest={{ number: 42, url: "https://github.com/acme/repo/pull/42", state: "merged" }}
        />
      </WorkbenchPullRequestPreviewProvider>,
    );
    const link = screen.container.querySelector('a[aria-label*="in T3 Code"]')!;
    for (const keys of [
      { metaKey: true, ctrlKey: false },
      { metaKey: false, ctrlKey: true },
    ]) {
      expect((await click(link, keys)).prevented).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
    }
    const handled = await click(link);
    expect(handled.prevented).toBe(true);
    expect(handled.stopped).toBe(1);
    expect(navigate).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    await expect.element(dialog).toHaveAttribute("data-environment", "local");
    await expect.element(dialog).toHaveAttribute("data-project", "repo");
    await expect.element(dialog).toHaveTextContent("42");
    await expect
      .element(screen.container.querySelector<HTMLElement>('[data-ticket="selected"]')!)
      .toHaveTextContent("Ticket context");
    await click(dialog.getByRole("link", { name: "This pull request" }).element());
    await expect.element(dialog.getByText("Ticket thread")).toBeVisible();
    await click(dialog.getByRole("link", { name: "Related pull request" }).element());
    await expect.element(dialog).toHaveTextContent("43");
    expect(dialog.element().querySelectorAll("span")).toHaveLength(0);
    expect(navigate).not.toHaveBeenCalled();
    // A sidebar popover can remove its link after the sheet takes focus.
    await screen.rerender(
      <WorkbenchPullRequestPreviewProvider>
        <div data-ticket="selected">Ticket context</div>
      </WorkbenchPullRequestPreviewProvider>,
    );
    await expect.element(screen.getByRole("dialog")).toHaveTextContent("43");
    location.href = "/draft/new-thread";
    await screen.rerender(
      <WorkbenchPullRequestPreviewProvider>
        <div>Checkout thread</div>
      </WorkbenchPullRequestPreviewProvider>,
    );
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});

vi.mock("../state/server", async (original) => {
  const actual = await original<typeof import("../state/server")>();
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
