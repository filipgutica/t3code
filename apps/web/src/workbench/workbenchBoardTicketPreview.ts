import type { WorkbenchTicket } from "@t3tools/contracts";

import { getWorkbenchTicketSummaryPresentation } from "./workbench.logic";
import { workbenchDescriptionMarkdown } from "./workbenchDescription.logic";

const MAX_EXCERPT_LENGTH = 180;
const MAX_DESCRIPTION_SCAN_LENGTH = 4_000;

function plainTextExcerptLine(line: string): string {
  if (/^#{1,6}\s/.test(line) || /^[|:\s-]+$/.test(line)) return "";
  return line
    .replace(/^(?:[-*+] |\d+[.)] )(?:\[[ xX]\] )?/, "")
    .replace(/^>\s*/, "")
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateDescriptionExcerpt(text: string): string {
  if (text.length <= MAX_EXCERPT_LENGTH) return text;
  const cut = text.slice(0, MAX_EXCERPT_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace >= 120 ? lastSpace : MAX_EXCERPT_LENGTH).trimEnd()}…`;
}

function descriptionExcerpt(markdown: string): string {
  const parts: string[] = [];
  let length = 0;
  let inCodeFence = false;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^(```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    const text = plainTextExcerptLine(line);
    if (!text) continue;
    parts.push(text);
    length += text.length + 1;
    if (length > MAX_EXCERPT_LENGTH) break;
  }
  return truncateDescriptionExcerpt(parts.join(" "));
}

export function getWorkbenchBoardTicketPreview({
  ticket,
}: {
  ticket: Pick<WorkbenchTicket, "markdown" | "generatedSummary" | "jiraIssue">;
}) {
  const summary = getWorkbenchTicketSummaryPresentation(ticket.generatedSummary);
  if (summary.hasText) {
    return { text: summary.text, source: "summary" as const, statusLabel: summary.statusLabel };
  }
  const excerpt = descriptionExcerpt(
    workbenchDescriptionMarkdown(
      ticket.markdown.slice(0, MAX_DESCRIPTION_SCAN_LENGTH),
      Boolean(ticket.jiraIssue),
    ),
  );
  if (excerpt) {
    return {
      text: excerpt,
      source: "description" as const,
      statusLabel:
        ticket.generatedSummary?.status === "pending"
          ? "Generating summary…"
          : "Description excerpt",
    };
  }
  return ticket.generatedSummary?.status === "pending"
    ? { text: "Generating summary…", source: "summary" as const, statusLabel: null }
    : {
        text: ticket.markdown.trim() ? "Description available" : "No description added yet",
        source: "description" as const,
        statusLabel: null,
      };
}
