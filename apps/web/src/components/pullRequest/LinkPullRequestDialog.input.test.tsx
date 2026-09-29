import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { act, forwardRef, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const threadRef = {
  environmentId: EnvironmentId.make("local"),
  threadId: ThreadId.make("thread-1"),
};
const projectId = ProjectId.make("project-1");
const otherProjectId = ProjectId.make("project-2");
const duplicateProjectId = ProjectId.make("project-3");
const observed = vi.hoisted(() => ({
  changeLink: vi.fn(async () => undefined),
  numberSearch: vi.fn(
    (targets: ReadonlyArray<{ input: { repository: string; number: number } }>) => ({
      summaries: targets.flatMap(({ input }) =>
        input.number !== 42
          ? []
          : input.repository === "acme/web"
            ? [
                {
                  url: "https://github.com/acme/web/pull/42",
                  title: "Fix sign in",
                  number: 42,
                  state: "closed",
                  isDraft: false,
                },
              ]
            : input.repository === "acme/api"
              ? [
                  {
                    url: "https://github.com/acme/api/pull/42",
                    title: "Repair retries",
                    number: 42,
                    state: "open",
                    isDraft: false,
                  },
                ]
              : [],
      ),
      isPending: false,
      error: "A repository did not return this PR.",
    }),
  ),
  list: {
    data: {
      entries: [
        {
          host: "github.com",
          repository: "acme/web",
          number: 7,
          title: "Add onboarding",
          url: "https://github.com/acme/web/pull/7",
          state: "open",
          isDraft: false,
        },
        {
          host: "github.com",
          repository: "acme/web",
          number: 142,
          title: "Fix 42 edge cases",
          url: "https://github.com/acme/web/pull/142",
          state: "open",
          isDraft: false,
        },
      ],
      providers: [{ host: "github.com", configured: true, searchesOnHost: true, detail: null }],
      errors: [],
      truncated: false,
    },
    isPending: false,
    error: null,
    refresh: vi.fn(),
  },
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => threadRef }));
vi.mock("~/state/pullRequests", () => ({
  usePullRequestList: () => observed.list,
  usePullRequestNumberSearch: observed.numberSearch,
}));
vi.mock("~/state/queries", () => ({ useDebouncedValue: (value: string) => value }));
vi.mock("~/state/entities", () => ({
  useThreadShell: () => ({ projectId, title: "A ticket Thread", pullRequests: [] }),
  useProjects: () => [
    {
      id: projectId,
      environmentId: threadRef.environmentId,
      repositoryIdentity: {
        canonicalKey: "github.com/acme/web",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/acme/web.git",
        },
        provider: "github",
        displayName: "acme/web",
      },
    },
    {
      id: otherProjectId,
      environmentId: threadRef.environmentId,
      repositoryIdentity: {
        canonicalKey: "github.com/acme/api",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/acme/api.git",
        },
        provider: "github",
        displayName: "acme/api",
      },
    },
    {
      id: duplicateProjectId,
      environmentId: threadRef.environmentId,
      repositoryIdentity: {
        canonicalKey: "github.com/acme/web",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/acme/web.git",
        },
        provider: "github",
        displayName: "acme/web",
      },
    },
  ],
}));
vi.mock("~/hooks/usePullRequestLinking", () => ({
  usePullRequestLinking: () => ({
    mode: "multiple",
    canLink: (url: string) => url.startsWith("https://github.com/acme/"),
    isLinked: () => false,
    changeLink: observed.changeLink,
  }),
}));
vi.mock("../ui/dialog", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Container,
    DialogPopup: Container,
    DialogHeader: Container,
    DialogTitle: Container,
    DialogDescription: Container,
    DialogPanel: Container,
    DialogFooter: Container,
  };
});
vi.mock("../ui/input", () => ({
  Input: forwardRef<HTMLInputElement, React.ComponentProps<"input">>((props, ref) => (
    <input {...props} ref={ref} />
  )),
}));
vi.mock("../ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));

import { LinkPullRequestDialogHost } from "./LinkPullRequestDialog";

let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { requestAnimationFrame: vi.fn(), cancelAnimationFrame: vi.fn() });
  observed.changeLink.mockClear();
  observed.numberSearch.mockClear();
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("waits for blur before showing an incomplete PR reference error", () => {
  act(() => {
    renderer = create(<LinkPullRequestDialogHost />);
  });
  act(() =>
    renderer.root
      .findAllByType("button")
      .find((node) => node.children.includes("Paste a URL"))!
      .props.onClick(),
  );
  const input = renderer.root.findByType("input");
  const messages = () => renderer.root.findAllByType("p").map((node) => node.children.join(""));

  act(() => input.props.onBlur({ relatedTarget: {} }));
  expect(messages()).not.toContain("Use a pull request URL, 123, or #123.");

  act(() => input.props.onChange({ target: { value: "#" } }));
  expect(messages()).not.toContain("Use a pull request URL, 123, or #123.");

  act(() => input.props.onBlur({ relatedTarget: {} }));
  expect(messages()).toContain("Use a pull request URL, 123, or #123.");

  act(() => input.props.onChange({ target: { value: "#42" } }));
  expect(messages()).not.toContain("Use a pull request URL, 123, or #123.");
  expect(messages()).toContain("github.com/acme/web #42");
});

it("links a discovered PR to the selected Thread", async () => {
  act(() => {
    renderer = create(<LinkPullRequestDialogHost />);
  });
  const candidate = renderer.root
    .findAllByType("button")
    .find((node) => node.props["aria-label"] === "Select github.com/acme/web #7: Add onboarding");
  expect(candidate).toBeDefined();
  act(() => candidate!.props.onClick());
  const link = renderer.root
    .findAllByType("button")
    .find((node) => node.children.includes("Link"))!;
  expect(link.props.disabled).toBe(false);
  await act(async () => {
    await link.props.onClick();
  });
  expect(observed.changeLink).toHaveBeenCalledExactlyOnceWith(
    threadRef,
    "https://github.com/acme/web/pull/7",
    true,
  );
});

it("links a pull request URL pasted into search", async () => {
  act(() => {
    renderer = create(<LinkPullRequestDialogHost />);
  });
  act(() =>
    renderer.root.findByType("input").props.onChange({
      target: { value: "https://github.com/acme/web/pull/42" },
    }),
  );
  const link = renderer.root
    .findAllByType("button")
    .find((node) => node.children.includes("Link"))!;
  expect(link.props.disabled).toBe(false);
  await act(async () => {
    await link.props.onClick();
  });
  expect(observed.changeLink).toHaveBeenCalledExactlyOnceWith(
    threadRef,
    "https://github.com/acme/web/pull/42",
    true,
  );
});

it.each(["42", "#42"])("finds exact PR number %s across repositories", async (term) => {
  act(() => {
    renderer = create(<LinkPullRequestDialogHost />);
  });
  act(() => renderer.root.findByType("input").props.onChange({ target: { value: term } }));
  const options = renderer.root
    .findAllByType("button")
    .filter((node) => node.props["aria-label"]?.startsWith("Select github.com/acme/"));
  expect(options.map((node) => node.props["aria-label"])).toEqual([
    "Select github.com/acme/web #42: Fix sign in",
    "Select github.com/acme/api #42: Repair retries",
  ]);
  expect(renderer.root.findAllByType("p").map((node) => node.children.join(""))).toContain(
    "Some repositories returned no PR or could not be checked. Paste a URL if yours is missing.",
  );
  act(() => options[1]!.props.onClick());
  const link = renderer.root
    .findAllByType("button")
    .find((node) => node.children.includes("Link"))!;
  await act(async () => {
    await link.props.onClick();
  });
  expect(observed.changeLink).toHaveBeenCalledExactlyOnceWith(
    threadRef,
    "https://github.com/acme/api/pull/42",
    true,
  );
});

it("does not claim an unresolved PR number is absent", () => {
  act(() => {
    renderer = create(<LinkPullRequestDialogHost />);
  });
  act(() => renderer.root.findByType("input").props.onChange({ target: { value: "#99" } }));
  expect(renderer.root.findAllByType("p").map((node) => node.children.join(""))).toContain(
    "No PR #99 returned. A repository may have no match or be unavailable; check the Git host connection or paste a URL.",
  );
});

it("explains why a pasted URL cannot be linked from this environment", () => {
  act(() => {
    renderer = create(<LinkPullRequestDialogHost />);
  });
  act(() =>
    renderer.root.findByType("input").props.onChange({
      target: { value: "https://github.com/other/repo/pull/1" },
    }),
  );
  expect(renderer.root.findAllByType("p").map((node) => node.children.join(""))).toContain(
    "No project in this environment can read github.com/other/repo.",
  );
});
