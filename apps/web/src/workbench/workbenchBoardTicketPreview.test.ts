import { describe, expect, it } from "vite-plus/test";

import { getWorkbenchBoardTicketPreview } from "./workbenchBoardTicketPreview";

describe("Workbench Board Ticket preview", () => {
  it("shows the current description when no generated summary exists", () => {
    const ticket = {
      title: "Welcome checklist",
      markdown:
        "## Goal\n\nBuild a **welcome checklist** with [setup steps](https://example.com/setup).\n\n## Acceptance criteria\n\n- [ ] Show the next step.",
      generatedSummary: {
        text: null,
        status: "error" as const,
        stale: false,
        error: "The free OpenCode model can't generate this summary.",
      },
    };
    expect(getWorkbenchBoardTicketPreview({ ticket })).toEqual({
      text: "Build a welcome checklist with setup steps. Show the next step.",
      source: "description",
      statusLabel: "Description excerpt",
    });
    expect(
      getWorkbenchBoardTicketPreview({
        ticket: {
          ...ticket,
          generatedSummary: { ...ticket.generatedSummary, status: "pending", error: null },
        },
      }),
    ).toEqual({
      text: "Build a welcome checklist with setup steps. Show the next step.",
      source: "description",
      statusLabel: "Generating summary…",
    });
  });

  it("keeps a stored summary even when it is stale after a failed refresh", () => {
    expect(
      getWorkbenchBoardTicketPreview({
        ticket: {
          title: "Welcome checklist",
          markdown: "A newer description.",
          generatedSummary: {
            text: "The earlier generated summary.",
            status: "error",
            stale: true,
            error: "Generation failed.",
          },
        },
      }),
    ).toEqual({
      text: "The earlier generated summary.",
      source: "summary",
      statusLabel: "Outdated summary",
    });
  });

  it("uses the current Jira description and a bounded plain-text excerpt", () => {
    const preview = getWorkbenchBoardTicketPreview({
      ticket: { title: "API check", markdown: "Old local description." },
      jiraIssue: {
        summary: "API check",
        description:
          "h2. Goal\n\n* Show {{POST /v4}} and [API docs|https://example.com]. " +
          "Explain the next action. ".repeat(20),
      },
    });
    expect(preview.source).toBe("description");
    expect(preview.text.startsWith("Show POST /v4 and API docs. Explain the next action.")).toBe(
      true,
    );
    expect(preview.text.length).toBeLessThanOrEqual(181);
    expect(preview.text.endsWith("…")).toBe(true);
  });

  it("distinguishes an unexcerptable description from an empty one", () => {
    expect(
      getWorkbenchBoardTicketPreview({
        ticket: { title: "Empty", markdown: "## Goal\n\n---\n\n```text\n```" },
      }),
    ).toEqual({
      text: "Description available",
      source: "description",
      statusLabel: null,
    });
    expect(
      getWorkbenchBoardTicketPreview({
        ticket: { title: "Empty", markdown: "  \n " },
      }),
    ).toEqual({
      text: "No description added yet",
      source: "description",
      statusLabel: null,
    });
  });
});
