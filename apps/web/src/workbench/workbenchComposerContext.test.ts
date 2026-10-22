import { describe, expect, it } from "vite-plus/test";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import {
  buildMessageContext,
  reviewCommentContextId,
  reviewCommentContextReference,
} from "../lib/composerContextRecords";
import { formatInlineContextReference } from "../lib/composerContextReferences";

describe("Workbench ticket context presentation", () => {
  it("retains the canonical Ticket review context record and parses its reference", () => {
    const ticketContext = {
      id: "workbench-ticket:ticket-1",
      sectionId: "workbench-ticket:ticket-1",
      sectionTitle: "Agent Workbench ticket",
      filePath: "Fix the onboarding flow",
      startIndex: 0,
      endIndex: 1,
      rangeLabel: "Ticket context",
      text: "Fix the onboarding flow",
      diff: "# Fix the onboarding flow",
      fenceLanguage: "markdown",
    };
    const context = buildMessageContext({
      terminalContexts: [],
      reviewComments: [ticketContext],
      previewAnnotations: [],
    });

    const prompt = formatInlineContextReference(reviewCommentContextReference(ticketContext));
    expect(collectComposerContextReferences(prompt)).toEqual([
      expect.objectContaining({
        kind: "review-comment",
        contextId: reviewCommentContextId(ticketContext.id),
      }),
    ]);
    expect(context?.records).toHaveLength(1);
    expect(context?.records[0]).toMatchObject({
      kind: "review-comment",
      sectionId: ticketContext.sectionId,
    });
  });
});
