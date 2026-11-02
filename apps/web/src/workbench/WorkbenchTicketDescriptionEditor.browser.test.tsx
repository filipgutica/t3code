import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { WorkbenchTicketDescriptionEditor } from "./WorkbenchTicketDescriptionEditor";

const source = "Intro with https://example.com\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n* keep\n";

function Harness({
  initial,
  autoFocus,
  onChange,
}: {
  initial: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  const [markdown, setMarkdown] = useState(initial);
  return (
    <WorkbenchTicketDescriptionEditor
      autoFocus={autoFocus ?? false}
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
  expect(editor.element().textContent).toContain("Intro with");
  // The bare URL shows as the Reference chip the saved description uses.
  await expect.element(page.getByRole("link", { name: "example.com" })).toBeVisible();

  await page.getByRole("button", { name: "Markdown" }).click();
  await expect.element(page.getByRole("textbox", { name: "Description" })).toHaveValue(source);
  await page.getByRole("button", { name: "Rich text" }).click();
  await expect.element(editor).toBeVisible();
  expect(onChange).not.toHaveBeenCalled();
});

it("puts the caret at the start of the description when asked", async () => {
  const onChange = vi.fn();
  await using _screen = await render(
    <Harness initial="Draft brief" autoFocus onChange={onChange} />,
  );
  await expect.element(page.getByRole("textbox", { name: "Description" })).toHaveFocus();
  await userEvent.keyboard("New ");
  expect(onChange).toHaveBeenLastCalledWith("New Draft brief");
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

it("ignores typing while disabled", async () => {
  const onChange = vi.fn();
  await using _screen = await render(
    <WorkbenchTicketDescriptionEditor
      markdown="Draft brief"
      jira={false}
      disabled
      onChange={onChange}
    />,
  );
  await page.getByText("Draft brief").click();
  await userEvent.keyboard(" more");
  expect(onChange).not.toHaveBeenCalled();
  await expect
    .element(page.getByRole("textbox", { name: "Description" }))
    .toHaveAttribute("contenteditable", "false");
});

it("turns typed Markdown links and URLs into Reference chips", async () => {
  const onChange = vi.fn();
  await using _screen = await render(<Harness initial="Plan" onChange={onChange} />);
  await page.getByText("Plan").click();
  await userEvent.keyboard("{End} [[the plan](/Users/me/plan.md) and https://example.com/spec ");
  await expect.element(page.getByRole("button", { name: "the plan" })).toBeVisible();
  await expect.element(page.getByRole("link", { name: "example.com" })).toBeVisible();
  expect(onChange).toHaveBeenLastCalledWith(
    "Plan [the plan](/Users/me/plan.md) and https://example.com/spec",
  );
});

it("pastes Markdown as rich text", async () => {
  const onChange = vi.fn();
  await using _screen = await render(<Harness initial="Intro" onChange={onChange} />);
  await page.getByText("Intro").click();
  await userEvent.keyboard("{End}");
  const data = new DataTransfer();
  data.setData("text/plain", "\n\n- Run `vp test`\n- See [plan](/Users/me/plan.md)");
  page
    .getByRole("textbox", { name: "Description" })
    .element()
    .dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  await expect.element(page.getByRole("button", { name: "plan" })).toBeVisible();
  expect(onChange).toHaveBeenLastCalledWith(
    "Intro\n\n- Run `vp test`\n- See [plan](/Users/me/plan.md)",
  );
});

it.each([
  ["keeps the spaces around a pasted phrase", "ab", "{End}{ArrowLeft}", " hello ", "a hello b"],
  [
    "keeps a pasted code block whole",
    "Intro",
    "{End}",
    "```ts\na()\n```",
    "Intro\n\n```ts\na()\n```",
  ],
  [
    "keeps a pasted table as source",
    "Intro",
    "{End}",
    "| a |\n| - |\n| 1 |",
    "Intro\n\n| a |\n| - |\n| 1 |",
  ],
])("%s", async (_name, initial, caret, pasted, saved) => {
  const onChange = vi.fn();
  await using _screen = await render(<Harness initial={initial} onChange={onChange} />);
  await page.getByText(initial).click();
  await userEvent.keyboard(caret);
  const data = new DataTransfer();
  data.setData("text/plain", pasted);
  page
    .getByRole("textbox", { name: "Description" })
    .element()
    .dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  expect(onChange).toHaveBeenLastCalledWith(saved);
});

it("pastes a URL into inline code as text", async () => {
  const onChange = vi.fn();
  await using _screen = await render(<Harness initial="Run `example` now" onChange={onChange} />);
  await page.getByText("example", { exact: true }).click();
  const data = new DataTransfer();
  data.setData("text/plain", "https://example.com");
  page
    .getByRole("textbox", { name: "Description" })
    .element()
    .dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  expect(onChange.mock.lastCall?.[0]).toMatch(/^Run `[a-z]*https:\/\/example\.com[a-z]*` now$/);
});

it("opens a code block on a fence and leaves it after two blank lines", async () => {
  const onChange = vi.fn();
  await using _screen = await render(<Harness initial="Intro" onChange={onChange} />);
  await page.getByText("Intro").click();
  await userEvent.keyboard("{End}{Enter}```ts{Enter}const a = 1;{Enter}{Enter}{Enter}After");
  expect(onChange).toHaveBeenLastCalledWith("Intro\n\n```ts\nconst a = 1;\n```\n\nAfter");
});
