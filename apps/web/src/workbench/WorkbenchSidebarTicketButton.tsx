import { WorkbenchThreadExecutionStatus } from "./WorkbenchThreadExecutionStatus";
import {
  ArchiveIcon,
  BookOpenIcon,
  BugIcon,
  CircleAlertIcon,
  FolderGit2Icon,
  PlusIcon,
} from "lucide-react";
import { useState } from "react";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { WORKBENCH_TICKET_KIND_LABELS, WORKBENCH_TICKET_STATUS_LABELS } from "./workbench.logic";
import { WorkbenchPullRequestLink } from "./WorkbenchPullRequestLink";
import { useWorkbenchSidebarTicketActionMenu } from "./useWorkbenchSidebarTicketActionMenu";
import type { WorkbenchSidebarTicket } from "./workbenchSidebar.logic";
import type { WorkbenchSidebarTicketDetails } from "./workbenchSidebarContext.logic";
import { WorkbenchTicketAttentionBadge } from "./WorkbenchTicketAttention";
import { WorkbenchSidebarQuickAction } from "./WorkbenchSidebarRowActions";
import { WorkbenchSidebarRowNavigation } from "./WorkbenchSidebarRowNavigation";
import { WorkbenchReferenceKindIcon } from "./WorkbenchReferences";

function TicketPullRequestPreview({
  pullRequests,
}: {
  readonly pullRequests: WorkbenchSidebarTicketDetails["pullRequests"];
}) {
  return pullRequests.length ? (
    <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
      <p className="font-medium text-muted-foreground">Linked from Threads</p>
      {pullRequests.map(({ pullRequest }) => (
        <p key={pullRequest.url} className="break-words text-muted-foreground">
          {pullRequest.repository} #{pullRequest.number}
          {pullRequest.state
            ? ` · ${pullRequest.state === "open" && pullRequest.isDraft ? "draft" : pullRequest.state}`
            : ""}
          {pullRequest.title ? `: ${pullRequest.title}` : ""}
        </p>
      ))}
    </div>
  ) : null;
}

function TicketPreview({
  ticket,
  details,
  status,
}: {
  readonly ticket: WorkbenchSidebarTicket;
  readonly details: WorkbenchSidebarTicketDetails | undefined;
  readonly status: string;
}) {
  const pullRequests = details?.pullRequests ?? [];
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="font-medium text-foreground break-words">{ticket.title}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-muted-foreground">
        {details?.issue ? (
          <>
            <dt>Issue</dt>
            <dd>{details.issue.label}</dd>
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
      <TicketPullRequestPreview pullRequests={pullRequests} />
    </div>
  );
}

const TICKET_ICON_TONE = {
  story: "text-info-foreground",
  bug: "text-destructive-foreground",
} satisfies Record<WorkbenchSidebarTicketDetails["kind"], string>;

const TICKET_STATUS_DOT_TONE = {
  todo: "bg-sidebar-muted-foreground/55",
  in_progress: "bg-info",
  done: "bg-success",
} satisfies Record<WorkbenchSidebarTicket["status"], string>;

function WorkbenchSidebarTicketTitle({
  ticket,
  details,
}: {
  readonly ticket: WorkbenchSidebarTicket;
  readonly details: WorkbenchSidebarTicketDetails | undefined;
}) {
  const kind = details?.kind ?? "story";
  const Icon = ticket.archivedAt ? ArchiveIcon : kind === "bug" ? BugIcon : BookOpenIcon;
  const iconTone = ticket.archivedAt ? "text-sidebar-muted-foreground/60" : TICKET_ICON_TONE[kind];

  return (
    <span data-workbench-sidebar-title="">
      <Icon aria-hidden className={`size-4 shrink-0 ${iconTone}`} />
      <span className="min-w-0 flex-1 truncate">{ticket.title}</span>
    </span>
  );
}

function WorkbenchSidebarTicketStatus({
  ticket,
  details,
  status,
}: {
  readonly ticket: WorkbenchSidebarTicket;
  readonly details: WorkbenchSidebarTicketDetails | undefined;
  readonly status: string;
}) {
  return (
    <span data-workbench-sidebar-metadata-label="" data-workbench-sidebar-line="1">
      <span data-workbench-sidebar-metadata-icon="" aria-hidden>
        {details?.issue ? (
          <WorkbenchReferenceKindIcon kind={details.issue.kind} className="size-3" />
        ) : (
          <span className={`size-1.5 rounded-full ${TICKET_STATUS_DOT_TONE[ticket.status]}`} />
        )}
      </span>
      <span data-workbench-sidebar-ticket-planning="">
        {details?.issue ? (
          <>
            <span className="shrink-0 font-mono">{details.issue.label}</span>
            <span aria-hidden>·</span>
          </>
        ) : null}
        <span className="truncate">{status}</span>
      </span>
      {details?.attentionLabel ? (
        <CircleAlertIcon
          aria-label={details.attentionLabel}
          className="size-3 shrink-0 text-warning"
        />
      ) : null}
    </span>
  );
}

function WorkbenchSidebarTicketPrControl({
  ticket,
  details,
}: {
  readonly ticket: WorkbenchSidebarTicket;
  readonly details: WorkbenchSidebarTicketDetails | undefined;
}) {
  const [chooserOpen, setChooserOpen] = useState(false);
  const environmentId = details?.environmentId;
  const pullRequests = details?.pullRequests ?? [];
  if (!environmentId || pullRequests.length === 0) return null;

  return (
    <div data-workbench-sidebar-pr-control="" className="flex shrink-0 items-center">
      {pullRequests.length === 1 && pullRequests[0] ? (
        <WorkbenchPullRequestLink
          compact
          environmentId={environmentId}
          pullRequest={pullRequests[0].pullRequest}
          linkedThread={{ threadId: pullRequests[0].threadId, title: pullRequests[0].threadTitle }}
        />
      ) : (
        <Popover open={chooserOpen} onOpenChange={setChooserOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap border-b border-transparent text-xs tabular-nums text-sidebar-muted-foreground hover:border-current focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`Show ${pullRequests.length} linked pull requests for ${ticket.title}`}
              />
            }
          >
            <PullRequestGlyph.pullRequest aria-hidden className="size-3 shrink-0" />
            {pullRequests.length} PRs
          </PopoverTrigger>
          <PopoverPopup
            side="right"
            align="start"
            className="w-72"
            aria-label={`Linked pull requests for ${ticket.title}`}
          >
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium">Linked from Threads</p>
              {pullRequests.map(({ pullRequest, threadId, threadTitle }) => (
                <WorkbenchPullRequestLink
                  key={pullRequest.url}
                  environmentId={environmentId}
                  pullRequest={pullRequest}
                  linkedThread={{ threadId, title: threadTitle }}
                  onSelect={() => setChooserOpen(false)}
                />
              ))}
            </div>
          </PopoverPopup>
        </Popover>
      )}
    </div>
  );
}

function WorkbenchSidebarTicketRepositories({
  details,
}: {
  readonly details: WorkbenchSidebarTicketDetails | undefined;
}) {
  return (
    <span data-workbench-sidebar-metadata-label="" data-workbench-sidebar-line="3">
      {details?.repositories.length ? (
        <>
          <span data-workbench-sidebar-metadata-icon="" aria-hidden>
            <FolderGit2Icon className="size-3" />
          </span>
          <span className="truncate">{details.repositories.join(", ")}</span>
        </>
      ) : null}
    </span>
  );
}

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
  const status = details?.statusLabel ?? WORKBENCH_TICKET_STATUS_LABELS[ticket.status];
  const executionStatus = details?.executionStatus ? (
    <span data-workbench-sidebar-native-status="">
      <WorkbenchThreadExecutionStatus
        compact
        status={details.executionStatus.presentation}
        startedAt={details.executionStatus.startedAt}
      />
    </span>
  ) : null;
  const actions = useWorkbenchSidebarTicketActionMenu({
    environmentId: details?.environmentId,
    ticket,
    issue: details?.issue ?? null,
    readOnly: details?.readOnly ?? true,
  });
  return (
    <div
      data-workbench-sidebar-item-row=""
      data-workbench-sidebar-detail-row="ticket"
      className="min-w-0 flex-1"
      onContextMenu={(event) => {
        event.preventDefault();
        actions.openMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <WorkbenchSidebarRowNavigation
        label={ticket.title}
        isActive={isActive}
        onSelect={onSelect}
        openMenu={actions.openMenu}
        preview={<TicketPreview ticket={ticket} details={details} status={status} />}
      >
        <WorkbenchSidebarTicketStatus ticket={ticket} details={details} status={status} />
        <WorkbenchSidebarTicketTitle ticket={ticket} details={details} />
        <WorkbenchSidebarTicketRepositories details={details} />
      </WorkbenchSidebarRowNavigation>
      <span data-workbench-sidebar-slot={actions.canCreateThread ? "actions" : ""}>
        {details?.environmentId ? (
          <WorkbenchTicketAttentionBadge
            environmentId={details.environmentId}
            ticketId={ticket.id}
            ticketTitle={ticket.title}
            nativeStatusKind={details.executionStatus?.kind ?? null}
            nativeStatus={executionStatus}
            side="right"
          />
        ) : (
          executionStatus
        )}
        {actions.canCreateThread ? (
          <span data-workbench-sidebar-quick-actions="">
            <WorkbenchSidebarQuickAction
              label={`New Thread for ${ticket.title}`}
              Icon={PlusIcon}
              onSelect={actions.newThread}
            />
          </span>
        ) : null}
      </span>
      <span data-workbench-sidebar-metadata-controls="">
        <WorkbenchSidebarTicketPrControl ticket={ticket} details={details} />
      </span>
    </div>
  );
}
