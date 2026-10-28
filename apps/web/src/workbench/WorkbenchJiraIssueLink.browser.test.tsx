import {
  EnvironmentId,
  WorkbenchEpicId,
  WorkbenchProjectId,
  type WorkbenchEpic,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { WorkbenchEpicJiraIssueLinkField } from "./WorkbenchJiraIssueLink";

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
const epic: WorkbenchEpic = {
  id: WorkbenchEpicId.make("epic"),
  projectId: WorkbenchProjectId.make("workspace"),
  title: "Onboarding",
  markdown: "",
  archivedAt: null,
  jiraIssue: null,
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

it("links a pasted issue URL against the Epic version the user saw", async () => {
  setup();
  await using screen = await render(
    <WorkbenchEpicJiraIssueLinkField environmentId={environmentId} epic={epic} disabled={false} />,
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
      epicId: epic.id,
      url: `${linked.url}?focusedCommentId=1`,
      expectedUpdatedAt: timestamp,
    },
  });
  await expect.element(input).not.toBeInTheDocument();
});

it("unlinks an Epic against its last update and shows a stale-write failure", async () => {
  setup({
    _tag: "Failure",
    cause: Cause.fail(new Error("This Epic changed. Reload it before continuing.")),
  });
  await using screen = await render(
    <WorkbenchEpicJiraIssueLinkField
      environmentId={environmentId}
      epic={{ ...epic, jiraIssue: linked }}
      disabled={false}
    />,
  );
  await expect.element(screen.getByRole("link", { name: "Open Jira issue ORBIT-3" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Unlink" }));
  expect(mocks.setLink).toHaveBeenCalledWith({
    environmentId,
    input: { epicId: epic.id, url: null, expectedUpdatedAt: timestamp },
  });
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("This Epic changed. Reload it before continuing.");
});
