import type { WorkbenchJiraIssueLink, WorkbenchTicketKind } from "@t3tools/contracts";
import { BookOpenIcon, BugIcon } from "lucide-react";

import { Badge } from "../components/ui/badge";
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
        kind === "bug" &&
          "bg-destructive/5 text-[color-mix(in_oklab,var(--destructive-foreground)_35%,var(--foreground))] dark:bg-destructive/8",
      )}
    >
      <Icon />
      {WORKBENCH_TICKET_KIND_LABELS[kind]}
    </Badge>
  );
}

export function WorkbenchJiraIssueKey({
  issue,
  className,
}: {
  issue: WorkbenchJiraIssueLink["issue"];
  className?: string;
}) {
  return (
    <Badge
      size="default"
      variant="info"
      render={<a href={issue.url} target="_blank" rel="noopener noreferrer" />}
      aria-label={`Open Jira issue ${issue.key}`}
      className={cn(
        "bg-info/5 font-mono font-normal text-[color-mix(in_oklab,var(--info-foreground)_55%,var(--foreground))] hover:bg-info/10 hover:underline dark:bg-info/8 dark:hover:bg-info/12",
        className,
      )}
    >
      <WorkbenchJiraIcon className="size-3" />
      {issue.key}
    </Badge>
  );
}
