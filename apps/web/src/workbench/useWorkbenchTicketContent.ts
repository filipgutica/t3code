import type { EnvironmentId, WorkbenchTicket } from "@t3tools/contracts";
import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";

export function useWorkbenchTicketContent(environmentId: EnvironmentId, ticket: WorkbenchTicket) {
  const query = useEnvironmentQuery(
    ticket.markdownOmitted
      ? workbenchEnvironment.ticket({
          environmentId,
          input: { ticketId: ticket.id, revision: ticket.revision },
        })
      : null,
  );
  return {
    ticket: ticket.markdownOmitted ? query.data : ticket,
    error:
      query.error ??
      (query.isSuccess && query.data === null ? "This Ticket no longer exists." : null),
    refresh: query.refresh,
  };
}
