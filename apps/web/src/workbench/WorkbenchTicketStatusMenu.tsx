import type { WorkbenchTicket, WorkbenchTicketStatus } from "@t3tools/contracts";
import type { ReactElement, ReactNode } from "react";

import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../components/ui/menu";
import { getWorkbenchTicketStatusMoves, WORKBENCH_TICKET_STATUS_LABELS } from "./workbench.logic";

export function WorkbenchTicketStatusMenu({
  ticket,
  disabled,
  trigger,
  children,
  onStatusChange,
}: {
  readonly ticket: WorkbenchTicket;
  readonly disabled: boolean;
  readonly trigger: ReactElement;
  readonly children?: ReactNode;
  readonly onStatusChange: (status: WorkbenchTicketStatus) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        aria-label={`Change status of ${ticket.title}`}
        disabled={disabled}
        render={trigger}
      />
      <MenuPopup align="end" className="min-w-44 max-w-80">
        {getWorkbenchTicketStatusMoves(ticket.status).map((status) => (
          <MenuItem key={status} disabled={disabled} onClick={() => onStatusChange(status)}>
            {WORKBENCH_TICKET_STATUS_LABELS[status]}
          </MenuItem>
        ))}
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
