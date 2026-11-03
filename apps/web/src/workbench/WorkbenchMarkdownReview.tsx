import { cn } from "../lib/utils";
import { WorkbenchDescription } from "./WorkbenchDescription";
import type { MarkdownReview, WordDiffSegment } from "./markdownReview";

const SPACE = /^\s+$/u;

/** Removed words struck through, added words tinted; shared by the brief and the title. */
export function WorkbenchWordDiff({
  segments,
}: {
  readonly segments: ReadonlyArray<WordDiffSegment>;
}) {
  // Segments never reorder, so where each starts in the combined text identifies it.
  let offset = 0;
  const keyed = segments.map((segment, index) => {
    const key = `${segment.kind}:${offset}`;
    offset += segment.text.length;
    return { segment, key, afterRemoval: segments[index - 1]?.kind === "del" };
  });
  return keyed.map(({ segment, key, afterRemoval }) =>
    segment.kind === "same" || SPACE.test(segment.text) ? (
      <span key={key}>{segment.text}</span>
    ) : segment.kind === "del" ? (
      <del
        key={key}
        className="rounded-xs bg-destructive/10 text-muted-foreground decoration-destructive/70 dark:bg-destructive/20"
      >
        {segment.text}
      </del>
    ) : (
      <ins
        key={key}
        // A gap, not a space, so replaced words don't run together and copied text stays exact.
        className={cn(
          "rounded-xs bg-success/12 text-success-foreground no-underline dark:bg-success/20",
          afterRemoval && "ms-0.5",
        )}
      >
        {segment.text}
      </ins>
    ),
  );
}

// Changed blocks show their Markdown source, so links and markers read as written.
const changedBlockClassName =
  "max-w-[75ch] whitespace-pre-wrap border-l-2 border-info pl-3 text-sm leading-relaxed [overflow-wrap:anywhere]";

const wholeBlockClassName = "block rounded-sm border-l-2 border-info py-1 pl-3";

/** A document's review: unchanged blocks render as usual, changed blocks as a word diff. */
export function WorkbenchMarkdownReview({
  review,
  jira = false,
}: {
  readonly review: MarkdownReview;
  readonly jira?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-3">
      {review.entries.map((entry) => {
        switch (entry.kind) {
          case "unchanged":
            return <WorkbenchDescription key={entry.key} markdown={entry.source} jira={jira} />;
          case "changed":
            return (
              <div key={entry.key} className={changedBlockClassName}>
                <WorkbenchWordDiff segments={entry.words} />
              </div>
            );
          // A whole added or removed block has nothing to compare, so it renders as Markdown.
          case "added":
            return (
              <ins
                key={entry.key}
                className={cn(wholeBlockClassName, "bg-success/8 no-underline dark:bg-success/16")}
              >
                <WorkbenchDescription markdown={entry.block.source} jira={jira} />
              </ins>
            );
          case "removed":
            return (
              <del
                key={entry.key}
                className={cn(
                  wholeBlockClassName,
                  "bg-destructive/8 text-muted-foreground decoration-destructive/70 dark:bg-destructive/16",
                )}
              >
                <WorkbenchDescription markdown={entry.block.source} jira={jira} />
              </del>
            );
        }
      })}
    </div>
  );
}
