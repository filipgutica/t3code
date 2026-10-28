import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchTicketId,
  type WorkbenchReference,
} from "@t3tools/contracts";
import type { ReactNode } from "react";
import { WorkbenchTicketPullRequests } from "./WorkbenchTicketPullRequests";

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({ pullRequests: [], errors: [], isPending: false }),
}));
vi.mock("../state/pullRequests", () => ({
  usePullRequestList: () => ({ data: null, isPending: false, error: null }),
}));
vi.mock("./WorkbenchLinkPullRequest", () => ({
  WorkbenchLinkPullRequest: () => <button disabled>Link PR</button>,
}));
vi.mock("./WorkbenchPullRequestLink", () => ({ WorkbenchPullRequestLink: () => null }));
vi.mock("../components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipPopup: () => null,
}));
const commands = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }));
vi.mock("./WorkbenchReferences", () => ({
  useWorkbenchReferenceCommands: () => ({ canEdit: true, ...commands }),
}));

const stubBrowser = () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), { localStorage: { getItem: () => null } }),
  );
};

describe("Ticket Pull Requests section", () => {
  let renderer: ReactTestRenderer;
  afterEach(() => {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  });
  it("keeps PR linking discoverable on a local Ticket without PRs or References", () => {
    stubBrowser();
    act(() => {
      renderer = create(
        <WorkbenchTicketPullRequests
          environmentId={EnvironmentId.make("local")}
          ticketId={WorkbenchTicketId.make("local-ticket")}
          assignments={[]}
          threadsById={new Map()}
          references={[]}
          pullRequests={[]}
          checkouts={[]}
          onOpenThread={vi.fn()}
        />,
      );
    });
    expect(renderer.root.findAllByType("section")).toHaveLength(1);
    expect(
      renderer.root.findAllByType("button").some((button) => button.children.includes("Link PR")),
    ).toBe(true);
  });

  it("unlinks only the Reference from a PR that a Thread also links", async () => {
    stubBrowser();
    commands.remove.mockReset().mockResolvedValue(null);
    commands.add.mockReset();
    const ticketId = WorkbenchTicketId.make("ticket");
    const threadId = ThreadId.make("thread");
    const reference: WorkbenchReference = {
      ticketId,
      url: "https://github.com/acme/repo/pull/12/files",
      title: null,
      addedByThreadId: null,
      createdAt: "2026-10-27T00:00:00.000Z",
    };
    act(() => {
      renderer = create(
        <WorkbenchTicketPullRequests
          environmentId={EnvironmentId.make("local")}
          ticketId={ticketId}
          assignments={[]}
          threadsById={new Map()}
          references={[reference]}
          pullRequests={[
            {
              threadId,
              threadTitle: "Fix retries",
              pullRequest: {
                projectId: ProjectId.make("repo"),
                repository: "acme/repo",
                number: 12,
                url: "https://github.com/acme/repo/pull/12",
              },
            },
          ]}
          checkouts={[]}
          onOpenThread={vi.fn()}
        />,
      );
    });
    const unlink = renderer.root.findAll(
      (node) =>
        node.type === "button" && node.props["aria-label"] === "Unlink pull request #12 reference",
    );
    expect(unlink).toHaveLength(1);
    await act(async () => unlink[0]!.props.onClick());
    expect(commands.remove).toHaveBeenCalledExactlyOnceWith({ ticketId, url: reference.url });
    expect(commands.add).not.toHaveBeenCalled();
  });
});
