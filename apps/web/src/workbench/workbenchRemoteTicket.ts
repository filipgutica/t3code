import type { WorkbenchReference, WorkbenchTicket } from "@t3tools/contracts";

export const portableWorkbenchTicketPrompt = ({
  ticket,
  references,
  boardMachine,
}: {
  ticket: WorkbenchTicket;
  references: ReadonlyArray<WorkbenchReference>;
  boardMachine: string;
}) =>
  [
    `# ${ticket.title}`,
    `This Ticket lives on ${boardMachine}. This is a snapshot; this Thread cannot read or update the Ticket.`,
    ticket.markdown,
    "## References",
    ...references.map((reference) =>
      reference.title ? `- ${reference.title}: ${reference.url}` : `- ${reference.url}`,
    ),
    "## Progress",
    ticket.progress?.trim() ? ticket.progress : "No progress recorded.",
  ].join("\n\n");
