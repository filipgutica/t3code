import { ExternalLinkIcon, GitPullRequestIcon } from "lucide-react";
import { useOpenChangeRequestLink } from "../lib/openPullRequestLink";
import type { EnvironmentId, PullRequestState } from "@t3tools/contracts";
import type { MouseEvent } from "react";

import { Badge } from "../components/ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";

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
  const openChangeRequestLink = useOpenChangeRequestLink();
  const label =
    pullRequest.title ?? pullRequest.repository ?? `Pull request #${pullRequest.number}`;
  const openInWorkbench = (event: MouseEvent<HTMLAnchorElement>) => {
    openChangeRequestLink(event, pullRequest.url, undefined, environmentId);
  };

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <a
        aria-label={`Open pull request #${pullRequest.number}${pullRequest.title ? `: ${pullRequest.title}` : ""} in T3 Code`}
        className="inline-flex min-w-0 max-w-full items-start gap-1.5 rounded-sm text-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        href={pullRequest.url}
        onClick={openInWorkbench}
        rel="noopener noreferrer"
        target="_blank"
      >
        <GitPullRequestIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0">#{pullRequest.number}</span>
        <span className="min-w-0 break-words text-muted-foreground [overflow-wrap:anywhere]">
          {label}
        </span>
      </a>
      {pullRequest.state ? (
        <Badge size="sm" variant={pullRequest.state === "closed" ? "destructive" : "success"}>
          {pullRequest.state[0]?.toUpperCase() + pullRequest.state.slice(1)}
        </Badge>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <a
              aria-label={`Open pull request #${pullRequest.number} in browser`}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
    </span>
  );
}
