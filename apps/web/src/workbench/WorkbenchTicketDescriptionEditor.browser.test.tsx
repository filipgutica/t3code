import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { WorkbenchTicketDescriptionEditor } from "./WorkbenchTicketDescriptionEditor";

const source = "Intro with https://example.com\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n* keep\n";

function Harness({ initial, onChange }: { initial: string; onChange: (value: string) => void }) {
  const [markdown, setMarkdown] = useState(initial);
  return (
    <WorkbenchTicketDescriptionEditor
      markdown={markdown}
      jira={false}
      onChange={(next) => {
        setMarkdown(next);
        onChange(next);
      }}
    />
  );
}

it("opens and switches modes without changing the description", async () => {
  const onChange = vi.fn();
  await using _screen = await render(<Harness initial={source} onChange={onChange} />);
  const editor = page.getByRole("textbox", { name: "Description" });
  await expect.element(editor).toBeVisible();
  expect(editor.element().textContent).toContain("Intro with https://example.com");
  await expect.element(page.getByRole("link", { name: "https://example.com" })).toBeVisible();

  await page.getByRole("button", { name: "Markdown" }).click();
  await expect.element(page.getByRole("textbox", { name: "Description" })).toHaveValue(source);
  await page.getByRole("button", { name: "Rich text" }).click();
  await expect.element(editor).toBeVisible();
  expect(onChange).not.toHaveBeenCalled();
});

it("saves typing into one block and keeps the others' source", async () => {
  const onChange = vi.fn();
  await using _screen = await render(<Harness initial={source} onChange={onChange} />);
  await page.getByText("keep").click();
  await userEvent.keyboard("{End} it");
  await vi.waitFor(() =>
    expect(onChange).toHaveBeenLastCalledWith(
      "Intro with https://example.com\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- keep it\n",
    ),
  );
});

it("opens Jira wiki markup as Markdown source", async () => {
  await using _screen = await render(
    <WorkbenchTicketDescriptionEditor markdown={"h2. Goal\n"} jira onChange={() => {}} />,
  );
  await expect
    .element(page.getByRole("textbox", { name: "Description" }))
    .toHaveValue("h2. Goal\n");
});
