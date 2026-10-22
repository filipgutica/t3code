import { render } from "../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";
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
  it("keeps PR linking discoverable on a local Ticket without PRs or a Jira key", async () => {
    await using screen = await render(
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
    expect(screen.container.querySelectorAll("section")).toHaveLength(1);
    await expect.element(screen.getByRole("button", { name: "Link PR" })).toBeVisible();
  });
});
