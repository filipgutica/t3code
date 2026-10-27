import type { WorkbenchJiraIssue, WorkbenchTicketKind } from "@t3tools/contracts";
import {
  BookOpenIcon,
  BugIcon,
  CopyIcon,
  ExternalLinkIcon,
  Layers3Icon,
  LinkIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

import { Badge } from "../components/ui/badge";
import { MenuItem } from "../components/ui/menu";
import { toastManager } from "../components/ui/toast";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { WORKBENCH_TICKET_KIND_LABELS } from "./workbench.logic";

// Jira's default issue type colours, so linked and local records read the same.
const EPIC_COLOR = "#904EE2";
const TICKET_TYPES = {
  story: { color: "#63BA3C", Icon: BookOpenIcon },
  bug: { color: "#E5493A", Icon: BugIcon },
} satisfies Record<WorkbenchTicketKind, unknown>;

const labelColor = (color: string) => ({ "--label": color }) as CSSProperties;

/** `control` matches the height of an `xs` button in the same row. */
type WorkbenchTicketBadgeSize = "default" | "control";

export function WorkbenchTicketTypeBadge({
  kind,
  size = "default",
}: {
  kind: WorkbenchTicketKind;
  size?: WorkbenchTicketBadgeSize;
}) {
  const { color, Icon } = TICKET_TYPES[kind];
  return (
    <Badge size={size} variant="label" style={labelColor(color)}>
      <Icon />
      {WORKBENCH_TICKET_KIND_LABELS[kind]}
    </Badge>
  );
}

/** The ticket's Jira issue type, as an icon in its type colour. */
export function WorkbenchTicketKindIcon({ kind }: { kind: WorkbenchTicketKind }) {
  const { color, Icon } = TICKET_TYPES[kind];
  return <Icon aria-hidden className="size-3.5 shrink-0" style={{ color }} />;
}

export function WorkbenchEpicBadge({ title, className }: { title: string; className?: string }) {
  return (
    <Badge size="default" variant="label" style={labelColor(EPIC_COLOR)} className={className}>
      <Layers3Icon />
      <span className="truncate">{title}</span>
    </Badge>
  );
}

/** The linked Jira issue's key, opening the issue. Unlinked records show nothing. */
export function WorkbenchJiraIssueKeyLink({
  jiraIssue,
  size = "default",
  className,
}: {
  jiraIssue: WorkbenchJiraIssue | null | undefined;
  size?: WorkbenchTicketBadgeSize;
  className?: string;
}) {
  if (!jiraIssue) return null;
  return (
    <Badge
      size={size}
      variant="info"
      render={<a href={jiraIssue.url} target="_blank" rel="noopener noreferrer" />}
      aria-label={`Open Jira issue ${jiraIssue.key}`}
      onClick={(event) => event.stopPropagation()}
      className={className}
    >
      <span className="font-mono">{jiraIssue.key}</span>
      <ExternalLinkIcon />
    </Badge>
  );
}

export function WorkbenchTicketCopyMenuItems({
  ticketId,
  jiraIssue,
}: {
  ticketId: string;
  jiraIssue: WorkbenchJiraIssue | null | undefined;
}) {
  const issue = jiraIssue;
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
