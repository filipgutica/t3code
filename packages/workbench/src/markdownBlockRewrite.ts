import { WorkbenchOperationError, type ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { MarkdownRewriteHost } from "./MarkdownRewriteHost.ts";

// Inline syntax, entities, and any whitespace but single spaces render differently from their
// source, so a source match may not be the selection.
const INLINE_MARKUP = /[*_`[\]<>\\~&]|[^\S ]| {2}/;

/**
 * Rewrites `markdown.slice(start, end)`, which must still equal `blockSource`. A selection
 * found exactly once in plain blocks is rewritten alone, so the model cannot touch the rest;
 * otherwise the whole blocks are rewritten with the selection as a hint.
 */
export const rewriteMarkdownBlocks = Effect.fn("MarkdownBlockRewrite.rewrite")(function* (input: {
  readonly projectId: ProjectId;
  readonly markdown: string;
  readonly start: number;
  readonly end: number;
  readonly blockSource: string;
  readonly selectedText: string;
  readonly instruction: string;
  readonly context: string;
}) {
  if (
    input.start > input.end ||
    input.markdown.slice(input.start, input.end) !== input.blockSource
  ) {
    return yield* new WorkbenchOperationError({
      code: "ask_for_change_invalid",
      message: "The selected text no longer matches the document. Select it again.",
    });
  }
  if (input.blockSource.trim() === "") {
    return yield* new WorkbenchOperationError({
      code: "ask_for_change_invalid",
      message: "Select the text to change.",
    });
  }
  const host = yield* MarkdownRewriteHost;
  const block = input.blockSource;
  const needle = input.selectedText.trim();
  const at = needle === "" || INLINE_MARKUP.test(block) ? -1 : block.indexOf(needle);
  let rewritten: string;
  if (at !== -1 && at === block.lastIndexOf(needle)) {
    const replacement = yield* host.rewrite({
      projectId: input.projectId,
      blocks: needle,
      selectedText: "",
      instruction: input.instruction,
      // The surrounding blocks come first, so a long document context cannot truncate them.
      context: `${block}\n\n${input.context}`,
    });
    rewritten = `${block.slice(0, at)}${replacement.trim()}${block.slice(at + needle.length)}`;
  } else {
    rewritten = yield* host.rewrite({
      projectId: input.projectId,
      blocks: block,
      selectedText: input.selectedText,
      instruction: input.instruction,
      context: input.context,
    });
  }
  return `${input.markdown.slice(0, input.start)}${rewritten.trim()}${input.markdown.slice(input.end)}`.trim();
});
