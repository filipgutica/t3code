import type {
  EnvironmentId,
  WorkbenchJiraIssueLink,
  WorkbenchJiraTicketTransition,
  WorkbenchJiraGetTicketTransitionsResult,
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
            <JiraTransitionOptions
              result={result}
              error={error}
              ticket={ticket}
              disabled={disabled}
              onJiraTransition={onJiraTransition}
            />
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

function JiraTransitionOptions({
  result,
  error,
  ticket,
  disabled,
  onJiraTransition,
}: Pick<
  Parameters<typeof WorkbenchTicketStatusMenu>[0],
  "ticket" | "disabled" | "onJiraTransition"
> & { result: WorkbenchJiraGetTicketTransitionsResult | null; error: string | null }) {
  if (result === null)
    return error ? null : <MenuItem disabled>Loading Jira transitions…</MenuItem>;
  if (result.remoteUpdatedAt === null)
    return <MenuItem disabled>Refresh Jira before changing status.</MenuItem>;
  if (result.transitions.length === 0)
    return <MenuItem disabled>No transitions available.</MenuItem>;
  return (
    <>
      {result.transitions.map((transition) => (
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
      ))}
    </>
  );
}
