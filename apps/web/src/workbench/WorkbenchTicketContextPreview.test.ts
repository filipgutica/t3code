import { describe, expect, it } from "vite-plus/test";

import { workbenchDescriptionMarkdown } from "./workbenchDescription.logic";
import { splitWorkbenchTicketContext } from "./WorkbenchTicketContextPreview";

describe("Workbench Ticket context preview", () => {
  it("keeps the generated Markdown preamble separate from Jira wiki content", () => {
    const { headerMarkdown, bodyMarkdown } = splitWorkbenchTicketContext(
      [
        "# Fix the request validation",
        "",
        "Ticket type: Bug",
        "",
        "## Repository scope",
        "",
        "- kanalytics (primary) — /worktrees/kanalytics",
        "",
        "h2. Root cause",
        "",
        "# Validate filters",
        "",
        "Request uses {{POST /v1}}.",
        "",
        "{code:json}",
        '{"entity":"service"}',
        "{code}",
      ].join("\n"),
    );

    expect(headerMarkdown).toBe(
      [
        "# Fix the request validation",
        "",
        "Ticket type: Bug",
        "",
        "## Repository scope",
        "",
        "- kanalytics (primary) — /worktrees/kanalytics",
      ].join("\n"),
    );
    expect(workbenchDescriptionMarkdown(headerMarkdown, false)).toContain(
      "# Fix the request validation",
    );
    expect(workbenchDescriptionMarkdown(headerMarkdown, false)).toContain("## Repository scope");
    expect(bodyMarkdown).toContain("h2. Root cause");
    expect(workbenchDescriptionMarkdown(bodyMarkdown, true)).toContain("## Root cause");
    expect(workbenchDescriptionMarkdown(bodyMarkdown, true)).toContain("1. Validate filters");
    expect(workbenchDescriptionMarkdown(bodyMarkdown, true)).toContain("`POST /v1`");
    expect(workbenchDescriptionMarkdown(bodyMarkdown, true)).toContain("```json");
    expect(workbenchDescriptionMarkdown(bodyMarkdown, true)).toContain('{"entity":"service"}');
  });

  it("preserves ordinary Markdown without a generated Ticket preamble", () => {
    const markdown = "# Existing context\n\n**Body**\n\n- item";
    expect(splitWorkbenchTicketContext(markdown)).toEqual({
      headerMarkdown: markdown,
      bodyMarkdown: "",
    });
    expect(workbenchDescriptionMarkdown(markdown, false)).toBe(markdown);
  });

  it("handles an empty repository list and an empty description", () => {
    const emptyRepository = [
      "# Empty repository scope",
      "",
      "Ticket type: Story",
      "",
      "## Repository scope",
      "",
      "",
      "h2. Description",
    ].join("\n");
    expect(splitWorkbenchTicketContext(emptyRepository)).toEqual({
      headerMarkdown: [
        "# Empty repository scope",
        "",
        "Ticket type: Story",
        "",
        "## Repository scope",
        "",
      ].join("\n"),
      bodyMarkdown: "h2. Description",
    });

    const emptyDescription = [
      "# No description",
      "",
      "Ticket type: Bug",
      "",
      "## Repository scope",
      "",
      "- repository (primary) — /worktree",
    ].join("\n");
    expect(splitWorkbenchTicketContext(emptyDescription)).toEqual({
      headerMarkdown: emptyDescription,
      bodyMarkdown: "",
    });
  });

  it("preserves wiki-looking local text while converting Jira text", () => {
    const { bodyMarkdown } = splitWorkbenchTicketContext(
      [
        "# Local Ticket",
        "",
        "Ticket type: Story",
        "",
        "## Repository scope",
        "",
        "- repository (primary) — /worktree",
        "",
        "h2. Literal syntax",
        "",
        "The template uses {{name}} literally.",
      ].join("\n"),
    );

    expect(workbenchDescriptionMarkdown(bodyMarkdown, false)).toBe(bodyMarkdown);
    expect(workbenchDescriptionMarkdown(bodyMarkdown, true)).toContain("## Literal syntax");
    expect(workbenchDescriptionMarkdown(bodyMarkdown, true)).toContain(
      "The template uses `name` literally.",
    );
  });
});
