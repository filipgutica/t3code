import type { ReviewCommentContext } from "../reviewCommentContext";

export const isWorkbenchTicketReviewComment = (
  comment: ReviewCommentContext | undefined,
): boolean => comment?.sectionId.startsWith("workbench-ticket:") ?? false;
