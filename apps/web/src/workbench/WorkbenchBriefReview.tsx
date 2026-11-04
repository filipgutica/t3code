import { SparklesIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import { askForChangeTargetClassName, WorkbenchAskForChange } from "./WorkbenchAskForChange";
import { WorkbenchDescription } from "./WorkbenchDescription";
import { WorkbenchMarkdownReview } from "./WorkbenchMarkdownReview";
import { workbenchDescriptionMarkdown } from "./workbenchDescription.logic";
import type { useWorkbenchBriefReview } from "./useWorkbenchBriefReview";

type BriefReview = ReturnType<typeof useWorkbenchBriefReview>;

/** The header action that asks for a change to the whole brief. */
export function WorkbenchBriefAskButton({
  briefReview,
  variant,
  unavailableReason = null,
}: {
  readonly briefReview: BriefReview;
  readonly variant: "outline" | "ghost";
  /** Why Ask for change cannot run here; the button is then disabled and says so on hover. */
  readonly unavailableReason?: string | null;
}) {
  const ask = briefReview.askForChange;
  if (!briefReview.permitted.ask) return null;
  const button = (
    <Button
      size="xs"
      type="button"
      variant={variant}
      disabled={unavailableReason !== null || !ask.available || ask.running}
      onClick={ask.askWhole}
    >
      <SparklesIcon /> Ask for change
    </Button>
  );
  if (unavailableReason === null) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{button}</TooltipTrigger>
      <TooltipPopup>{unavailableReason}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * The rendered brief, or its diff while a review shows one, with Ask for change on a selection.
 * A selection maps to source offsets only in the full rendering, so the diff offers none.
 */
export function WorkbenchBriefBody({
  briefReview,
  markdown,
  jira,
  empty,
}: {
  readonly briefReview: BriefReview;
  readonly markdown: string;
  readonly jira: boolean;
  /** Shown for an empty brief instead of the description's own placeholder. */
  readonly empty?: string;
}) {
  const { askForChange: ask, review } = briefReview;
  const { containerRef, selectionHandlers, wholeMarked, running } = ask;
  const showDiff = review !== null && review.diffShown;
  return (
    <>
      <div
        ref={containerRef}
        {...(showDiff ? {} : selectionHandlers)}
        className={cn("min-w-0", askForChangeTargetClassName({ wholeMarked, running }))}
      >
        {showDiff ? (
          <WorkbenchMarkdownReview
            review={review.blocks}
            jira={workbenchDescriptionMarkdown(markdown, jira) === markdown ? false : "wiki"}
          />
        ) : empty !== undefined && !markdown.trim() ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <WorkbenchDescription markdown={markdown} jira={jira} />
        )}
      </div>
      <WorkbenchAskForChange ask={ask} />
    </>
  );
}
