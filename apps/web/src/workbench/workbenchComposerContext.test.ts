import { describe, expect, it } from "vite-plus/test";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import {
  buildMessageContext,
  reviewCommentContextId,
  reviewCommentContextReference,
} from "../lib/composerContextRecords";
import { composerContextRecordsFromDraft } from "../components/composerContextPresentation";
import { formatInlineContextReference } from "../lib/composerContextReferences";
import { isWorkbenchTicketReviewComment } from "./workbenchTicketContext";

describe("Workbench ticket context presentation", () => {
  it("hides only the inline chip while retaining the canonical review context record", () => {
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
    const draftRecord = composerContextRecordsFromDraft({
      terminalContexts: [],
      reviewComments: [ticketContext],
    }).get(reviewCommentContextId(ticketContext.id));
    expect(
      draftRecord?.kind === "review-comment" && isWorkbenchTicketReviewComment(draftRecord.record),
    ).toBe(true);
    expect(isWorkbenchTicketReviewComment(undefined)).toBe(false);
    const ordinaryRecord = composerContextRecordsFromDraft({
      terminalContexts: [],
      reviewComments: [{ ...ticketContext, id: "file-comment-1", sectionId: "file:a.ts" }],
    }).get(reviewCommentContextId("file-comment-1"));
    expect(
      ordinaryRecord?.kind === "review-comment" &&
        isWorkbenchTicketReviewComment(ordinaryRecord.record),
    ).toBe(false);
    expect(context?.records).toHaveLength(1);
    expect(context?.records[0]).toMatchObject({
      kind: "review-comment",
      sectionId: ticketContext.sectionId,
    });
  });
});
