import { ExternalLinkIcon } from "lucide-react";
import { ChangeRequestLinkOpenContext, useOpenChangeRequestLink } from "../lib/openPullRequestLink";
import type { EnvironmentId, PullRequestRef, PullRequestState } from "@t3tools/contracts";
import { lazy, Suspense, useState, type MouseEvent } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import {
  PULL_REQUEST_STATE_PRESENTATION,
  PullRequestGlyph,
  type PullRequestGlyphIcon,
} from "../components/pullRequest/pullRequestIcons";

const WorkbenchPullRequestPanel = lazy(() =>
  import("./WorkbenchPullRequestPanel").then((module) => ({
    default: module.WorkbenchPullRequestPanel,
  })),
);

export interface WorkbenchPullRequestReference {
  readonly number: number;
  readonly url: string;
  readonly title?: string;
  readonly repository?: string;
  readonly state?: PullRequestState;
  readonly isDraft?: boolean | undefined;
}

function WorkbenchPullRequestIdentifier({
  Icon,
  number,
  stateClass,
  compact,
}: {
  readonly Icon: PullRequestGlyphIcon;
  readonly number: number;
  readonly stateClass: string;
  readonly compact: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center ${compact ? "gap-0.5" : "gap-1.5"} leading-5 ${stateClass}`}
    >
      <Icon aria-hidden className={`${compact ? "size-3" : "size-3.5"} shrink-0`} />
      <span className="tabular-nums">{compact ? number : `#${number}`}</span>
    </span>
  );
}

export function WorkbenchPullRequestLink({
  environmentId,
  pullRequest,
  compact = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly pullRequest: WorkbenchPullRequestReference;
  readonly compact?: boolean;
}) {
  const [selection, setSelection] = useState<{
    environmentId: EnvironmentId;
    reference: PullRequestRef;
  } | null>(null);
  const openChangeRequestLink = useOpenChangeRequestLink(undefined, undefined, setSelection);
  const label =
    pullRequest.title ?? pullRequest.repository ?? `Pull request #${pullRequest.number}`;
  const state = pullRequest.state === "open" && pullRequest.isDraft ? "draft" : pullRequest.state;
  const presentation = state ? PULL_REQUEST_STATE_PRESENTATION[state] : undefined;
  const stateClass = presentation?.toneClassName ?? "text-muted-foreground";
  const PullRequestIcon = presentation?.Icon ?? PullRequestGlyph.pullRequest;
  const openInWorkbench = (event: MouseEvent<HTMLAnchorElement>) => {
    openChangeRequestLink(event, pullRequest.url, undefined, environmentId);
  };

  return (
    <span
      className={
        compact
          ? "inline-flex shrink-0"
          : "inline-flex w-full min-w-0 items-stretch rounded-lg border border-border/60 bg-background/40"
      }
    >
      <a
        aria-label={`Open pull request #${pullRequest.number}${pullRequest.title ? `: ${pullRequest.title}` : ""} in T3 Code${state ? ` (${state})` : ""}`}
        className={
          compact
            ? "inline-flex shrink-0 rounded text-xs outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            : "flex min-w-0 flex-1 flex-col gap-0.5 rounded-l-lg px-3 py-1.5 text-sm font-medium text-foreground outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
        }
        href={pullRequest.url}
        onClick={openInWorkbench}
        rel="noopener noreferrer"
        target="_blank"
      >
        <WorkbenchPullRequestIdentifier
          Icon={PullRequestIcon}
          compact={compact}
          number={pullRequest.number}
          stateClass={stateClass}
        />
        {!compact ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="block min-w-0 truncate font-normal leading-5 text-muted-foreground" />
              }
            >
              {label}
            </TooltipTrigger>
            <TooltipPopup className="max-w-[min(40rem,calc(100vw-2rem))] break-words">
              {label}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </a>
      {!compact ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <a
                aria-label={`Open pull request #${pullRequest.number} in browser`}
                className="inline-flex w-9 shrink-0 items-center justify-center rounded-r-lg border-l border-border/60 text-muted-foreground outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                href={pullRequest.url}
                rel="noopener noreferrer"
                target="_blank"
              />
            }
          >
            <ExternalLinkIcon aria-hidden className="size-3" />
          </TooltipTrigger>
          <TooltipPopup>Open in browser</TooltipPopup>
        </Tooltip>
      ) : null}
      {selection ? (
        <ChangeRequestLinkOpenContext value={setSelection}>
          <Suspense fallback={<span role="status">Loading pull request…</span>}>
            <WorkbenchPullRequestPanel
              environmentId={selection.environmentId}
              reference={selection.reference}
              onClose={() => setSelection(null)}
              onSelectPullRequest={(reference) =>
                setSelection({ environmentId: selection.environmentId, reference })
              }
            />
          </Suspense>
        </ChangeRequestLinkOpenContext>
      ) : null}
    </span>
  );
}
