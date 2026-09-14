import type { ReviewCommentContext } from "../reviewCommentContext";

export const resolveWorkbenchReviewCommentTitle = (
  comment: Pick<ReviewCommentContext, "sectionId" | "text" | "filePath" | "sectionTitle">,
): string | null => {
  if (!comment.sectionId.startsWith("workbench-ticket:")) return null;
  return comment.text.trim() || comment.filePath.trim() || comment.sectionTitle;
};
