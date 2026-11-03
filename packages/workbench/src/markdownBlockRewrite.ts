import { WorkbenchOperationError, type ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { MarkdownRewriteHost } from "./MarkdownRewriteHost.ts";

/**
 * Rewrites `markdown.slice(start, end)`, which must still equal `blockSource`.
 * Every byte outside that range is kept; only the document's edges are trimmed.
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
  const replacement = yield* host.rewrite({
    projectId: input.projectId,
    blocks: input.blockSource,
    selectedText: input.selectedText,
    instruction: input.instruction,
    context: input.context,
  });
  return `${input.markdown.slice(0, input.start)}${replacement.trim()}${input.markdown.slice(input.end)}`.trim();
});
