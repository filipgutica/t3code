import { EnvironmentId, ProjectId, ThreadId, type PullRequestRef } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { act, forwardRef, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const environmentId = EnvironmentId.make("local");
const thread = {
  id: ThreadId.make("thread-1"),
  environmentId,
  projectId: ProjectId.make("project-1"),
  title: "A ticket Thread",
  pullRequests: [],
} as unknown as EnvironmentThreadShell;
const project = (id: string, canonicalKey: string) => ({
  id: ProjectId.make(id),
  environmentId,
  repositoryIdentity: {
    canonicalKey,
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: `https://${canonicalKey}.git`,
    },
    provider: "github",
    displayName: canonicalKey.split("/").slice(1).join("/"),
  },
});
// Shaped as the server identifies a bare-path remote: no provider, so no pull request host.
const localPath = "/users/dev/git-remotes/beacon-cli";
const localProject = {
  id: ProjectId.make("project-local"),
  environmentId,
  repositoryIdentity: {
    canonicalKey: localPath,
    locator: { source: "git-remote", remoteName: "origin", remoteUrl: localPath },
    displayName: localPath.slice(1),
    owner: "users",
    name: "beacon-cli",
  },
};
const summaries: Record<string, { url: string; title: string; state: string }> = {
  "acme/web#42": {
    url: "https://github.com/acme/web/pull/42",
    title: "Fix sign in",
    state: "closed",
  },
};
const observed = vi.hoisted(() => ({
  changeLink: vi.fn(async (..._args: unknown[]) => undefined),
  listTargets: [] as unknown[],
}));
vi.mock("../state/pullRequests", () => ({
  linkedPullRequestDetailAtom: (target: { input: PullRequestRef }) => target.input,
  usePullRequestList: (targets: unknown[]) => {
    observed.listTargets = targets;
    return {
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
    };
  },
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: (input: PullRequestRef) => {
    const summary = summaries[`${input.repository}#${input.number}`];
    return { data: summary ? { ...summary, isDraft: false } : null, isPending: false };
  },
}));
vi.mock("../state/queries", () => ({ useDebouncedValue: (value: string) => value }));
vi.mock("../state/entities", () => ({
  useProjects: () => [
    project("project-1", "github.com/acme/web"),
    project("project-2", "github.com/acme/api"),
    project("project-3", "github.com/acme/web"),
    localProject,
  ],
}));
vi.mock("../hooks/usePullRequestLinking", () => ({
  usePullRequestLinking: () => ({
    mode: "multiple",
    canLink: (url: string) => url.startsWith("https://github.com/acme/"),
    isLinked: () => false,
    changeLink: observed.changeLink,
  }),
}));
vi.mock("../components/ui/dialog", () => {
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
vi.mock("../components/ui/input", () => ({
  Input: forwardRef<HTMLInputElement, React.ComponentProps<"input">>((props, ref) => (
    <input {...props} ref={ref} />
  )),
}));
vi.mock("../components/ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));

import { WorkbenchPullRequestPicker } from "./WorkbenchPullRequestPicker";

const onClose = vi.fn();
let renderer: ReactTestRenderer;
const render = () =>
  act(() => {
    renderer = create(
      <WorkbenchPullRequestPicker
        thread={thread}
        finalFocus={{ current: null }}
        onClose={onClose}
      />,
    );
  });
const type = (value: string) =>
  act(() => renderer.root.findByType("input").props.onChange({ target: { value } }));
const buttons = () => renderer.root.findAllByType("button");
const linkButton = () => buttons().find((node) => node.children.includes("Link"))!;
const messages = () => renderer.root.findAllByType("p").map((node) => node.children.join(""));
const select = (label: string) =>
  act(() =>
    buttons()
      .find((node) => node.props["aria-label"] === label)!
      .props.onClick(),
  );

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  observed.changeLink.mockClear();
  onClose.mockClear();
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("links a browsed PR to the Thread and closes", async () => {
  render();
  expect(linkButton().props.disabled).toBe(true);
  select("Select github.com/acme/web #7: Add onboarding");
  await act(async () => {
    await linkButton().props.onClick();
  });
  expect(observed.changeLink).toHaveBeenCalledExactlyOnceWith(
    { environmentId, threadId: thread.id },
    "https://github.com/acme/web/pull/7",
    true,
  );
  expect(onClose).toHaveBeenCalledOnce();
});

it("drops a selection when the search changes", () => {
  render();
  select("Select github.com/acme/web #7: Add onboarding");
  expect(linkButton().props.disabled).toBe(false);
  type("onboarding");
  expect(linkButton().props.disabled).toBe(true);
});

it("links a pasted PR URL with Enter", async () => {
  render();
  observed.listTargets = [];
  type("https://github.com/acme/web/pull/42");
  expect(observed.listTargets).toEqual([]);
  expect(messages()).toContain("github.com/acme/web #42");
  const preventDefault = vi.fn();
  await act(async () => {
    await renderer.root.findByType("input").props.onKeyDown({ key: "Enter", preventDefault });
  });
  expect(observed.changeLink).toHaveBeenCalledExactlyOnceWith(
    { environmentId, threadId: thread.id },
    "https://github.com/acme/web/pull/42",
    true,
  );
});

it("explains why a pasted URL cannot be linked from this environment", () => {
  render();
  type("https://github.com/other/repo/pull/1");
  expect(messages()).toContain("No project in this environment can read github.com/other/repo.");
  expect(linkButton().props.disabled).toBe(true);
});

it.each(["42", "#42"])(
  "looks up PR number %s once per repository and reports misses",
  async (term) => {
    render();
    observed.listTargets = [];
    type(term);
    expect(observed.listTargets).toEqual([]);
    expect(
      buttons()
        .map((node) => node.props["aria-label"])
        .filter((label) => label?.startsWith("Select")),
    ).toEqual(["Select github.com/acme/web #42: Fix sign in"]);
    expect(messages()).toContain(
      "acme/api: no PR #42 returned. It may not exist or the Git host may be unavailable; paste a URL if yours is missing.",
    );
    select("Select github.com/acme/web #42: Fix sign in");
    await act(async () => {
      await linkButton().props.onClick();
    });
    expect(observed.changeLink).toHaveBeenCalledExactlyOnceWith(
      { environmentId, threadId: thread.id },
      "https://github.com/acme/web/pull/42",
      true,
    );
  },
);

it("links the Thread's own repository by number when the Git host returns nothing", async () => {
  render();
  type("43");
  expect(
    buttons()
      .map((node) => node.props["aria-label"])
      .filter((label) => label?.startsWith("Select")),
  ).toEqual(["Select github.com/acme/web #43: Pull request #43 in this Thread's repository"]);
  expect(messages()).toContain(
    "acme/api: no PR #43 returned. It may not exist or the Git host may be unavailable; paste a URL if yours is missing.",
  );
  select("Select github.com/acme/web #43: Pull request #43 in this Thread's repository");
  await act(async () => {
    await linkButton().props.onClick();
  });
  expect(observed.changeLink).toHaveBeenCalledExactlyOnceWith(
    { environmentId, threadId: thread.id },
    "https://github.com/acme/web/pull/43",
    true,
  );
});

it("skips number lookups for repositories without a pull request host", () => {
  render();
  type("43");
  const text = [...messages(), ...buttons().map((node) => String(node.props["aria-label"]))];
  expect(text.filter((line) => line.includes("beacon-cli"))).toEqual([]);
});
