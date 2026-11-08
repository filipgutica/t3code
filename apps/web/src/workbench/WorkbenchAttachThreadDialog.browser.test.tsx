import { ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

// Without the app styles the dialog popup is unpositioned, so Base UI's inert layer covers it.
import "~/index.css";
import { render } from "../../test/render";
import { WorkbenchAttachThreadDialog } from "./WorkbenchAttachThreadDialog";

const api = ProjectId.make("api");
const branch = "main";
const projects = [{ id: api, title: "api repo" }];
const threads = [
  { id: ThreadId.make("original"), title: "First", projectId: api, branch },
  { id: ThreadId.make("other"), title: "Second", projectId: api, branch: "feature/draft" },
];

const renderDialog = (onAttach: (threadId: ThreadId) => Promise<void>, candidates = threads) =>
  render(
    <WorkbenchAttachThreadDialog
      projects={projects}
      threads={candidates}
      pending={false}
      error={null}
      onClose={() => {}}
      onAttach={onAttach}
    />,
  );

it("distinguishes duplicate titles and keeps the selected source clear after filtering", async () => {
  const onAttach = vi.fn(async () => {});
  await using _screen = await renderDialog(onAttach, [
    { ...threads[0]!, title: "Same title" },
    { ...threads[1]!, title: "Same title" },
  ]);
  const source = page.getByRole("button", { name: `Same title, api repo, ${branch}` });
  await userEvent.click(source);
  await expect.element(source).toHaveAttribute("aria-pressed", "true");
  await expect
    .element(page.getByRole("button", { name: "Same title, api repo, feature/draft" }))
    .toHaveAttribute("aria-pressed", "false");
  await userEvent.fill(page.getByRole("textbox", { name: "Find a Thread" }), "no match");
  await expect.element(source).not.toBeInTheDocument();
  await expect.element(page.getByText("Selected Thread", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Same title", { exact: true })).toBeVisible();
  await expect.element(page.getByText(`api repo · ${branch}`, { exact: true })).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Link Thread" }));
  expect(onAttach).toHaveBeenCalledWith(ThreadId.make("original"));
});
