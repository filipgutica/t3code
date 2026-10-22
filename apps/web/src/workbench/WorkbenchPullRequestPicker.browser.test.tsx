import { EnvironmentId, ProjectId, ThreadId, type PullRequestRef } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { forwardRef, type ReactNode } from "react";
import { act, render, type Screen } from "../../test/render";
import { expect, it, vi } from "vite-plus/test";

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

const onClose = vi.hoisted(() => vi.fn());
const mount = () =>
  render(
    <WorkbenchPullRequestPicker thread={thread} finalFocus={{ current: null }} onClose={onClose} />,
  );
const type = (screen: Screen, value: string) => screen.getByRole("searchbox").fill(value);
const buttons = (screen: Screen) =>
  Array.from(screen.container.querySelectorAll<HTMLButtonElement>("button"));
const linkButton = (screen: Screen) => buttons(screen).find((node) => node.textContent === "Link")!;
const messages = (screen: Screen) =>
  Array.from(screen.container.querySelectorAll("p"), (node) => node.textContent);
const select = (screen: Screen, label: string) =>
  screen.getByRole("button", { name: label }).click();
function setup() {
  observed.changeLink.mockClear();
  observed.listTargets = [];
  onClose.mockClear();
}

it("links a browsed PR to the Thread and closes", async () => {
  setup();
  await using screen = await mount();
  expect(linkButton(screen).disabled).toBe(true);
  await select(screen, "Select github.com/acme/web #7: Add onboarding");
  await act(async () => {
    await linkButton(screen).click();
  });
  expect(observed.changeLink).toHaveBeenCalledExactlyOnceWith(
    { environmentId, threadId: thread.id },
    "https://github.com/acme/web/pull/7",
    true,
  );
  expect(onClose).toHaveBeenCalledOnce();
});

it("drops a selection when the search changes", async () => {
  setup();
  await using screen = await mount();
  await select(screen, "Select github.com/acme/web #7: Add onboarding");
  expect(linkButton(screen).disabled).toBe(false);
  await type(screen, "onboarding");
  expect(linkButton(screen).disabled).toBe(true);
});

it("links a pasted PR URL with Enter", async () => {
  setup();
  await using screen = await mount();
  observed.listTargets = [];
  await type(screen, "https://github.com/acme/web/pull/42");
  expect(observed.listTargets).toEqual([]);
  expect(messages(screen)).toContain("github.com/acme/web #42");
  await act(async () => {
    screen
      .getByRole("searchbox")
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
  });
  expect(observed.changeLink).toHaveBeenCalledExactlyOnceWith(
    { environmentId, threadId: thread.id },
    "https://github.com/acme/web/pull/42",
    true,
  );
});

it("explains why a pasted URL cannot be linked from this environment", async () => {
  setup();
  await using screen = await mount();
  await type(screen, "https://github.com/other/repo/pull/1");
  expect(messages(screen)).toContain(
    "No project in this environment can read github.com/other/repo.",
  );
  expect(linkButton(screen).disabled).toBe(true);
});

it.each(["42", "#42"])(
  "looks up PR number %s once per repository and reports misses",
  async (term) => {
    setup();
    await using screen = await mount();
    observed.listTargets = [];
    await type(screen, term);
    expect(observed.listTargets).toEqual([]);
    expect(
      buttons(screen)
        .map((node) => node.getAttribute("aria-label"))
        .filter((label) => label?.startsWith("Select")),
    ).toEqual(["Select github.com/acme/web #42: Fix sign in"]);
    expect(messages(screen)).toContain(
      "acme/api: no PR #42 returned. It may not exist or the Git host may be unavailable; paste a URL if yours is missing.",
    );
    await select(screen, "Select github.com/acme/web #42: Fix sign in");
    await act(async () => {
      await linkButton(screen).click();
    });
    expect(observed.changeLink).toHaveBeenCalledExactlyOnceWith(
      { environmentId, threadId: thread.id },
      "https://github.com/acme/web/pull/42",
      true,
    );
  },
);

it("links the Thread's own repository by number when the Git host returns nothing", async () => {
  setup();
  await using screen = await mount();
  await type(screen, "43");
  expect(
    buttons(screen)
      .map((node) => node.getAttribute("aria-label"))
      .filter((label) => label?.startsWith("Select")),
  ).toEqual(["Select github.com/acme/web #43: Pull request #43 in this Thread's repository"]);
  expect(messages(screen)).toContain(
    "acme/api: no PR #43 returned. It may not exist or the Git host may be unavailable; paste a URL if yours is missing.",
  );
  await select(
    screen,
    "Select github.com/acme/web #43: Pull request #43 in this Thread's repository",
  );
  await act(async () => {
    await linkButton(screen).click();
  });
  expect(observed.changeLink).toHaveBeenCalledExactlyOnceWith(
    { environmentId, threadId: thread.id },
    "https://github.com/acme/web/pull/43",
    true,
  );
});

it("skips number lookups for repositories without a pull request host", async () => {
  setup();
  await using screen = await mount();
  await type(screen, "43");
  const text = [
    ...messages(screen),
    ...buttons(screen).map((node) => String(node.getAttribute("aria-label"))),
  ];
  expect(text.filter((line) => line.includes("beacon-cli"))).toEqual([]);
});
