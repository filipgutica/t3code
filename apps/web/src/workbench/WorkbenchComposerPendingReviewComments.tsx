import { ChevronDown, MessageCircle, X } from "lucide-react";

import { ContextChip, ContextChipAction, ContextChipLabel } from "../components/ContextChip";
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
    <ContextChip className="select-none pr-1">
      <Popover>
        <PopoverTrigger
          aria-label={`Inspect context: ${label}`}
          className="inline-flex min-w-0 items-center gap-1 rounded-sm text-left outline-none hover:text-primary focus-visible:ring-1 focus-visible:ring-ring"
        >
          <MessageCircle className="size-3.5 shrink-0" />
          <ContextChipLabel>{label}</ContextChipLabel>
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
      <ContextChipAction
        aria-label={`Remove comment on ${label}`}
        className="text-muted-foreground/72 hover:bg-foreground/6 hover:text-foreground"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRemove(comment.id);
        }}
      >
        <X className="size-3" aria-hidden />
      </ContextChipAction>
    </ContextChip>
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
  const workbenchComments = comments.filter(isWorkbenchTicketReviewComment);
  if (workbenchComments.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {workbenchComments.map((comment) => (
        <WorkbenchTicketReviewComment key={comment.id} comment={comment} onRemove={onRemove} />
      ))}
    </div>
  );
}
