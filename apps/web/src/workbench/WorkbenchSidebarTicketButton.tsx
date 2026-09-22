import { ArchiveIcon, BookOpenIcon, BugIcon, CircleAlertIcon } from "lucide-react";

import { SidebarMenuButton } from "../components/ui/sidebar";
import { Button } from "../components/ui/button";
import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { WORKBENCH_TICKET_KIND_LABELS, WORKBENCH_TICKET_STATUS_LABELS } from "./workbench.logic";
import { WorkbenchPullRequestLink } from "./WorkbenchPullRequestLink";
import type { WorkbenchSidebarTicket } from "./workbenchSidebar.logic";
import type { WorkbenchSidebarTicketDetails } from "./workbenchSidebarContext.logic";

export function WorkbenchSidebarTicketButton({
  ticket,
  details,
  isActive,
  onSelect,
}: {
  readonly ticket: WorkbenchSidebarTicket;
  readonly details: WorkbenchSidebarTicketDetails | undefined;
  readonly isActive: boolean;
  readonly onSelect: () => void;
}) {
  const Icon = ticket.archivedAt ? ArchiveIcon : details?.kind === "bug" ? BugIcon : BookOpenIcon;
  const environmentId = details?.environmentId;
  const pullRequests = details?.pullRequests ?? [];
  const status = details?.statusLabel ?? WORKBENCH_TICKET_STATUS_LABELS[ticket.status];
  const preview = (
    <div className="flex flex-col gap-2 text-xs">
      <p className="font-medium text-foreground break-words">{ticket.title}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-muted-foreground">
        {details?.issueLink ? (
          <>
            <dt>Jira</dt>
            <dd>
              {details.issueLink.issue.key}
              {!details.issueLink.active ? " · Outside selected sprints" : ""}
            </dd>
          </>
        ) : null}
        {details ? (
          <>
            <dt>Type</dt>
            <dd>{WORKBENCH_TICKET_KIND_LABELS[details.kind]}</dd>
          </>
        ) : null}
        <dt>Status</dt>
        <dd>
          {status}
          {ticket.archivedAt ? " · Archived" : ""}
        </dd>
        {details?.attentionLabel ? (
          <>
            <dt>Attention</dt>
            <dd>{details.attentionLabel}</dd>
          </>
        ) : null}
        {details?.repositories.length ? (
          <>
            <dt>Repositories</dt>
            <dd className="min-w-0 break-words">{details.repositories.join(", ")}</dd>
          </>
        ) : null}
        {details?.epicTitle ? (
          <>
            <dt>Epic</dt>
            <dd className="min-w-0 break-words">{details.epicTitle}</dd>
          </>
        ) : null}
        {details ? (
          <>
            <dt>Threads</dt>
            <dd>{details.threadCount} available</dd>
          </>
        ) : null}
      </dl>
      {pullRequests.length ? (
        <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
          <p className="font-medium text-muted-foreground">Linked from Threads</p>
          {pullRequests.map(({ pullRequest }) => (
            <p key={pullRequest.url} className="break-words text-muted-foreground">
              {pullRequest.repository} #{pullRequest.number}
              {pullRequest.state
                ? ` · ${pullRequest.state === "open" && pullRequest.isDraft ? "draft" : pullRequest.state}`
                : ""}
              {pullRequest.title ? ` — ${pullRequest.title}` : ""}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
  return (
    <div className="flex min-w-0 flex-1 items-end">
      <SidebarMenuButton
        aria-label={ticket.title}
        aria-current={isActive ? "page" : undefined}
        isActive={isActive}
        onClick={onSelect}
        size="lg"
        className="h-auto min-h-12 min-w-0 flex-1 items-start"
        tooltip={{
          children: preview,
          hidden: false,
          align: "start",
          variant: "glass",
          className: "max-w-80 text-left whitespace-normal",
        }}
      >
        <Icon className="mt-0.5 size-3.5 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate">{ticket.title}</span>
            {details?.attentionLabel ? (
              <CircleAlertIcon
                aria-label={details.attentionLabel}
                className="size-3 shrink-0 text-warning"
              />
            ) : null}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-[11px] font-normal text-sidebar-muted-foreground">
            {details?.issueLink ? (
              <span className="min-w-0 truncate font-mono">{details.issueLink.issue.key}</span>
            ) : null}
            {details?.issueLink ? <span aria-hidden>·</span> : null}
            <span className="truncate">{status}</span>
          </span>
        </span>
      </SidebarMenuButton>
      {environmentId && pullRequests.length ? (
        <div className="mr-2 mb-1.5 shrink-0">
          {pullRequests.length === 1 && pullRequests[0] ? (
            <WorkbenchPullRequestLink
              compact
              environmentId={environmentId}
              pullRequest={pullRequests[0].pullRequest}
            />
          ) : (
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="xs"
                    aria-label={`Show ${pullRequests.length} linked pull requests for ${ticket.title}`}
                  />
                }
              >
                <PullRequestGlyph.pullRequest />
                {pullRequests.length}
              </PopoverTrigger>
              <PopoverPopup
                side="right"
                align="start"
                className="w-72"
                aria-label={`Linked pull requests for ${ticket.title}`}
              >
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium">Linked from Threads</p>
                  {pullRequests.map(({ pullRequest }) => (
                    <WorkbenchPullRequestLink
                      key={pullRequest.url}
                      environmentId={environmentId}
                      pullRequest={pullRequest}
                    />
                  ))}
                </div>
              </PopoverPopup>
            </Popover>
          )}
        </div>
      ) : null}
    </div>
  );
}
