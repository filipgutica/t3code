import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  parseJiraIssueUrl,
  WORKBENCH_JIRA_ISSUE_URL_ERROR,
  type WorkbenchEpic,
  type WorkbenchJiraIssue,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import { useId, useState } from "react";

import type { ChatMarkdownCodeBlock } from "../components/ChatMarkdown";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { reportWorkbenchCommandFailure } from "./workbenchPageCommands";
import { WorkbenchJiraIssueKeyLink } from "./WorkbenchTicketMetadata";

export type WorkbenchJiraIssueLinkTarget =
  | { readonly kind: "ticket"; readonly ticket: WorkbenchTicket }
  | { readonly kind: "epic"; readonly epic: WorkbenchEpic };

const targetRecord = (target: WorkbenchJiraIssueLinkTarget) =>
  target.kind === "ticket" ? target.ticket : target.epic;

/** Sets or clears a link against the record version the user saw; resolves to an error message. */
function useSetWorkbenchJiraIssueLink(environmentId: EnvironmentId) {
  const setLink = useAtomCommand(workbenchEnvironment.setJiraIssueLink, {
    reportFailure: false,
    reportDefect: false,
  });
  const canLink = useAtomValue(workbenchEnvironment.setJiraIssueLink.permissionAtom(environmentId));
  const apply = async (
    target: WorkbenchJiraIssueLinkTarget,
    url: string | null,
  ): Promise<string | null> => {
    const result = await setLink({
      environmentId,
      input:
        target.kind === "ticket"
          ? {
              kind: "ticket",
              ticketId: target.ticket.id,
              url,
              expectedRevision: target.ticket.revision,
            }
          : {
              kind: "epic",
              epicId: target.epic.id,
              url,
              expectedUpdatedAt: target.epic.updatedAt,
            },
    });
    let message: string | null = null;
    reportWorkbenchCommandFailure(result, (failure) => {
      message = failure;
    });
    return message;
  };
  return { apply, canLink };
}

function JiraIssueUrlPopover({
  disabled,
  label,
  initialUrl,
  onSubmit,
}: {
  readonly disabled: boolean;
  readonly label: string;
  readonly initialUrl: string;
  readonly onSubmit: (url: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const helpId = useId();
  const parsed = parseJiraIssueUrl(url);
  const submit = async () => {
    if (parsed === null) {
      setError(WORKBENCH_JIRA_ISSUE_URL_ERROR);
      return;
    }
    setPending(true);
    const failure = await onSubmit(url.trim()).finally(() => setPending(false));
    if (failure === null) setOpen(false);
    else setError(failure);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setUrl(initialUrl);
          setError(null);
        }
      }}
    >
      <PopoverTrigger
        render={<Button size="xs" type="button" variant="ghost" disabled={disabled} />}
      >
        {label}
      </PopoverTrigger>
      <PopoverPopup width="md" padding="compact" align="end">
        <form
          className="space-y-2 p-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <PopoverTitle>Link Jira issue</PopoverTitle>
          <Input
            aria-label="Jira issue URL"
            size="sm"
            font="mono"
            autoFocus
            placeholder="https://your-site.atlassian.net/browse/PROJ-123"
            value={url}
            aria-invalid={error !== null}
            aria-describedby={helpId}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
          />
          <p
            id={helpId}
            role={error === null ? undefined : "alert"}
            className={
              error === null ? "text-muted-foreground text-xs" : "text-destructive text-xs"
            }
          >
            {error ?? (parsed ? `Links ${parsed.key}.` : "Paste the issue's URL from Jira.")}
          </p>
          <div className="flex justify-end gap-2">
            <Button size="xs" type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="xs" type="submit" disabled={pending || url.trim() === ""}>
              Link
            </Button>
          </div>
        </form>
      </PopoverPopup>
    </Popover>
  );
}

/** Ticket and Epic details row: Workbench stores the link and never reads Jira. */
export function WorkbenchJiraIssueLinkField({
  environmentId,
  target,
  disabled,
}: {
  readonly environmentId: EnvironmentId;
  readonly target: WorkbenchJiraIssueLinkTarget;
  readonly disabled: boolean;
}) {
  const { apply, canLink } = useSetWorkbenchJiraIssueLink(environmentId);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const jiraIssue = targetRecord(target).jiraIssue ?? null;
  const locked = disabled || !canLink || pending;
  const unlink = async () => {
    setPending(true);
    setError(await apply(target, null).finally(() => setPending(false)));
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>Jira issue</Label>
        <div className="flex items-center gap-1">
          <JiraIssueUrlPopover
            disabled={locked}
            label={jiraIssue ? "Change" : "Link issue"}
            initialUrl={jiraIssue?.url ?? ""}
            onSubmit={(url) => apply(target, url)}
          />
          {jiraIssue ? (
            <Button
              size="xs"
              type="button"
              variant="ghost"
              disabled={locked}
              onClick={() => void unlink()}
            >
              Unlink
            </Button>
          ) : null}
        </div>
      </div>
      {jiraIssue ? (
        <WorkbenchJiraIssueKeyLink jiraIssue={jiraIssue} />
      ) : (
        <p className="text-muted-foreground text-sm">Not linked</p>
      )}
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Reads an agent's `workbench-jira-link` block; anything but a Jira issue URL is rejected. */
const readWorkbenchJiraLinkBlock = (code: string): WorkbenchJiraIssue | null => {
  try {
    const value: unknown = JSON.parse(code);
    if (typeof value !== "object" || value === null || !("url" in value)) return null;
    return typeof value.url === "string" ? parseJiraIssueUrl(value.url) : null;
  } catch {
    return null;
  }
};

// Keys repeat across Jira sites, so an issue is its key on its host.
const jiraHost = (issue: WorkbenchJiraIssue) => new URL(issue.url).host;
const sameJiraIssue = (left: WorkbenchJiraIssue, right: WorkbenchJiraIssue) =>
  left.key === right.key && jiraHost(left) === jiraHost(right);

const jiraLinkCardHeading = (ticket: WorkbenchTicket | null, issue: WorkbenchJiraIssue) => {
  if (ticket === null) return `Create the ticket to link ${issue.key}`;
  const current = ticket.jiraIssue ?? null;
  if (current === null) return `Link ${issue.key} to this Ticket`;
  if (sameJiraIssue(current, issue)) return `Linked ${issue.key}`;
  return current.key === issue.key
    ? `Replace ${current.key} on ${jiraHost(current)} with ${issue.key} on ${jiraHost(issue)}?`
    : `Replace ${current.key} with ${issue.key}?`;
};

/** The agent proposes a link; the user applies it, so no agent write permission is involved. */
export function WorkbenchJiraLinkCard({
  environmentId,
  block,
  ticket,
}: {
  readonly environmentId: EnvironmentId;
  readonly block: ChatMarkdownCodeBlock;
  readonly ticket: WorkbenchTicket | null;
}) {
  const issue = block.isComplete ? readWorkbenchJiraLinkBlock(block.code) : null;
  if (block.isStreaming || issue === null) {
    return (
      <p role="status" className="my-3 text-sm text-muted-foreground">
        {block.isStreaming
          ? "Preparing Jira link…"
          : "This Jira link is not a Jira issue URL. Ask the agent to try again."}
      </p>
    );
  }
  return <JiraLinkCardBody environmentId={environmentId} issue={issue} ticket={ticket} />;
}

function JiraLinkCardBody({
  environmentId,
  issue,
  ticket,
}: {
  readonly environmentId: EnvironmentId;
  readonly issue: WorkbenchJiraIssue;
  readonly ticket: WorkbenchTicket | null;
}) {
  const { apply, canLink } = useSetWorkbenchJiraIssueLink(environmentId);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const current = ticket?.jiraIssue ?? null;
  const linked = current !== null && sameJiraIssue(current, issue);
  const link = async () => {
    if (ticket === null) return;
    setPending(true);
    setError(await apply({ kind: "ticket", ticket }, issue.url).finally(() => setPending(false)));
  };
  return (
    <section
      aria-label="Jira link"
      className="my-3 flex min-w-0 flex-col gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{jiraLinkCardHeading(ticket, issue)}</h3>
          <a
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate font-mono text-muted-foreground text-xs hover:underline"
          >
            {issue.url}
          </a>
        </div>
        {linked ? (
          <Badge variant="outline">Linked</Badge>
        ) : (
          <Button
            size="xs"
            variant={current ? "outline" : "default"}
            disabled={ticket === null || !canLink || pending}
            onClick={() => void link()}
          >
            {current ? "Replace" : "Link"}
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </section>
  );
}
