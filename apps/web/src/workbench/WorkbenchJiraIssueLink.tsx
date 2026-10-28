import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  parseJiraIssueUrl,
  WORKBENCH_JIRA_ISSUE_URL_ERROR,
  type WorkbenchEpic,
} from "@t3tools/contracts";
import { useState } from "react";

import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { WorkbenchUrlPopover } from "./WorkbenchReferences";
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
