import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, WorkbenchTicketId } from "@t3tools/contracts";
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

describe("Ticket Pull Requests section", () => {
  let renderer: ReactTestRenderer;
  afterEach(() => {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  });
  it("keeps PR linking discoverable on a local Ticket without PRs or a Jira key", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), { localStorage: { getItem: () => null } }),
    );
    act(() => {
      renderer = create(
        <WorkbenchTicketPullRequests
          environmentId={EnvironmentId.make("local")}
          ticketId={WorkbenchTicketId.make("local-ticket")}
          assignments={[]}
          threadsById={new Map()}
          ticketKey={null}
          workspaceRepositoryProjectIds={[]}
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
});
