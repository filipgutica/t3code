import type { ThreadId } from "@t3tools/contracts";

/** A reviewable Workbench document: a title and its Markdown body. */
export interface ReviewDocument {
  readonly title: string;
  readonly markdown: string;
}

/** Who writes a document. Agent and Ask for change writes await review; user writes end it. */
export type DocumentWriter =
  | { readonly kind: "agent"; readonly threadId: ThreadId }
  | { readonly kind: "askForChange" }
  | { readonly kind: "user" };

const sameDocument = (left: ReviewDocument, right: ReviewDocument) =>
  left.title === right.title && left.markdown === right.markdown;

/**
 * The review base after a write: the document as it was before the first
 * unreviewed agent or Ask for change write. A write from an empty body sets no
 * base, and a write that returns to the base ends the review.
 */
const nextReviewBase = ({
  writer,
  base,
  before,
  after,
}: {
  readonly writer: DocumentWriter;
  readonly base: ReviewDocument | null;
  readonly before: ReviewDocument;
  readonly after: ReviewDocument;
}): ReviewDocument | null => {
  if (sameDocument(before, after)) return base;
  if (writer.kind === "user") return null;
  const next =
    base ??
    (before.markdown.trim() === "" ? null : { title: before.title, markdown: before.markdown });
  return next !== null && sameDocument(next, after) ? null : next;
};

/** Who last changed a document's content, as stored beside it. */
export const documentProvenance = (writer: DocumentWriter) => ({
  updatedByThreadId: writer.kind === "agent" ? writer.threadId : null,
  updatedByAskForChange: writer.kind === "askForChange",
});

/**
 * A write's provenance and review state; a write that changes no content keeps all of it.
 * Any content change ends the accepted change, so it never feeds the next review.
 */
export const documentWrite = ({
  writer,
  before,
  after,
}: {
  readonly writer: DocumentWriter;
  readonly before: ReviewDocument &
    ReturnType<typeof documentProvenance> & {
      readonly reviewBase: ReviewDocument | null;
      readonly acceptedBase: ReviewDocument | null;
    };
  readonly after: ReviewDocument;
}) => {
  const contentChanged = !sameDocument(before, after);
  return {
    contentChanged,
    ...(contentChanged
      ? documentProvenance(writer)
      : {
          updatedByThreadId: before.updatedByThreadId,
          updatedByAskForChange: before.updatedByAskForChange,
        }),
    reviewBase: nextReviewBase({ writer, base: before.reviewBase, before, after }),
    acceptedBase: contentChanged ? null : before.acceptedBase,
  };
};

/** Accept keeps the base so the accepted change can be shown again; Undo drops it. */
export const resolvedReview = (resolution: "accept" | "undo", reviewBase: ReviewDocument) => ({
  reviewBase: null,
  acceptedBase: resolution === "accept" ? reviewBase : null,
});
