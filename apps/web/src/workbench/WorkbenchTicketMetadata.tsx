import type {
  WorkbenchJiraIssueLink,
  WorkbenchJiraIssueReference,
  WorkbenchJiraIssueSnapshot,
  WorkbenchJiraSubtaskReference,
  WorkbenchTicketKind,
} from "@t3tools/contracts";
import {
  BookOpenIcon,
  BugIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  ContrastIcon,
  CopyIcon,
  CornerDownRightIcon,
  ExternalLinkIcon,
  Layers3Icon,
  LinkIcon,
  ListTreeIcon,
  SquareCheckIcon,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

import { Badge } from "../components/ui/badge";
import { MenuItem } from "../components/ui/menu";
import { toastManager } from "../components/ui/toast";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { cn } from "../lib/utils";
import { WorkbenchJiraIcon } from "./WorkbenchJiraIcon";
import { getWorkbenchTicketTypeLabel } from "./workbench.logic";

/** Opens the visible Ticket for a Jira issue, or returns undefined when it is not in Workbench. */
export type WorkbenchJiraIssueTicketOpener = (issueId: string) => (() => void) | undefined;

// Jira's default issue type colours. Custom types, and defaults a site has recoloured, stay neutral.
const EPIC_COLOR = "#904EE2";
const TICKET_TYPES = new Map<string, { readonly color: string; readonly Icon: LucideIcon }>([
  ["story", { color: "#63BA3C", Icon: BookOpenIcon }],
  ["bug", { color: "#E5493A", Icon: BugIcon }],
  ["task", { color: "#4BADE8", Icon: SquareCheckIcon }],
  ["sub-task", { color: "#4BADE8", Icon: ListTreeIcon }],
  ["subtask", { color: "#4BADE8", Icon: ListTreeIcon }],
  ["epic", { color: EPIC_COLOR, Icon: Layers3Icon }],
]);

const labelColor = (color: string) => ({ "--label": color }) as CSSProperties;

export function WorkbenchTicketTypeBadge({
  kind,
  jiraIssue,
}: {
  kind: WorkbenchTicketKind;
  jiraIssue: Pick<WorkbenchJiraIssueSnapshot, "issueType"> | undefined;
}) {
  const label = getWorkbenchTicketTypeLabel({ kind, jiraIssue });
  const type = TICKET_TYPES.get(label.toLowerCase());
  const Icon = type?.Icon ?? CircleDotIcon;
  return type ? (
    <Badge size="default" variant="label" style={labelColor(type.color)}>
      <Icon />
      {label}
    </Badge>
  ) : (
    <Badge size="default" variant="outline">
      <Icon />
      {label}
    </Badge>
  );
}

export function WorkbenchEpicBadge({ title, className }: { title: string; className?: string }) {
  return (
    <Badge size="default" variant="label" style={labelColor(EPIC_COLOR)} className={className}>
      <Layers3Icon />
      <span className="truncate">{title}</span>
    </Badge>
  );
}

export function WorkbenchTicketSubtaskBadge({
  subtasks,
}: {
  subtasks: ReadonlyArray<WorkbenchJiraSubtaskReference> | undefined;
}) {
  if (!subtasks?.length) return null;
  const done = subtasks.filter((subtask) => subtask.status?.category === "done").length;
  return (
    <Badge
      size="default"
      variant="outline"
      aria-label={`${done} of ${subtasks.length} sub-tasks done`}
    >
      <ListTreeIcon />
      {done}/{subtasks.length} sub-tasks
    </Badge>
  );
}

/** Names a sub-task's parent. Opens its Ticket when it is in Workbench, otherwise Jira. */
export function WorkbenchJiraParentLink({
  parent,
  openJiraIssueTicket,
  className,
}: {
  parent: WorkbenchJiraIssueReference;
  openJiraIssueTicket: WorkbenchJiraIssueTicketOpener;
  className?: string;
}) {
  const openTicket = openJiraIssueTicket(parent.issueId);
  const name = parent.summary ? `${parent.key}: ${parent.summary}` : parent.key;
  const content = (
    <>
      <CornerDownRightIcon className="size-3.5 shrink-0" />
      <span className="shrink-0 font-mono text-foreground">{parent.key}</span>
      {parent.summary ? (
        <span className="truncate group-hover:underline">{parent.summary}</span>
      ) : null}
      {openTicket ? null : <ExternalLinkIcon className="size-3 shrink-0" />}
    </>
  );
  const linkClassName = cn(
    "group flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 self-start rounded-sm text-left text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    className,
  );
  return openTicket ? (
    <button
      type="button"
      data-workbench-no-drag=""
      aria-label={`Open parent Ticket ${name}`}
      className={linkClassName}
      onClick={(event) => {
        event.stopPropagation();
        openTicket();
      }}
    >
      {content}
    </button>
  ) : (
    <a
      href={parent.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open parent ${name} in Jira`}
      className={linkClassName}
      onClick={(event) => event.stopPropagation()}
    >
      {content}
    </a>
  );
}

const SUBTASK_STATUS_ICONS = {
  todo: { Icon: CircleIcon, className: "text-muted-foreground" },
  in_progress: { Icon: ContrastIcon, className: "text-info-foreground" },
  done: { Icon: CircleCheckIcon, className: "text-success-foreground" },
} as const;

/** Lists every sub-task Jira reports. Rows outside Workbench open Jira instead. */
export function WorkbenchJiraSubtaskList({
  subtasks,
  openJiraIssueTicket,
}: {
  subtasks: ReadonlyArray<WorkbenchJiraSubtaskReference>;
  openJiraIssueTicket: WorkbenchJiraIssueTicketOpener;
}) {
  const done = subtasks.filter((subtask) => subtask.status?.category === "done").length;
  return (
    <section aria-label="Sub-tasks" className="border-t border-border/60">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">
        <h3>Sub-tasks</h3>
        <span>
          {done} of {subtasks.length} done
        </span>
      </div>
      <ul className="divide-y divide-border/60 pb-1">
        {subtasks.map((subtask) => {
          const { Icon, className } = SUBTASK_STATUS_ICONS[subtask.status?.category ?? "todo"];
          const openTicket = openJiraIssueTicket(subtask.issueId);
          const title = <span className="truncate">{subtask.summary ?? subtask.key}</span>;
          const rowClassName =
            "flex min-w-0 cursor-pointer items-center gap-2 rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
          return (
            <li
              key={subtask.issueId}
              className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 px-4 py-2 text-sm"
            >
              <Icon aria-hidden className={cn("size-3.5", className)} />
              <span className="font-mono text-xs text-muted-foreground">{subtask.key}</span>
              {openTicket ? (
                <button type="button" className={rowClassName} onClick={openTicket}>
                  {title}
                </button>
              ) : (
                <a
                  href={subtask.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(rowClassName, "text-muted-foreground")}
                >
                  {title}
                  <span className="flex shrink-0 items-center gap-1 text-xs">
                    Not in Workbench <ExternalLinkIcon className="size-3" />
                  </span>
                </a>
              )}
              <span className="text-right text-xs text-muted-foreground">
                {subtask.status?.name}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function WorkbenchTicketSourceBadge({
  jiraIssueLink,
  jiraOwnershipKnown = true,
  className = "",
}: {
  jiraIssueLink: WorkbenchJiraIssueLink | null | undefined;
  jiraOwnershipKnown?: boolean;
  className?: string;
}) {
  const issue = jiraIssueLink?.issue;
  if (issue)
    return (
      <Badge
        size="default"
        variant="info"
        render={<a href={issue.url} target="_blank" rel="noopener noreferrer" />}
        aria-label={`Open Jira issue ${issue.key}`}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "bg-info/5 font-mono font-normal text-info-foreground hover:bg-info/10 hover:underline dark:bg-info/8 dark:hover:bg-info/12",
          className,
        )}
      >
        <WorkbenchJiraIcon className="size-3" /> Jira · {issue.key}
      </Badge>
    );
  return (
    <Badge size="default" variant="outline" className={className}>
      {jiraOwnershipKnown ? "Local" : "Checking Jira…"}
    </Badge>
  );
}

export function WorkbenchTicketCopyMenuItems({
  ticketId,
  jiraIssueLink,
}: {
  ticketId: string;
  jiraIssueLink: WorkbenchJiraIssueLink | null | undefined;
}) {
  const issue = jiraIssueLink?.issue;
  const copy = async ({
    value,
    target,
    copiedTitle,
  }: {
    value: string;
    target: string;
    copiedTitle: string;
  }) => {
    try {
      if (await writeTextToClipboard(value, target))
        toastManager.add({ type: "success", title: copiedTitle, description: value });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not copy ticket details",
        description: cause instanceof Error ? cause.message : "Please try again.",
      });
    }
  };
  return (
    <>
      <MenuItem
        onClick={() =>
          void copy({
            value: issue?.key ?? ticketId,
            target: "ticket ID",
            copiedTitle: "Ticket ID copied",
          })
        }
      >
        <CopyIcon /> Copy ticket ID
      </MenuItem>
      {issue ? (
        <MenuItem
          onClick={() =>
            void copy({
              value: issue.url,
              target: "Jira link",
              copiedTitle: "Jira link copied",
            })
          }
        >
          <LinkIcon /> Copy Jira link
        </MenuItem>
      ) : null}
    </>
  );
}
