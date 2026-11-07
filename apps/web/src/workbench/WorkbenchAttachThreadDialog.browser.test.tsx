import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchTicketId,
  WorkbenchTicketWorkspaceAttemptId,
  type WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

// Without the app styles the dialog popup is unpositioned, so Base UI's inert layer covers it.
import "~/index.css";
import { render } from "../../test/render";
import { WorkbenchAttachThreadDialog } from "./WorkbenchAttachThreadDialog";

const mocks = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock("../state/vcs", () => ({
  vcsEnvironment: { status: (request: unknown) => request },
}));
vi.mock("../state/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/query")>()),
  useEnvironmentQuery: (request: unknown) => mocks.status(request),
}));

const environmentId = EnvironmentId.make("environment");
const api = ProjectId.make("api");
const web = ProjectId.make("web");
const elsewhere = ProjectId.make("elsewhere");
const time = "2026-11-07T00:00:00.000Z";
const branch = "t3/expire-invitations";
const ticket = { repositoryProjectIds: [api, web] };
const workspace: WorkbenchTicketWorkspace = {
  ticketId: WorkbenchTicketId.make("ticket"),
  attemptId: WorkbenchTicketWorkspaceAttemptId.make("attempt"),
  status: "ready",
  branchName: branch,
  errorMessage: null,
  repositories: [api, web].map((projectId) => ({
    projectId,
    sourcePath: `/repos/${projectId}`,
    worktreePath: `/worktrees/${projectId}`,
    branchName: branch,
    status: "ready" as const,
    errorMessage: null,
    createdAt: time,
    updatedAt: time,
  })),
  createdAt: time,
  updatedAt: time,
};
const projects = [api, web, elsewhere].map((id) => ({
  id,
  title: `${id} repo`,
  workspaceRoot: `/repos/${id}`,
}));
const threads = [
  {
    id: ThreadId.make("in-ticket"),
    title: "Already here",
    projectId: api,
    branch,
    worktreePath: "/worktrees/api",
  },
  {
    id: ThreadId.make("other-worktree"),
    title: "Drafted elsewhere",
    projectId: api,
    branch: "feature/draft",
    worktreePath: "/elsewhere/api",
  },
  {
    id: ThreadId.make("foreign"),
    title: "Other repository",
    projectId: elsewhere,
    branch: null,
    worktreePath: null,
  },
];

const setup = (dirty: boolean) => {
  mocks.status.mockReset().mockReturnValue({
    data: { hasWorkingTreeChanges: dirty, refName: dirty ? "feature/draft" : null },
  });
  const onAttach = vi.fn(async () => {});
  return { onAttach };
};

const renderDialog = (onAttach: () => Promise<void>) =>
  render(
    <WorkbenchAttachThreadDialog
      environmentId={environmentId}
      ticket={ticket}
      workspace={workspace}
      projects={projects}
      threads={threads}
      pending={false}
      error={null}
      onClose={() => {}}
      onAttach={onAttach}
    />,
  );

it("links a Thread in a Ticket worktree as it is", async () => {
  const { onAttach } = setup(false);
  await using _screen = await renderDialog(onAttach);
  await userEvent.click(page.getByRole("button", { name: "Already here" }));
  await expect.element(page.getByText(/Links a fork/)).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: "Link Thread" }));
  expect(onAttach).toHaveBeenCalledWith(ThreadId.make("in-ticket"), undefined);
});

it("explains the fork and names the source branch when it has uncommitted changes", async () => {
  const { onAttach } = setup(true);
  await using _screen = await renderDialog(onAttach);
  await userEvent.click(page.getByRole("button", { name: "Drafted elsewhere" }));
  await expect
    .element(
      page.getByText("Links a fork that works in the api repo Ticket worktree.", { exact: false }),
    )
    .toBeVisible();
  await expect.element(page.getByText(/feature\/draft has uncommitted changes/)).toBeVisible();
  expect(mocks.status).toHaveBeenLastCalledWith({
    environmentId,
    input: { cwd: "/elsewhere/api" },
  });
  await expect.element(page.getByLabelText(/Thread repository/)).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: "Link Thread" }));
  expect(onAttach).toHaveBeenCalledWith(ThreadId.make("other-worktree"), undefined);
});

it("forks a Thread from an unlinked repository into the Ticket repository the user picks", async () => {
  const { onAttach } = setup(false);
  await using _screen = await renderDialog(onAttach);
  await userEvent.click(page.getByRole("button", { name: "Other repository" }));
  await expect.element(page.getByText(/don’t move to the fork/)).toBeVisible();
  expect(mocks.status).toHaveBeenLastCalledWith({
    environmentId,
    input: { cwd: "/repos/elsewhere" },
  });
  await userEvent.click(page.getByLabelText("Thread repository: api repo"));
  await userEvent.click(page.getByRole("menuitemradio", { name: /web repo/ }));
  await expect
    .element(
      page.getByText("Links a fork that works in the web repo Ticket worktree.", { exact: false }),
    )
    .toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Link Thread" }));
  expect(onAttach).toHaveBeenCalledWith(ThreadId.make("foreign"), web);
});
