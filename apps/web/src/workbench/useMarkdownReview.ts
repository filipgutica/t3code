import { useState } from "react";

import { describeMarkdownReview, diffMarkdownBlocks, diffWords } from "./markdownReview";

/** How an Accept or Undo ended; a conflict changed nothing because a newer edit arrived. */
export type MarkdownReviewOutcome =
  | { readonly kind: "done" }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

type ReviewBase = { readonly title: string; readonly markdown: string };

/**
 * The review of a titled Markdown document against the text before its unreviewed edits.
 * `base` is null when nothing awaits review. Undo and Accept act on every change since then.
 * With `onHideAccepted`, `base` is an accepted change being shown: read-only, hidden by it.
 */
export function useMarkdownReview({
  base,
  title,
  markdown,
  onAccept,
  onUndo,
  onHideAccepted,
}: {
  readonly base: ReviewBase | null;
  readonly title: string;
  readonly markdown: string;
  readonly onAccept: () => Promise<MarkdownReviewOutcome>;
  readonly onUndo: () => Promise<MarkdownReviewOutcome>;
  readonly onHideAccepted?: (() => void) | undefined;
}) {
  // Hidden only for the base it was hidden on, so a later review starts with its diff shown.
  const [hiddenFor, setHiddenFor] = useState<ReviewBase | null>(null);
  const [pending, setPending] = useState<"accept" | "undo" | null>(null);
  // Kept with the base it met, so a later review of other edits does not repeat it.
  const [conflict, setConflict] = useState<{
    readonly message: string;
    readonly base: { readonly title: string; readonly markdown: string };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: "accept" | "undo") => {
    setPending(action);
    setConflict(null);
    setError(null);
    const reviewed = base;
    const outcome = await (action === "accept" ? onAccept() : onUndo());
    setPending(null);
    // Undo can restore the base an agent edits again, so a resolved review forgets its hiding.
    if (outcome.kind === "done") setHiddenFor(null);
    else if (outcome.kind === "conflict") {
      if (reviewed !== null) setConflict({ message: outcome.message, base: reviewed });
    } else if (outcome.kind === "failed") setError(outcome.message);
  };

  const accepted = onHideAccepted !== undefined;
  // However a review ends, here or on another client, the next one starts with its diff shown.
  if (hiddenFor !== null && (base === null || accepted)) setHiddenFor(null);
  if (base === null) return { review: null, diffShown: false };
  const titleChanged = base.title !== title;
  const blocks = diffMarkdownBlocks(base.markdown, markdown);
  const diffShown =
    accepted ||
    hiddenFor === null ||
    hiddenFor.title !== base.title ||
    hiddenFor.markdown !== base.markdown;
  return {
    diffShown,
    review: {
      accepted,
      blocks,
      // A title too long to diff word by word shows as its current text.
      titleWords: titleChanged ? diffWords(base.title, title) : null,
      summary: describeMarkdownReview({ titleChanged, review: blocks, accepted }),
      diffShown,
      pending,
      conflict:
        conflict !== null &&
        conflict.base.title === base.title &&
        conflict.base.markdown === base.markdown
          ? conflict.message
          : null,
      error,
      toggleDiff: onHideAccepted ?? (() => setHiddenFor(diffShown ? base : null)),
      showDiff: () => setHiddenFor(null),
      accept: () => void run("accept"),
      undo: () => void run("undo"),
    },
  };
}
