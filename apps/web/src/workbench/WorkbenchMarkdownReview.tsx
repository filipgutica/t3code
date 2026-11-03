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
  const keyed = segments.map((segment) => {
    const key = `${segment.kind}:${offset}`;
    offset += segment.text.length;
    return { segment, key };
  });
  return keyed.map(({ segment, key }) =>
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
        className="rounded-xs bg-success/12 text-success-foreground no-underline dark:bg-success/20"
      >
        {segment.text}
      </ins>
    ),
  );
}

// Changed blocks show their Markdown source, so links and markers read as written.
const changedBlockClassName =
  "max-w-[75ch] whitespace-pre-wrap border-l-2 border-info pl-3 text-sm leading-relaxed [overflow-wrap:anywhere]";

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
          case "added":
          case "removed":
            return (
              <div key={entry.key} className={changedBlockClassName}>
                <WorkbenchWordDiff
                  segments={[
                    { kind: entry.kind === "added" ? "ins" : "del", text: entry.block.source },
                  ]}
                />
              </div>
            );
        }
      })}
    </div>
  );
}
