import {
  type WorkbenchLinkedPullRequestThread,
  useOpenWorkbenchPullRequest,
} from "./WorkbenchPullRequestPreview";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ExternalLinkIcon } from "lucide-react";
import { parseChangeRequestUrl, useOpenChangeRequestLink } from "../lib/openPullRequestLink";
import type { EnvironmentId, ProjectId, PullRequestState } from "@t3tools/contracts";
import { useMemo, type MouseEvent } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { linkedPullRequestDetailAtom, useSharedPullRequestSummary } from "../state/pullRequests";
import { useEnvironmentQuery } from "../state/query";
import {
  PULL_REQUEST_STATE_PRESENTATION,
  PullRequestGlyph,
  type PullRequestGlyphIcon,
} from "../components/pullRequest/pullRequestIcons";

export interface WorkbenchPullRequestReference {
  readonly projectId?: ProjectId;
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
      <span className="tabular-nums">#{number}</span>
    </span>
  );
}

function resolvedPullRequestState({
  pullRequest,
  summary,
}: {
  readonly pullRequest: WorkbenchPullRequestReference;
  readonly summary: ReturnType<typeof useSharedPullRequestSummary>;
}) {
  const currentState =
    pullRequest.state === "merged" || summary?.state === "merged"
      ? "merged"
      : (pullRequest.state ?? summary?.state);
  const isDraft =
    pullRequest.state === undefined
      ? (summary?.isDraft ?? pullRequest.isDraft)
      : pullRequest.isDraft;
  return currentState === "open" && isDraft ? "draft" : currentState;
}

function WorkbenchPullRequestAnchor({
  pullRequest,
  compact,
  state,
  Icon,
  stateClass,
  onClick,
}: {
  readonly pullRequest: WorkbenchPullRequestReference;
  readonly compact: boolean;
  readonly state: ReturnType<typeof resolvedPullRequestState>;
  readonly Icon: PullRequestGlyphIcon;
  readonly stateClass: string;
  readonly onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const label =
    pullRequest.title ?? pullRequest.repository ?? `Pull request #${pullRequest.number}`;
  return (
    <a
      aria-label={`Open pull request #${pullRequest.number}${pullRequest.title ? `: ${pullRequest.title}` : ""} in T3 Code${state ? ` (${state})` : ""}`}
      className={
        compact
          ? "inline-flex shrink-0 rounded text-xs outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          : "flex min-w-0 flex-1 flex-col gap-1 rounded-lg px-2 py-2 text-sm font-medium text-foreground outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
      }
      href={pullRequest.url}
      onClick={onClick}
      rel="noopener noreferrer"
      target="_blank"
    >
      {!compact ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="line-clamp-2 min-w-0 break-words leading-5 [overflow-wrap:anywhere]" />
            }
          >
            {label}
          </TooltipTrigger>
          <TooltipPopup className="max-w-[min(40rem,calc(100vw-2rem))] break-words">
            {label}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {compact ? (
        <WorkbenchPullRequestIdentifier
          Icon={Icon}
          compact
          number={pullRequest.number}
          stateClass={stateClass}
        />
      ) : (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-normal leading-5">
          <WorkbenchPullRequestIdentifier
            Icon={Icon}
            compact={false}
            number={pullRequest.number}
            stateClass={stateClass}
          />
          {state ? (
            <span className={stateClass}>{PULL_REQUEST_STATE_PRESENTATION[state].label}</span>
          ) : null}
        </span>
      )}
    </a>
  );
}

function WorkbenchPullRequestExternalLink({
  pullRequest,
}: {
  readonly pullRequest: WorkbenchPullRequestReference;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            aria-label={`Open pull request #${pullRequest.number} in browser`}
            className="inline-flex min-h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
  );
}

export function WorkbenchPullRequestLink({
  environmentId,
  pullRequest,
  compact = false,
  linkedThread,
  onSelect,
}: {
  readonly environmentId: EnvironmentId;
  readonly pullRequest: WorkbenchPullRequestReference;
  readonly compact?: boolean;
  readonly linkedThread?: WorkbenchLinkedPullRequestThread | undefined;
  readonly onSelect?: () => void;
}) {
  const openWorkbenchPullRequest = useOpenWorkbenchPullRequest();
  const openChangeRequestLink = useOpenChangeRequestLink(
    linkedThread ? scopeThreadRef(environmentId, linkedThread.threadId) : undefined,
    undefined,
    openWorkbenchPullRequest
      ? (selection) =>
          openWorkbenchPullRequest({ ...selection, ...(linkedThread ? { linkedThread } : {}) })
      : undefined,
  );
  const reference = useMemo(() => {
    if (!pullRequest.projectId || !pullRequest.repository) return null;
    const host = parseChangeRequestUrl(pullRequest.url)?.host;
    return {
      projectId: pullRequest.projectId,
      repository: pullRequest.repository,
      number: pullRequest.number,
      ...(host === undefined ? {} : { host }),
    };
  }, [pullRequest.projectId, pullRequest.repository, pullRequest.number, pullRequest.url]);
  const queried = useEnvironmentQuery(
    pullRequest.state === undefined && reference
      ? linkedPullRequestDetailAtom({ environmentId, input: reference })
      : null,
  );
  const summary = useSharedPullRequestSummary(
    environmentId,
    reference,
    queried.data,
    queried.dataUpdatedAt,
  );
  const state = resolvedPullRequestState({ pullRequest, summary });
  const presentation = state ? PULL_REQUEST_STATE_PRESENTATION[state] : undefined;
  const stateClass = presentation?.toneClassName ?? "text-muted-foreground";
  const PullRequestIcon = presentation?.Icon ?? PullRequestGlyph.pullRequest;
  const openInWorkbench = (event: MouseEvent<HTMLAnchorElement>) => {
    if (openChangeRequestLink(event, pullRequest.url, undefined, environmentId)) onSelect?.();
  };

  return (
    <span
      className={
        compact ? "inline-flex shrink-0" : "inline-flex w-full min-w-0 items-stretch gap-1"
      }
    >
      <WorkbenchPullRequestAnchor
        pullRequest={pullRequest}
        compact={compact}
        state={state}
        Icon={PullRequestIcon}
        stateClass={stateClass}
        onClick={openInWorkbench}
      />
      {!compact ? <WorkbenchPullRequestExternalLink pullRequest={pullRequest} /> : null}
    </span>
  );
}
