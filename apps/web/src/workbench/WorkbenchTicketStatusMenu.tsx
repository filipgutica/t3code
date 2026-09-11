import type {
  EnvironmentId,
  WorkbenchJiraIssueLink,
  WorkbenchJiraTicketTransition,
  WorkbenchTicket,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";
import { useState, type ReactElement, type ReactNode } from "react";

import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../components/ui/menu";
import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";
import { getWorkbenchTicketStatusMoves, WORKBENCH_TICKET_STATUS_LABELS } from "./workbench.logic";

export interface WorkbenchJiraTransitionSelection {
  readonly ticket: WorkbenchTicket;
  readonly transitionId: string;
  readonly destination: WorkbenchJiraTicketTransition["to"];
  readonly expectedRemoteUpdatedAt: string | null;
}

export function WorkbenchTicketStatusMenu({
  environmentId,
  ticket,
  jiraIssueLink,
  disabled,
  trigger,
  children,
  onStatusChange,
  onJiraTransition,
}: {
  readonly environmentId: EnvironmentId;
  readonly ticket: WorkbenchTicket;
  readonly jiraIssueLink: WorkbenchJiraIssueLink | null;
  readonly disabled: boolean;
  readonly trigger: ReactElement;
  readonly children?: ReactNode;
  readonly onStatusChange: (status: WorkbenchTicketStatus) => void;
  readonly onJiraTransition: (selection: WorkbenchJiraTransitionSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const {
    data: result,
    error,
    isPending,
    refresh,
  } = useEnvironmentQuery(
    open && jiraIssueLink
      ? workbenchEnvironment.jiraGetTicketTransitions({
          environmentId,
          input: {
            ticketId: ticket.id,
            remoteUpdatedAt: jiraIssueLink.issue.remoteUpdatedAt,
          },
        })
      : null,
  );

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        aria-label={`Change status of ${ticket.title}`}
        disabled={disabled}
        render={trigger}
      />
      <MenuPopup align="end" className="min-w-44 max-w-80">
        {jiraIssueLink ? (
          <>
            {error ? (
              <>
                <p role="alert" className="px-2 py-1 text-xs text-destructive-foreground">
                  {error}
                </p>
                <MenuItem closeOnClick={false} disabled={isPending} onClick={refresh}>
                  Retry
                </MenuItem>
              </>
            ) : null}
            {result === null ? (
              error ? null : (
                <MenuItem disabled>Loading Jira transitions…</MenuItem>
              )
            ) : result.remoteUpdatedAt === null ? (
              <MenuItem disabled>Refresh Jira before changing status.</MenuItem>
            ) : result.transitions.length === 0 ? (
              <MenuItem disabled>No transitions available.</MenuItem>
            ) : (
              result.transitions.map((transition) => (
                <MenuItem
                  key={transition.id}
                  disabled={disabled || transition.unavailableReason !== null}
                  onClick={() =>
                    onJiraTransition({
                      ticket,
                      transitionId: transition.id,
                      destination: transition.to,
                      expectedRemoteUpdatedAt: result.remoteUpdatedAt,
                    })
                  }
                >
                  <span className="min-w-0">
                    <span className="block">{transition.to.name}</span>
                    {transition.name !== transition.to.name ? (
                      <span className="block text-xs text-muted-foreground">{transition.name}</span>
                    ) : null}
                    {transition.unavailableReason ? (
                      <span className="block text-xs text-muted-foreground">
                        {transition.unavailableReason}
                      </span>
                    ) : null}
                  </span>
                </MenuItem>
              ))
            )}
            {result !== null && isPending ? (
              <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
                Refreshing Jira transitions…
              </p>
            ) : null}
          </>
        ) : (
          getWorkbenchTicketStatusMoves(ticket.status).map((status) => (
            <MenuItem key={status} disabled={disabled} onClick={() => onStatusChange(status)}>
              {WORKBENCH_TICKET_STATUS_LABELS[status]}
            </MenuItem>
          ))
        )}
        {children ? (
          <>
            <MenuSeparator />
            {children}
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
