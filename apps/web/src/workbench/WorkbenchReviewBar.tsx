import type { ThreadId } from "@t3tools/contracts";
import { CheckIcon, EyeIcon, EyeOffIcon, TriangleAlertIcon, Undo2Icon } from "lucide-react";

import { RelativeTime } from "../components/RelativeTime";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import type { useMarkdownReview } from "./useMarkdownReview";
import type { WorkbenchProvenanceSource } from "./WorkbenchReferences";
import { WorkbenchThreadHoverPreview } from "./WorkbenchThreadHoverPreview";

type MarkdownReviewState = NonNullable<ReturnType<typeof useMarkdownReview>["review"]>;

/** Who made the edit under review: the Thread with its hover card, or Ask for change. */
function ReviewSource({
  source,
  onOpenThread,
}: {
  readonly source: WorkbenchProvenanceSource;
  readonly onOpenThread: ((threadId: ThreadId) => void) | undefined;
}) {
  if (source.kind === "askForChange") return "Ask for change";
  return (
    <WorkbenchThreadHoverPreview
      environmentId={source.environmentId}
      threadId={source.threadId}
      title={source.title}
      shell={source.shell}
    >
      {onOpenThread === undefined ? (
        <span className="font-medium text-foreground">{source.title}</span>
      ) : (
        <button
          type="button"
          className="font-medium text-foreground underline-offset-4 hover:underline"
          onClick={() => onOpenThread(source.threadId)}
        >
          {source.title}
        </button>
      )}
    </WorkbenchThreadHoverPreview>
  );
}

/**
 * Undo and Accept for every change since the last review, with who made it, when, what changed
 * and, after an Undo that met a newer edit, why nothing was undone. `className` places the bar.
 */
export function WorkbenchReviewBar({
  review,
  source,
  editedAt,
  permitted,
  onOpenThread,
  disabled = false,
  className,
}: {
  readonly review: MarkdownReviewState;
  readonly source: WorkbenchProvenanceSource | null;
  /** Opens the editing Thread, so the person can talk about its change. */
  readonly onOpenThread?: ((threadId: ThreadId) => void) | undefined;
  /** When the title or brief last changed; omitted when unknown. */
  readonly editedAt: string | null;
  /** A connection that may not run Undo or Accept sees the review without them. */
  readonly permitted: { readonly accept: boolean; readonly undo: boolean };
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const { summary, conflict, error } = review;
  return (
    <div
      role="region"
      aria-label="Review changes"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 text-xs",
        conflict ? "bg-warning/8 dark:bg-warning/16" : "bg-info/8 dark:bg-info/16",
        className,
      )}
    >
      {conflict ? (
        <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-warning-foreground" />
      ) : null}
      <p role="status" className="min-w-0 flex-1 text-muted-foreground">
        {conflict ? (
          <>
            <span className="font-semibold text-foreground">Nothing was undone.</span> {conflict}
          </>
        ) : (
          <>
            <span className="font-semibold text-foreground">{summary.heading}</span>
            {source === null ? null : (
              <>
                {" from "}
                <ReviewSource source={source} onOpenThread={onOpenThread} />
              </>
            )}
            {editedAt === null ? null : (
              <>
                {" · "}
                <time dateTime={editedAt}>
                  <RelativeTime timestamp={editedAt} />
                </time>
              </>
            )}
            {summary.detail === null ? null : ` · ${summary.detail}`}
          </>
        )}
        {error ? (
          <span role="alert" className="block text-destructive">
            {error}
          </span>
        ) : null}
      </p>
      <ReviewBarActions review={review} permitted={permitted} disabled={disabled} />
    </div>
  );
}

/** Show diff or Hide, then Undo and Accept, which an accepted change does not offer. */
function ReviewBarActions({
  review,
  permitted,
  disabled,
}: {
  readonly review: MarkdownReviewState;
  readonly permitted: { readonly accept: boolean; readonly undo: boolean };
  readonly disabled: boolean;
}) {
  const busy = disabled || review.pending !== null;
  return (
    <div className="flex shrink-0 items-center gap-2">
      {review.accepted ? (
        <Button size="xs" type="button" variant="ghost" onClick={review.toggleDiff}>
          <EyeOffIcon /> Hide
        </Button>
      ) : null}
      {review.diffShown ? null : (
        <Button size="xs" type="button" variant="ghost" onClick={review.showDiff}>
          <EyeIcon /> Show diff
        </Button>
      )}
      {permitted.undo && !review.accepted ? (
        <Button size="xs" type="button" variant="outline" disabled={busy} onClick={review.undo}>
          <Undo2Icon /> Undo
        </Button>
      ) : null}
      {permitted.accept && !review.accepted ? (
        <Button size="xs" type="button" disabled={busy} onClick={review.accept}>
          <CheckIcon /> Accept
        </Button>
      ) : null}
    </div>
  );
}
