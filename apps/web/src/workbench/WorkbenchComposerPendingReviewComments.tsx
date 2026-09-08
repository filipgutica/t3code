import { ChevronDown, MessageCircle, X } from "lucide-react";

import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "../components/composerInlineChip";
import { ComposerPendingReviewComments } from "../components/chat/ComposerPendingReviewComments";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import type { ReviewCommentContext } from "../reviewCommentContext";
import { cn } from "../lib/utils";
import { WorkbenchTicketContextPreview } from "./WorkbenchTicketContextPreview";

function isWorkbenchTicketReviewComment(comment: ReviewCommentContext): boolean {
  return comment.sectionId.startsWith("workbench-ticket:");
}

function WorkbenchTicketReviewComment({
  comment,
  onRemove,
}: {
  readonly comment: ReviewCommentContext;
  readonly onRemove: (commentId: string) => void;
}) {
  const label = `${comment.filePath} ${comment.rangeLabel}`;
  return (
    <span className={cn(COMPOSER_INLINE_CHIP_CLASS_NAME, "pr-1")}>
      <Popover>
        <PopoverTrigger
          aria-label={`Inspect context: ${label}`}
          className="inline-flex min-w-0 items-center gap-1 rounded-sm text-left outline-none hover:text-primary focus-visible:ring-1 focus-visible:ring-ring"
        >
          <MessageCircle className={cn(COMPOSER_INLINE_CHIP_ICON_CLASS_NAME, "size-3.5")} />
          <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{label}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </PopoverTrigger>
        <PopoverPopup side="top" align="start" className="w-[min(36rem,calc(100vw-2rem))]">
          <div
            tabIndex={0}
            role="region"
            aria-label={`Context contents: ${label}`}
            className="max-h-[min(60vh,32rem)] min-w-0 space-y-3 overflow-y-auto select-text"
          >
            <div className="space-y-1">
              <PopoverTitle>{comment.sectionTitle}</PopoverTitle>
              <p className="break-words text-xs text-muted-foreground">{label}</p>
            </div>
            {comment.diff && comment.text && comment.text !== comment.filePath ? (
              <p className="whitespace-pre-wrap break-words text-sm">{comment.text}</p>
            ) : null}
            {comment.diff ? (
              comment.fenceLanguage === "markdown" ? (
                <WorkbenchTicketContextPreview
                  markdown={comment.diff}
                  jira={comment.sectionId.startsWith("workbench-ticket:jira:")}
                />
              ) : (
                <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 font-mono text-xs">
                  {comment.diff}
                </pre>
              )
            ) : comment.text ? (
              <p className="whitespace-pre-wrap break-words text-sm">{comment.text}</p>
            ) : null}
          </div>
        </PopoverPopup>
      </Popover>
      <button
        type="button"
        aria-label={`Remove comment on ${label}`}
        className={COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRemove(comment.id);
        }}
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

export function WorkbenchComposerPendingReviewComments({
  comments,
  onRemove,
  className,
}: {
  readonly comments: ReadonlyArray<ReviewCommentContext>;
  readonly onRemove: (commentId: string) => void;
  readonly className?: string;
}) {
  if (comments.length === 0) return null;
  if (!comments.some(isWorkbenchTicketReviewComment)) {
    return (
      <ComposerPendingReviewComments
        comments={comments}
        onRemove={onRemove}
        {...(className !== undefined ? { className } : {})}
      />
    );
  }

  const children = comments.map((comment) =>
    isWorkbenchTicketReviewComment(comment) ? (
      <WorkbenchTicketReviewComment key={comment.id} comment={comment} onRemove={onRemove} />
    ) : (
      <ComposerPendingReviewComments
        key={`native-${comment.id}`}
        comments={[comment]}
        onRemove={onRemove}
        className="contents"
      />
    ),
  );

  return <div className={cn("flex flex-wrap gap-1.5", className)}>{children}</div>;
}
