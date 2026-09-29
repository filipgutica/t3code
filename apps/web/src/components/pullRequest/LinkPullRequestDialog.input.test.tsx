import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { act, forwardRef, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const threadRef = {
  environmentId: EnvironmentId.make("local"),
  threadId: ThreadId.make("thread-1"),
};
const projectId = ProjectId.make("project-1");
const observed = vi.hoisted(() => ({
  changeLink: vi.fn(async () => undefined),
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
vi.mock("~/state/pullRequests", () => ({ usePullRequestList: () => observed.list }));
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
  ],
}));
vi.mock("~/hooks/usePullRequestLinking", () => ({
  usePullRequestLinking: () => ({
    mode: "multiple",
    canLink: () => true,
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

  act(() => input.props.onBlur());
  expect(messages()).not.toContain("Paste a pull request URL or enter 123 / #123.");

  act(() => input.props.onChange({ target: { value: "#" } }));
  expect(messages()).not.toContain("Use a pull request URL, 123, or #123.");

  act(() => input.props.onBlur());
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
