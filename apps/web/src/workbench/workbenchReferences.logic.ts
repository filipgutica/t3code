import {
  parseWorkbenchReferenceUrl,
  workbenchTicketIssueReferences,
  type ProjectId,
  type WorkbenchParsedReferenceUrl,
  type WorkbenchReference,
  type WorkbenchTicketId,
} from "@t3tools/contracts";

export type WorkbenchReferencesByTicket = ReadonlyMap<
  WorkbenchTicketId,
  ReadonlyArray<WorkbenchReference>
>;

const NO_REFERENCES: ReadonlyArray<WorkbenchReference> = [];

/** Groups a snapshot's References by owner once, keeping list order. */
export function groupWorkbenchReferences(
  references: ReadonlyArray<WorkbenchReference>,
): WorkbenchReferencesByTicket {
  const byTicket = new Map<WorkbenchTicketId, Array<WorkbenchReference>>();
  for (const reference of references) {
    const owned = byTicket.get(reference.ticketId);
    if (owned) owned.push(reference);
    else byTicket.set(reference.ticketId, [reference]);
  }
  return byTicket;
}

export const getTicketReferences = (
  byTicket: WorkbenchReferencesByTicket,
  ticketId: WorkbenchTicketId,
): ReadonlyArray<WorkbenchReference> => byTicket.get(ticketId) ?? NO_REFERENCES;

export interface WorkbenchReferenceView {
  readonly reference: WorkbenchReference;
  readonly parsed: WorkbenchParsedReferenceUrl;
}

// Stored URLs that no longer parse (legacy data) still show as plain links.
const viewOf = (reference: WorkbenchReference): WorkbenchReferenceView => ({
  reference,
  parsed: parseWorkbenchReferenceUrl(reference.url) ?? {
    url: reference.url,
    kind: "link",
    label: reference.url,
  },
});

/** Pull request References belong to the Pull requests section, not the References list. */
export function splitWorkbenchReferences(references: ReadonlyArray<WorkbenchReference>): {
  readonly listed: ReadonlyArray<WorkbenchReferenceView>;
  readonly pullRequests: ReadonlyArray<WorkbenchReferenceView>;
} {
  const listed: Array<WorkbenchReferenceView> = [];
  const pullRequests: Array<WorkbenchReferenceView> = [];
  for (const view of references.map(viewOf)) {
    (view.parsed.kind === "github_pull_request" ? pullRequests : listed).push(view);
  }
  return { listed, pullRequests };
}

/** The first issue Reference, which supplies a Ticket's short identity label. */
export const getTicketIssue = (
  references: ReadonlyArray<WorkbenchReference>,
): WorkbenchParsedReferenceUrl | null => workbenchTicketIssueReferences(references)[0] ?? null;

/** Jira-imported descriptions use wiki markup; a Jira Reference keeps their preview readable. */
export const hasJiraReference = (references: ReadonlyArray<WorkbenchReference>) =>
  workbenchTicketIssueReferences(references).some((issue) => issue.kind === "jira_issue");

/** Every Reference label and title, which Board and sidebar search match. */
export const getWorkbenchReferenceSearchTerms = (
  references: ReadonlyArray<WorkbenchReference>,
): ReadonlyArray<string> =>
  references.flatMap((reference) => {
    const { label } = viewOf(reference).parsed;
    return reference.title === null ? [label] : [label, reference.title];
  });

/** A repository the host can anchor a file read at; the first of `projectIds` that is known. */
export const getReferenceFileCwd = (
  projects: ReadonlyArray<{ readonly id: ProjectId; readonly workspaceRoot: string }>,
  projectIds: ReadonlyArray<ProjectId | null>,
): string | null => {
  for (const projectId of projectIds) {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (project) return project.workspaceRoot;
  }
  return null;
};
