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

// The snapshot decides whether a review is pending, and Accept and Undo name its revision, so
// only a read of that revision supplies the base; an earlier one shows the plain brief meanwhile.
const reviewBaseOf = (ticket: WorkbenchTicket, loaded: WorkbenchTicket | null) =>
  ticket.reviewPending === true && loaded?.revision === ticket.revision
    ? (loaded.reviewBase ?? null)
    : null;

// Summary state changes without a new revision, so take only the omitted fields from the query.
// An edit saves the snapshot's revision, so it must also carry the snapshot's markdown.
const withLoadedContent = (ticket: WorkbenchTicket, loaded: WorkbenchTicket | null) => {
  if (!loaded) return null;
  const { markdownOmitted, ...live } = ticket;
  return {
    ...live,
    markdown: markdownOmitted ? loaded.markdown : ticket.markdown,
    progress: loaded.progress ?? "",
    reviewBase: reviewBaseOf(ticket, loaded),
  };
};

/** The Ticket to show: the snapshot's, with whatever the query loads for it. */
const shownTicket = (ticket: WorkbenchTicket, loaded: WorkbenchTicket | null) => {
  if (omitsContent(ticket)) return withLoadedContent(ticket, loaded);
  return ticket.reviewPending === true
    ? { ...ticket, reviewBase: reviewBaseOf(ticket, loaded) }
    : ticket;
};

export function useWorkbenchTicketContent(environmentId: EnvironmentId, ticket: WorkbenchTicket) {
  const omitted = omitsContent(ticket);
  // Snapshots omit a pending review's base; the Ticket stays shown while it loads.
  const reviewing = ticket.reviewPending === true;
  const query = useEnvironmentQuery(
    omitted || reviewing
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
    ticket: shownTicket(ticket, query.data ?? previous),
    error:
      query.error ??
      (query.isSuccess && query.data === null ? "This Ticket no longer exists." : null),
    refresh: query.refresh,
  };
}
