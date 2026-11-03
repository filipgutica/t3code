import type { ProjectId, WorkbenchOperationError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface MarkdownRewriteRequest {
  /** The native Project whose text generation model and checkout run the rewrite. */
  readonly projectId: ProjectId;
  /** Whole top-level Markdown blocks; the result replaces them. */
  readonly blocks: string;
  /** What the user selected inside `blocks`, or empty for all of them. */
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
