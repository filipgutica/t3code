import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";

import {
  buildMessageContext,
  reviewCommentContextId,
  reviewCommentContextReference,
} from "~/lib/composerContextRecords";
import {
  composerContextRecordsFromDraft,
  isWorkbenchTicketContextRecord,
  uploadedContextRecordFromDraft,
} from "./composerContextPresentation";
import { formatInlineContextReference } from "../lib/composerContextReferences";

describe("isWorkbenchTicketContextRecord", () => {
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
    expect(isWorkbenchTicketContextRecord(draftRecord)).toBe(true);
    expect(isWorkbenchTicketContextRecord(undefined)).toBe(false);
    const ordinaryRecord = composerContextRecordsFromDraft({
      terminalContexts: [],
      reviewComments: [{ ...ticketContext, id: "file-comment-1", sectionId: "file:a.ts" }],
    }).get(reviewCommentContextId("file-comment-1"));
    expect(isWorkbenchTicketContextRecord(ordinaryRecord)).toBe(false);
    expect(context?.records).toHaveLength(1);
    expect(context?.records[0]).toMatchObject({
      kind: "review-comment",
      sectionId: ticketContext.sectionId,
    });
  });
});

describe("composerContextRecordsFromDraft", () => {
  it("recovers the uploaded record when clipboard data points at an attachment already in the draft", () => {
    const file = {
      type: "file" as const,
      id: "file-1",
      name: "file.txt",
      mimeType: "text/plain",
      sizeBytes: 4,
      file: new File(["test"], "file.txt"),
      uploadedAttachmentId: "attachment-1",
    };
    const draftRecord = composerContextRecordsFromDraft({
      terminalContexts: [],
      files: [file],
    }).get("file_file-1");

    expect(draftRecord && uploadedContextRecordFromDraft(draftRecord)).toMatchObject({
      kind: "file",
      contextId: "file_file-1",
      attachmentId: "attachment-1",
    });
  });

  it("resolves each wire reference to its own backing draft even when producer ids collide", () => {
    const id = "same.id:1";
    const terminal = {
      id,
      threadId: ThreadId.make("t1"),
      terminalId: "default",
      terminalLabel: "Terminal",
      lineStart: 1,
      lineEnd: 1,
      text: "output",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const image = {
      type: "image" as const,
      id,
      name: "shot.png",
      mimeType: "image/png",
      sizeBytes: 1,
      file: new File(["x"], "shot.png"),
      previewUrl: "blob:shot",
    };
    const file = {
      type: "file" as const,
      id,
      name: "file.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      file: null,
    };
    const draftRecords = composerContextRecordsFromDraft({
      terminalContexts: [terminal],
      images: [image],
      files: [file],
    });
    const message = buildMessageContext({
      terminalContexts: [terminal],
      reviewComments: [],
      previewAnnotations: [],
      attachments: [
        { attachment: image, attachmentId: "uploaded-image" },
        { attachment: file, attachmentId: "uploaded-file" },
      ],
    })!;
    expect(draftRecords.size).toBe(3);
    for (const record of message.records) {
      expect(draftRecords.get(record.contextId)?.kind).toBe(record.kind);
    }
  });
});
