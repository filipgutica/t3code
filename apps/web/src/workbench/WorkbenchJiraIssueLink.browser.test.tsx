import {
  EnvironmentId,
  ProjectId,
  WorkbenchEpicId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchEpic,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { WorkbenchJiraIssueLinkField } from "./WorkbenchJiraIssueLink";

const mocks = vi.hoisted(() => ({ setLink: vi.fn() }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => mocks.setLink }));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => true,
}));
vi.mock("./state", () => ({
  workbenchEnvironment: { setJiraIssueLink: { permissionAtom: () => "set-jira-issue-link" } },
}));

const environmentId = EnvironmentId.make("environment");
const timestamp = "2026-10-25T00:00:00.000Z";
const ticket: WorkbenchTicket = {
  id: WorkbenchTicketId.make("ticket"),
  projectId: WorkbenchProjectId.make("workspace"),
  primaryT3ProjectId: ProjectId.make("repository"),
  repositoryProjectIds: [ProjectId.make("repository")],
  epicId: null,
  title: "Explain expired invitation links",
  markdown: "",
  kind: "story",
  status: "todo",
  blocked: false,
  revision: 4,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const linked = {
  key: "ORBIT-3",
  url: "https://acme.atlassian.net/browse/ORBIT-3",
};

function setup(result: unknown = { _tag: "Success", value: undefined }) {
  mocks.setLink.mockReset();
  mocks.setLink.mockResolvedValue(result);
}

it("links a pasted issue URL against the Ticket revision the user saw", async () => {
  setup();
  await using screen = await render(
    <WorkbenchJiraIssueLinkField
      environmentId={environmentId}
      target={{ kind: "ticket", ticket }}
      disabled={false}
    />,
  );
  await expect.element(screen.getByText("Not linked")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Link issue" }));
  const input = page.getByRole("textbox", { name: "Jira issue URL" });
  await userEvent.fill(input, "ORBIT-3");
  await userEvent.click(page.getByRole("button", { name: "Link", exact: true }));
  await expect.element(page.getByText(/Enter a Jira issue URL/)).toBeVisible();
  expect(mocks.setLink).not.toHaveBeenCalled();

  await userEvent.fill(input, `${linked.url}?focusedCommentId=1`);
  await expect.element(page.getByText("Links ORBIT-3.")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Link", exact: true }));
  expect(mocks.setLink).toHaveBeenCalledWith({
    environmentId,
    input: {
      kind: "ticket",
      ticketId: ticket.id,
      url: `${linked.url}?focusedCommentId=1`,
      expectedRevision: 4,
    },
  });
  await expect.element(input).not.toBeInTheDocument();
});

it("unlinks an Epic against its last update and shows a stale-write failure", async () => {
  setup({
    _tag: "Failure",
    cause: Cause.fail(new Error("This Epic changed. Reload it before continuing.")),
  });
  const epic: WorkbenchEpic = {
    id: WorkbenchEpicId.make("epic"),
    projectId: ticket.projectId,
    title: "Onboarding",
    markdown: "",
    archivedAt: null,
    jiraIssue: linked,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await using screen = await render(
    <WorkbenchJiraIssueLinkField
      environmentId={environmentId}
      target={{ kind: "epic", epic }}
      disabled={false}
    />,
  );
  await expect.element(screen.getByRole("link", { name: "Open Jira issue ORBIT-3" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Unlink" }));
  expect(mocks.setLink).toHaveBeenCalledWith({
    environmentId,
    input: { kind: "epic", epicId: epic.id, url: null, expectedUpdatedAt: timestamp },
  });
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("This Epic changed. Reload it before continuing.");
});
