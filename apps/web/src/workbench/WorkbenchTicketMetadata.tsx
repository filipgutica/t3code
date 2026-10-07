import type {
  ContextMenuItem,
  WorkbenchJiraIssueLink,
  WorkbenchTicketKind,
} from "@t3tools/contracts";
import { BookOpenIcon, BugIcon } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";

import { Badge } from "../components/ui/badge";
import { toastManager } from "../components/ui/toast";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { readLocalApi } from "../localApi";
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
  ticketId,
  jiraIssueLink,
  jiraOwnershipKnown = true,
  className = "",
}: {
  ticketId: string;
  jiraIssueLink: WorkbenchJiraIssueLink | null | undefined;
  jiraOwnershipKnown?: boolean;
  className?: string;
}) {
  const issue = jiraIssueLink?.issue;
  const showCopyMenu = async (position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api) return;
    const items = [
      {
        id: "copy-ticket-id" as const,
        label: "Copy ticket ID",
        icon: "copy" as const,
        value: issue?.key ?? ticketId,
        target: "ticket ID",
        copiedTitle: "Ticket ID copied",
      },
      ...(issue
        ? [
            {
              id: "copy-jira-link" as const,
              label: "Copy Jira link",
              icon: "copy" as const,
              value: issue.url,
              target: "Jira link",
              copiedTitle: "Jira link copied",
            },
          ]
        : []),
    ] satisfies (ContextMenuItem<"copy-ticket-id" | "copy-jira-link"> & {
      value: string;
      target: string;
      copiedTitle: string;
    })[];
    try {
      const action = await api.contextMenu.show(items, position);
      const selected = items.find((item) => item.id === action);
      if (!selected) return;
      if (await writeTextToClipboard(selected.value, selected.target))
        toastManager.add({
          type: "success",
          title: selected.copiedTitle,
          description: selected.value,
        });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not copy ticket details",
        description: cause instanceof Error ? cause.message : "Please try again.",
      });
    }
  };
  const copyMenuProps = {
    "data-workbench-no-drag": true,
    title: "Right-click or press Shift+F10 for copy actions",
    onClick: (event: MouseEvent<HTMLElement>) => event.stopPropagation(),
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void showCopyMenu({ x: event.clientX, y: event.clientY });
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      void showCopyMenu({ x: rect.left, y: rect.bottom });
    },
  };
  if (issue)
    return (
      <Badge
        size="default"
        variant="info"
        render={<a href={issue.url} target="_blank" rel="noopener noreferrer" />}
        aria-label={`Open Jira issue ${issue.key}`}
        {...copyMenuProps}
        className={cn(
          "bg-info/5 font-mono font-normal text-info-foreground hover:bg-info/10 hover:underline dark:bg-info/8 dark:hover:bg-info/12",
          className,
        )}
      >
        <WorkbenchJiraIcon className="size-3" /> Jira · {issue.key}
      </Badge>
    );
  return (
    <Badge
      size="default"
      variant="outline"
      render={<button type="button" />}
      className={className}
      {...copyMenuProps}
    >
      {jiraOwnershipKnown ? "Local" : "Checking Jira…"}
    </Badge>
  );
}
