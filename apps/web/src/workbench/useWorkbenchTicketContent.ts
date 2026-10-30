import { useState } from "react";
import type { EnvironmentId, WorkbenchTicket } from "@t3tools/contracts";
import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";

type LoadedTicketContent = { environmentId: EnvironmentId; ticket: WorkbenchTicket };

const previousActiveTicket = ({
  environmentId,
  ticket,
  content,
}: {
  environmentId: EnvironmentId;
  ticket: WorkbenchTicket;
  content: LoadedTicketContent | null;
}) =>
  content?.environmentId === environmentId &&
  content.ticket.id === ticket.id &&
  !ticket.archivedAt &&
  !content.ticket.archivedAt
    ? content.ticket
    : null;

export function useWorkbenchTicketContent(environmentId: EnvironmentId, ticket: WorkbenchTicket) {
  const omitted =
    ticket.markdownOmitted || (ticket.progress === undefined && ticket.progressTotal !== undefined);
  const query = useEnvironmentQuery(
    omitted
      ? workbenchEnvironment.ticket({
          environmentId,
          input: { ticketId: ticket.id, revision: ticket.revision },
        })
      : null,
  );
  const [lastContent, setLastContent] = useState<LoadedTicketContent | null>(null);
  if (
    query.data !== null &&
    (query.data !== lastContent?.ticket || environmentId !== lastContent?.environmentId)
  ) {
    setLastContent({ environmentId, ticket: query.data });
  }
  // Keep the active Ticket and its chat mounted while a new snapshot revision loads Progress.
  const previous =
    !query.isSuccess && query.error === null
      ? previousActiveTicket({ environmentId, ticket, content: lastContent })
      : null;
  return {
    ticket: omitted ? (query.data ?? previous) : ticket,
    error:
      query.error ??
      (query.isSuccess && query.data === null ? "This Ticket no longer exists." : null),
    refresh: query.refresh,
  };
}
