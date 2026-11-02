import { describe, expect, it } from "vite-plus/test";
import { workbenchDescriptionMarkdown } from "./workbenchDescription.logic";

describe("Workbench description preview", () => {
  it("preserves Markdown and local source", () => {
    const markdown = "## Goal\n\n**Bold** and `code`\n\n- Task";
    expect(workbenchDescriptionMarkdown(markdown, false)).toBe(markdown);
    expect(workbenchDescriptionMarkdown(markdown, true)).toBe(markdown);
  });
  it("previews Jira headings, ordered lists, links and inline code as Markdown", () => {
    expect(
      workbenchDescriptionMarkdown(
        "h2. Observed behaviour\n\n# Sends {{POST /v4}}.\n# See [request|https://example.com].",
        true,
      ),
    ).toBe("## Observed behaviour\n\n1. Sends `POST /v4`.\n1. See [request](https://example.com).");
  });
  it("leaves code block content untouched", () => {
    expect(workbenchDescriptionMarkdown("{code:json}\n# raw {{value}}\n{code}", true)).toBe(
      "```json\n# raw {{value}}\n```",
    );
  });
});
