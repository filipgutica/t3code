import type { WorkbenchJiraIssueLink, WorkbenchTicketKind } from "@t3tools/contracts";
import { BookOpenIcon, BugIcon, CopyIcon, LinkIcon } from "lucide-react";

import { Badge } from "../components/ui/badge";
import { MenuItem } from "../components/ui/menu";
import { toastManager } from "../components/ui/toast";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { cn } from "../lib/utils";
import { WorkbenchJiraIcon } from "./WorkbenchJiraIcon";
import { WORKBENCH_TICKET_KIND_LABELS } from "./workbench.logic";

export function WorkbenchTicketKindBadge({ kind }: { kind: WorkbenchTicketKind }) {
  const Icon = kind === "bug" ? BugIcon : BookOpenIcon;
  return (
    <Badge
      size="default"
      variant={kind === "bug" ? "error" : "info"}
      className={cn(
        "font-normal",
        kind === "bug" && "bg-destructive/5 text-destructive-foreground dark:bg-destructive/8",
      )}
    >
      <Icon />
      {WORKBENCH_TICKET_KIND_LABELS[kind]}
    </Badge>
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
