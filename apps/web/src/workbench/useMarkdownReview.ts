import { useState } from "react";

import { describeMarkdownReview, diffMarkdownBlocks, diffWords } from "./markdownReview";

/** How an Accept or Undo ended; a conflict changed nothing because a newer edit arrived. */
export type MarkdownReviewOutcome =
  | { readonly kind: "done" }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

/**
 * The review of a titled Markdown document against the text before its unreviewed edits.
 * `base` is null when nothing awaits review. Undo and Accept act on every change since then.
 */
export function useMarkdownReview({
  base,
  title,
  markdown,
  onAccept,
  onUndo,
}: {
  readonly base: { readonly title: string; readonly markdown: string } | null;
  readonly title: string;
  readonly markdown: string;
  readonly onAccept: () => Promise<MarkdownReviewOutcome>;
  readonly onUndo: () => Promise<MarkdownReviewOutcome>;
}) {
  const [hidden, setHidden] = useState(false);
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
    if (outcome.kind === "done") setHidden(false);
    else if (outcome.kind === "conflict" && reviewed !== null) {
      setConflict({ message: outcome.message, base: reviewed });
    } else if (outcome.kind !== "conflict") setError(outcome.message);
  };

  if (base === null) return { review: null, diffShown: false };
  const titleChanged = base.title !== title;
  const blocks = diffMarkdownBlocks(base.markdown, markdown);
  const diffShown = !hidden;
  return {
    diffShown,
    review: {
      blocks,
      // A title too long to diff word by word shows as its current text.
      titleWords: titleChanged ? diffWords(base.title, title) : null,
      summary: describeMarkdownReview({ titleChanged, review: blocks }),
      diffShown,
      pending,
      conflict:
        conflict !== null &&
        conflict.base.title === base.title &&
        conflict.base.markdown === base.markdown
          ? conflict.message
          : null,
      error,
      toggleDiff: () => setHidden((value) => !value),
      showDiff: () => setHidden(false),
      accept: () => void run("accept"),
      undo: () => void run("undo"),
    },
  };
}
