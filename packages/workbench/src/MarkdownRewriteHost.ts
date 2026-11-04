import type { ProjectId, WorkbenchOperationError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface MarkdownRewriteRequest {
  /** The native Project whose text generation model and checkout run the rewrite. */
  readonly projectId: ProjectId;
  /** The Markdown to rewrite: whole top-level blocks, or one selection inside them. The result replaces it. */
  readonly blocks: string;
  /** What the user selected inside `blocks`, or empty when `blocks` is the whole target. */
  readonly selectedText: string;
  readonly instruction: string;
  /** The document's title and goal, so the rewrite fits it. */
  readonly context: string;
}

/** The application supplies its configured text writer without exposing it to document storage. */
export class MarkdownRewriteHost extends Context.Service<
  MarkdownRewriteHost,
  {
    readonly rewrite: (
      request: MarkdownRewriteRequest,
    ) => Effect.Effect<string, WorkbenchOperationError>;
  }
>()("@t3tools/workbench/MarkdownRewriteHost") {}
