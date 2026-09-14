import { describe, expect, it } from "@effect/vitest";

import { resolveWorkbenchReviewCommentTitle } from "./workbenchComposerTitle";

describe("Workbench composer titles", () => {
  const ticketComment = {
    sectionId: "workbench-ticket:ticket-one",
    text: " Streamline ticket threads ",
    filePath: "Ticket title",
    sectionTitle: "Agent Workbench ticket",
  };

  it("uses the attached ticket summary", () => {
    expect(resolveWorkbenchReviewCommentTitle(ticketComment)).toBe("Streamline ticket threads");
  });

  it("handles Jira ticket context", () => {
    expect(
      resolveWorkbenchReviewCommentTitle({
        ...ticketComment,
        sectionId: "workbench-ticket:jira:ticket-one",
      }),
    ).toBe("Streamline ticket threads");
  });

  it("falls back to the ticket title and then the context label", () => {
    expect(resolveWorkbenchReviewCommentTitle({ ...ticketComment, text: " " })).toBe(
      "Ticket title",
    );
    expect(resolveWorkbenchReviewCommentTitle({ ...ticketComment, text: "", filePath: " " })).toBe(
      "Agent Workbench ticket",
    );
  });

  it("leaves native review comment titles to upstream", () => {
    expect(
      resolveWorkbenchReviewCommentTitle({ ...ticketComment, sectionId: "file:src/main.ts" }),
    ).toBeNull();
  });
});
