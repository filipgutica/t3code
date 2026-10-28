import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  parseJiraIssueUrl,
  WORKBENCH_JIRA_ISSUE_URL_ERROR,
  type WorkbenchEpic,
  type WorkbenchJiraIssue,
  type WorkbenchReference,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import { useState } from "react";

import type { ChatMarkdownCodeBlock } from "../components/ChatMarkdown";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { useWorkbenchReferenceCommands, WorkbenchUrlPopover } from "./WorkbenchReferences";
import { reportWorkbenchCommandFailure } from "./workbenchPageCommands";
import { WorkbenchJiraIssueKeyLink } from "./WorkbenchTicketMetadata";

/** Sets or clears an Epic's link against the version the user saw; resolves to an error message. */
function useSetWorkbenchEpicJiraIssueLink(environmentId: EnvironmentId) {
  const setLink = useAtomCommand(workbenchEnvironment.setJiraIssueLink, {
    reportFailure: false,
    reportDefect: false,
  });
  const canLink = useAtomValue(workbenchEnvironment.setJiraIssueLink.permissionAtom(environmentId));
  const apply = async (epic: WorkbenchEpic, url: string | null): Promise<string | null> => {
    const result = await setLink({
      environmentId,
      input: { epicId: epic.id, url, expectedUpdatedAt: epic.updatedAt },
    });
    let message: string | null = null;
    reportWorkbenchCommandFailure(result, (failure) => {
      message = failure;
    });
    return message;
  };
  return { apply, canLink };
}

/** Epic details row: Workbench stores the link and never reads Jira. */
export function WorkbenchEpicJiraIssueLinkField({
  environmentId,
  epic,
  disabled,
}: {
  readonly environmentId: EnvironmentId;
  readonly epic: WorkbenchEpic;
  readonly disabled: boolean;
}) {
  const { apply, canLink } = useSetWorkbenchEpicJiraIssueLink(environmentId);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const jiraIssue = epic.jiraIssue ?? null;
  const locked = disabled || !canLink || pending;
  const unlink = async () => {
    setPending(true);
    setError(await apply(epic, null).finally(() => setPending(false)));
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>Jira issue</Label>
        <div className="flex items-center gap-1">
          <WorkbenchUrlPopover
            trigger={jiraIssue ? "Change" : "Link issue"}
            triggerVariant="ghost"
            disabled={locked}
            heading="Link Jira issue"
            inputLabel="Jira issue URL"
            placeholder="https://your-site.atlassian.net/browse/PROJ-123"
            emptyHint="Paste the issue's URL from Jira."
            invalidMessage={WORKBENCH_JIRA_ISSUE_URL_ERROR}
            submitLabel="Link"
            initialUrl={jiraIssue?.url ?? ""}
            describe={(url) => {
              const parsed = parseJiraIssueUrl(url);
              return parsed ? `Links ${parsed.key}.` : null;
            }}
            onSubmit={({ url }) => apply(epic, url)}
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

const jiraLinkCardHeading = (ticket: WorkbenchTicket | null, linked: boolean, key: string) => {
  if (ticket === null) return `Create the ticket to link ${key}`;
  return linked ? `Linked ${key}` : `Link ${key} to this Ticket`;
};

/** The agent proposes a link; the user applies it, so no agent write permission is involved. */
export function WorkbenchJiraLinkCard({
  environmentId,
  block,
  ticket,
  references,
}: {
  readonly environmentId: EnvironmentId;
  readonly block: ChatMarkdownCodeBlock;
  readonly ticket: WorkbenchTicket | null;
  readonly references: ReadonlyArray<WorkbenchReference>;
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
  return (
    <JiraLinkCardBody
      environmentId={environmentId}
      issue={issue}
      ticket={ticket}
      references={references}
    />
  );
}

function JiraLinkCardBody({
  environmentId,
  issue,
  ticket,
  references,
}: {
  readonly environmentId: EnvironmentId;
  readonly issue: WorkbenchJiraIssue;
  readonly ticket: WorkbenchTicket | null;
  readonly references: ReadonlyArray<WorkbenchReference>;
}) {
  const commands = useWorkbenchReferenceCommands(environmentId);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Stored Reference URLs are normalized the same way as the parsed block URL.
  const linked = references.some((reference) => reference.url === issue.url);
  const link = async () => {
    if (ticket === null) return;
    setPending(true);
    setError(
      await commands.add({ ticketId: ticket.id, url: issue.url }).finally(() => setPending(false)),
    );
  };
  return (
    <section
      aria-label="Jira link"
      className="my-3 flex min-w-0 flex-col gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{jiraLinkCardHeading(ticket, linked, issue.key)}</h3>
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
            disabled={ticket === null || !commands.canEdit || pending}
            onClick={() => void link()}
          >
            Link
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
