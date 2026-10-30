import { useState } from "react";
import type { EnvironmentId, WorkbenchTicket } from "@t3tools/contracts";
import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";

type LoadedTicketContent = { environmentId: EnvironmentId; ticket: WorkbenchTicket };

const previousContent = ({
  environmentId,
  ticket,
  content,
}: {
  environmentId: EnvironmentId;
  ticket: WorkbenchTicket;
  content: LoadedTicketContent | null;
}) =>
  content?.environmentId === environmentId && content.ticket.id === ticket.id
    ? content.ticket
    : null;

const omitsContent = (ticket: WorkbenchTicket) =>
  ticket.markdownOmitted || (ticket.progress === undefined && ticket.progressTotal !== undefined);

// Summary state changes without a new revision, so take only the omitted fields from the query.
const withLoadedContent = (ticket: WorkbenchTicket, loaded: WorkbenchTicket | null) => {
  if (!loaded) return null;
  const { markdownOmitted: _omitted, ...live } = ticket;
  return { ...live, markdown: loaded.markdown, progress: loaded.progress ?? "" };
};

export function useWorkbenchTicketContent(environmentId: EnvironmentId, ticket: WorkbenchTicket) {
  const omitted = omitsContent(ticket);
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
  // Keep the Ticket and its chat mounted while a new revision, such as a restore, loads its content.
  const previous =
    !query.isSuccess && query.error === null
      ? previousContent({ environmentId, ticket, content: lastContent })
      : null;
  return {
    ticket: omitted ? withLoadedContent(ticket, query.data ?? previous) : ticket,
    error:
      query.error ??
      (query.isSuccess && query.data === null ? "This Ticket no longer exists." : null),
    refresh: query.refresh,
  };
}
