import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  WorkbenchJiraGetTicketTransitionsResult,
  WorkbenchJiraIssueLink,
  WorkbenchTicket,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../components/ui/menu";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { getWorkbenchTicketStatusMoves, WORKBENCH_TICKET_STATUS_LABELS } from "./workbench.logic";

export interface WorkbenchJiraTransitionSelection {
  readonly ticket: WorkbenchTicket;
  readonly transitionId: string;
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
  const getTransitions = useAtomCommand(workbenchEnvironment.jiraGetTicketTransitions, {
    reportFailure: false,
  });
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<WorkbenchJiraGetTicketTransitionsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );

  const loadTransitions = async () => {
    const currentRequest = ++requestId.current;
    setResult(null);
    setError(null);
    const response = await getTransitions({ environmentId, input: { ticketId: ticket.id } });
    if (currentRequest !== requestId.current) return;
    if (response._tag === "Failure") {
      if (isAtomCommandInterrupted(response)) {
        setError("Loading was interrupted. Please retry.");
        return;
      }
      const cause = squashAtomCommandFailure(response);
      setError(cause instanceof Error ? cause.message : "Could not load Jira transitions.");
      return;
    }
    setResult(response.value);
  };

  return (
    <Menu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen && jiraIssueLink) void loadTransitions();
        if (!nextOpen) requestId.current += 1;
      }}
    >
      <MenuTrigger
        aria-label={`Change status of ${ticket.title}`}
        disabled={disabled}
        render={trigger}
      />
      <MenuPopup align="end" className="min-w-44 max-w-80">
        {jiraIssueLink ? (
          error ? (
            <>
              <p role="alert" className="px-2 py-1 text-xs text-destructive-foreground">
                {error}
              </p>
              <MenuItem closeOnClick={false} onClick={() => void loadTransitions()}>
                Retry
              </MenuItem>
            </>
          ) : result === null ? (
            <MenuItem disabled>Loading Jira transitions…</MenuItem>
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
          )
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
