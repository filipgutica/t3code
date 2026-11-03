import { CheckIcon, EyeIcon, TriangleAlertIcon, Undo2Icon } from "lucide-react";

import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import type { useMarkdownReview } from "./useMarkdownReview";

type MarkdownReviewState = NonNullable<ReturnType<typeof useMarkdownReview>["review"]>;

/**
 * Undo and Accept for every change since the last review, with what changed and, after an
 * Undo that met a newer edit, why nothing was undone. `className` places the bar.
 */
export function WorkbenchReviewBar({
  review,
  permitted,
  disabled = false,
  className,
}: {
  readonly review: MarkdownReviewState;
  /** A connection that may not run Undo or Accept sees the review without them. */
  readonly permitted: { readonly accept: boolean; readonly undo: boolean };
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const { summary, diffShown, pending, conflict, error } = review;
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
            {diffShown
              ? summary.detail === null
                ? null
                : ` · ${summary.detail}`
              : " · diff hidden. Click the badge to show it again."}
          </>
        )}
        {error ? (
          <span role="alert" className="block text-destructive">
            {error}
          </span>
        ) : null}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {diffShown ? null : (
          <Button size="xs" type="button" variant="ghost" onClick={review.showDiff}>
            <EyeIcon /> Show diff
          </Button>
        )}
        {permitted.undo ? (
          <Button
            size="xs"
            type="button"
            variant="outline"
            disabled={disabled || pending !== null}
            onClick={review.undo}
          >
            <Undo2Icon /> Undo
          </Button>
        ) : null}
        {permitted.accept ? (
          <Button
            size="xs"
            type="button"
            disabled={disabled || pending !== null}
            onClick={review.accept}
          >
            <CheckIcon /> Accept
          </Button>
        ) : null}
      </div>
    </div>
  );
}
