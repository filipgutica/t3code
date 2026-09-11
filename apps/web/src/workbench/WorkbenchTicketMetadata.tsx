import type { WorkbenchJiraIssueLink, WorkbenchTicketKind } from "@t3tools/contracts";
import { BookOpenIcon, BugIcon } from "lucide-react";

import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";
import { WorkbenchJiraIcon } from "./WorkbenchJiraIcon";
import { WORKBENCH_TICKET_KIND_LABELS } from "./workbench.logic";

export function WorkbenchTicketKindBadge({ kind }: { kind: WorkbenchTicketKind }) {
  const Icon = kind === "bug" ? BugIcon : BookOpenIcon;
  return (
    <Badge size="default" variant="secondary" className="font-normal text-muted-foreground">
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
    <a
      href={issue.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open Jira issue ${issue.key}`}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm font-mono text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <WorkbenchJiraIcon className="size-3" />
      {issue.key}
    </a>
  );
}
