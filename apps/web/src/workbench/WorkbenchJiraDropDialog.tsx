import type {
  EnvironmentId,
  WorkbenchJiraIssueLink,
  WorkbenchJiraTicketTransition,
  WorkbenchTicket,
} from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { useEnvironmentQuery } from "../state/query";
import type { WorkbenchJiraTransitionSelection } from "./WorkbenchTicketStatusMenu";
import { workbenchEnvironment } from "./state";
import { getWorkbenchJiraDropAction } from "./workbenchBoardDrag.logic";

export function WorkbenchJiraDropDialog({
  environmentId,
  ticket,
  jiraIssueLink,
  columnTitle,
  jiraStatusIds,
  onTransition,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly ticket: WorkbenchTicket;
  readonly jiraIssueLink: WorkbenchJiraIssueLink;
  readonly columnTitle: string;
  readonly jiraStatusIds: ReadonlyArray<string>;
  readonly onTransition: (selection: WorkbenchJiraTransitionSelection) => void;
  readonly onClose: () => void;
}) {
  const {
    data: result,
    error,
    isPending,
    refresh,
  } = useEnvironmentQuery(
    workbenchEnvironment.jiraGetTicketTransitions({
      environmentId,
      input: {
        ticketId: ticket.id,
        remoteUpdatedAt: jiraIssueLink.issue.remoteUpdatedAt,
      },
    }),
  );
  const appliedTransitionKeyRef = useRef<string | null>(null);
  // Cached transitions can be used during refresh: the write validates both the
  // remote revision and transition availability again before changing Jira.
  const action = result !== null ? getWorkbenchJiraDropAction({ result, jiraStatusIds }) : null;

  useEffect(() => {
    if (action?.kind !== "transition" || result === null) return;

    const transitionKey = `${ticket.id}:${result.remoteUpdatedAt}:${action.transition.id}`;
    if (appliedTransitionKeyRef.current === transitionKey) return;
    appliedTransitionKeyRef.current = transitionKey;
    onClose();
    onTransition({
      ticket,
      transitionId: action.transition.id,
      destination: action.transition.to,
      expectedRemoteUpdatedAt: result.remoteUpdatedAt,
    });
  }, [action, onClose, onTransition, result, ticket]);

  const selectTransition = (transition: WorkbenchJiraTicketTransition) => {
    if (result === null) return;
    onClose();
    onTransition({
      ticket,
      transitionId: transition.id,
      destination: transition.to,
      expectedRemoteUpdatedAt: result.remoteUpdatedAt,
    });
  };

  if (action?.kind === "transition") return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            Move {jiraIssueLink.issue.key} to {columnTitle}
          </DialogTitle>
          <DialogDescription>Choose a Jira transition for “{ticket.title}”.</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          {error && result === null ? (
            <div className="space-y-3">
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
              <Button disabled={isPending} onClick={refresh} variant="outline">
                Retry
              </Button>
            </div>
          ) : result === null ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading Jira transitions…
            </p>
          ) : action?.kind === "unavailable" ? (
            <p
              role="status"
              className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
            >
              {action.reason}
            </p>
          ) : action?.kind === "choose" ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Choose a transition to move this ticket to {columnTitle}.
              </p>
              {action.transitions.map((transition) => (
                <Button
                  key={transition.id}
                  className="w-full justify-start"
                  onClick={() => selectTransition(transition)}
                  variant="outline"
                >
                  <span className="min-w-0 text-left">
                    <span className="block truncate">{transition.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {transition.to.name}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
