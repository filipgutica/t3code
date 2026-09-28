import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { act, forwardRef, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const threadRef = {
  environmentId: EnvironmentId.make("local"),
  threadId: ThreadId.make("thread-1"),
};
const projectId = ProjectId.make("project-1");
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => threadRef }));
vi.mock("~/state/entities", () => ({
  useThreadShell: () => ({ projectId }),
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
  usePullRequestLinking: () => ({ mode: "multiple", canLink: () => true, changeLink: vi.fn() }),
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
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("waits for blur before showing an incomplete PR reference error", () => {
  act(() => {
    renderer = create(<LinkPullRequestDialogHost />);
  });
  const input = renderer.root.findByType("input");
  const messages = () => renderer.root.findAllByType("p").map((node) => node.children.join(""));

  act(() => input.props.onChange({ target: { value: "#" } }));
  expect(messages()).not.toContain("Use a pull request URL, 123, or #123.");

  act(() => input.props.onBlur());
  expect(messages()).toContain("Use a pull request URL, 123, or #123.");

  act(() => input.props.onChange({ target: { value: "#42" } }));
  expect(messages()).not.toContain("Use a pull request URL, 123, or #123.");
  expect(messages()).toContain("github.com/acme/web #42");
});
