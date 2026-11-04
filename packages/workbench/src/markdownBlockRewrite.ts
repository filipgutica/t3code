import { WorkbenchOperationError, type ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { MarkdownRewriteHost } from "./MarkdownRewriteHost.ts";

// Inline syntax, entities, URLs (shown as short chips), NUL, and any whitespace but single
// spaces render differently from their source, so a source match may not be the selection.
const INLINE_MARKUP = /[*_`[\]<>\\~&\0]|[^\S ]| {2}|:\/\/|www\./i;

const WORD_START = /^[\p{L}\p{N}_'’]/u;
const WORD_END = /[\p{L}\p{N}_'’]$/u;
const WORD_TAIL = /[\p{L}\p{N}_'’]+$/u;
const WORD_HEAD = /^[\p{L}\p{N}_'’]+/u;

/** Widens `block.slice(from, to)` to whole words, so a selection that cuts a word rewrites all of it. */
const wholeWords = (block: string, from: number, to: number) => {
  const before = block.slice(0, from);
  const after = block.slice(to);
  const selected = block.slice(from, to);
  return {
    from: from - (WORD_START.test(selected) ? (WORD_TAIL.exec(before)?.[0].length ?? 0) : 0),
    to: to + (WORD_END.test(selected) ? (WORD_HEAD.exec(after)?.[0].length ?? 0) : 0),
  };
};

/** Drops blank lines around `text` but keeps leading indentation, which can make a code block. */
const trimBlankLines = (text: string) => text.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();

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
    const { from, to } = wholeWords(block, at, at + needle.length);
    const replacement = yield* host.rewrite({
      projectId: input.projectId,
      blocks: block.slice(from, to),
      selectedText: "",
      instruction: input.instruction,
      // The surrounding blocks come first, so a long document context cannot truncate them.
      context: `${block}\n\n${input.context}`,
    });
    rewritten = `${block.slice(0, from)}${replacement.trim()}${block.slice(to)}`;
  } else {
    rewritten = yield* host.rewrite({
      projectId: input.projectId,
      blocks: block,
      selectedText: input.selectedText,
      instruction: input.instruction,
      context: input.context,
    });
  }
  return trimBlankLines(
    `${input.markdown.slice(0, input.start)}${trimBlankLines(rewritten)}${input.markdown.slice(input.end)}`,
  );
});
