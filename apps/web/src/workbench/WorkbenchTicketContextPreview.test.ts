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
        "- kanalytics (primary): /worktrees/kanalytics",
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
        "- kanalytics (primary): /worktrees/kanalytics",
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
      jira: false,
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
      jira: false,
    });

    const emptyDescription = [
      "# No description",
      "",
      "Ticket type: Bug",
      "",
      "## Repository scope",
      "",
      "- repository (primary): /worktree",
    ].join("\n");
    expect(splitWorkbenchTicketContext(emptyDescription)).toEqual({
      headerMarkdown: emptyDescription,
      bodyMarkdown: "",
      jira: false,
    });
  });

  it("converts wiki text only when the preamble names a linked Jira issue", () => {
    const context = (jiraLines: ReadonlyArray<string>) =>
      splitWorkbenchTicketContext(
        [
          "# Ticket",
          "",
          "Ticket type: Story",
          ...jiraLines,
          "",
          "## Jira",
          "",
          "Use your Jira connector.",
          "",
          "## Repository scope",
          "",
          "- repository (primary): /worktree",
          "",
          "h2. Literal syntax",
          "",
          "The template uses {{name}} literally.",
        ].join("\n"),
      );

    const local = context([]);
    expect(local.headerMarkdown).toContain("Use your Jira connector.");
    expect(local.jira).toBe(false);
    expect(workbenchDescriptionMarkdown(local.bodyMarkdown, local.jira)).toBe(local.bodyMarkdown);

    const linked = context(["Jira issue: ABC-1 (https://example.atlassian.net/browse/ABC-1)"]);
    expect(linked.bodyMarkdown).toBe(local.bodyMarkdown);
    expect(linked.jira).toBe(true);
    const preview = workbenchDescriptionMarkdown(linked.bodyMarkdown, linked.jira);
    expect(preview).toContain("## Literal syntax");
    expect(preview).toContain("The template uses `name` literally.");
  });
});
