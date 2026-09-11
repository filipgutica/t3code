import { ExternalLinkIcon, GitPullRequestIcon } from "lucide-react";
import { ChangeRequestLinkOpenContext, useOpenChangeRequestLink } from "../lib/openPullRequestLink";
import type { EnvironmentId, PullRequestRef, PullRequestState } from "@t3tools/contracts";
import { lazy, Suspense, useState, type MouseEvent } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";

const pullRequestStateClass = {
  open: "text-emerald-600 dark:text-emerald-300/90",
  merged: "text-violet-600 dark:text-violet-300/90",
  closed: "text-red-600 dark:text-red-300/90",
} satisfies Record<PullRequestState, string>;

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
}

export function WorkbenchPullRequestLink({
  environmentId,
  pullRequest,
}: {
  readonly environmentId: EnvironmentId;
  readonly pullRequest: WorkbenchPullRequestReference;
}) {
  const [selection, setSelection] = useState<{
    environmentId: EnvironmentId;
    reference: PullRequestRef;
  } | null>(null);
  const openChangeRequestLink = useOpenChangeRequestLink(undefined, undefined, setSelection);
  const label =
    pullRequest.title ?? pullRequest.repository ?? `Pull request #${pullRequest.number}`;
  const stateClass = pullRequest.state
    ? pullRequestStateClass[pullRequest.state]
    : "text-muted-foreground";
  const openInWorkbench = (event: MouseEvent<HTMLAnchorElement>) => {
    openChangeRequestLink(event, pullRequest.url, undefined, environmentId);
  };

  return (
    <span className="inline-flex w-full min-w-0 items-stretch rounded-lg border border-border/60 bg-background/40">
      <a
        aria-label={`Open pull request #${pullRequest.number}${pullRequest.title ? `: ${pullRequest.title}` : ""} in T3 Code${pullRequest.state ? ` (${pullRequest.state})` : ""}`}
        className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-l-lg px-3 py-1.5 text-sm font-medium text-foreground outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
        href={pullRequest.url}
        onClick={openInWorkbench}
        rel="noopener noreferrer"
        target="_blank"
      >
        <span className={`inline-flex items-center gap-1.5 leading-5 ${stateClass}`}>
          <GitPullRequestIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="tabular-nums">#{pullRequest.number}</span>
        </span>
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
      </a>
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
