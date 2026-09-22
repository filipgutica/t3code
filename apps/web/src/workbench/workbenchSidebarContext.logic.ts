import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  WorkbenchAssignment,
  WorkbenchEpic,
  WorkbenchJiraIssueLink,
  WorkbenchTicket,
  WorkbenchTicketId,
} from "@t3tools/contracts";

import { WORKBENCH_TICKET_STATUS_LABELS } from "./workbench.logic";
import { getWorkbenchTicketPullRequests } from "./workbenchPullRequests.logic";

/** Project already-loaded context once, without fetching PRs for each sidebar row. */
export const getWorkbenchSidebarTicketDetails = ({
  environmentId,
  tickets,
  assignments,
  threads,
  projects,
  epics,
  issueLinks,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly tickets: ReadonlyArray<
    Pick<
      WorkbenchTicket,
      | "id"
      | "kind"
      | "status"
      | "blocked"
      | "epicId"
      | "repositoryProjectIds"
      | "primaryT3ProjectId"
    >
  >;
  readonly assignments: ReadonlyArray<Pick<WorkbenchAssignment, "ticketId" | "threadId">>;
  readonly threads: ReadonlyArray<
    Pick<
      EnvironmentThreadShell,
      | "id"
      | "environmentId"
      | "projectId"
      | "title"
      | "pullRequests"
      | "linkedPullRequest"
      | "branchPullRequest"
    >
  >;
  readonly projects: ReadonlyArray<Pick<EnvironmentProject, "id" | "environmentId" | "title">>;
  readonly epics: ReadonlyArray<Pick<WorkbenchEpic, "id" | "title">>;
  readonly issueLinks: ReadonlyArray<WorkbenchJiraIssueLink>;
}) => {
  const threadsById = new Map(
    threads
      .filter((thread) => thread.environmentId === environmentId)
      .map((thread) => [thread.id, thread]),
  );
  const projectsById = new Map(
    projects
      .filter((project) => project.environmentId === environmentId)
      .map((project) => [project.id, project.title]),
  );
  const epicsById = new Map(epics.map((epic) => [epic.id, epic.title]));
  const issuesByTicket = new Map(issueLinks.map((link) => [link.ticketId, link]));
  const assignmentsByTicket = new Map<
    WorkbenchTicketId,
    Array<Pick<WorkbenchAssignment, "threadId">>
  >();
  for (const assignment of assignments) {
    const entries = assignmentsByTicket.get(assignment.ticketId) ?? [];
    entries.push(assignment);
    assignmentsByTicket.set(assignment.ticketId, entries);
  }
  return new Map(
    tickets.map((ticket) => {
      const issueLink = issuesByTicket.get(ticket.id);
      const ticketAssignments = assignmentsByTicket.get(ticket.id) ?? [];
      return [
        ticket.id,
        {
          environmentId,
          kind: ticket.kind,
          statusLabel:
            issueLink?.issue.status.name ?? WORKBENCH_TICKET_STATUS_LABELS[ticket.status],
          attentionLabel: issueLink
            ? issueLink.issue.flagged
              ? "Jira flagged"
              : null
            : ticket.blocked
              ? "Blocked"
              : null,
          issueLink,
          epicTitle: ticket.epicId ? epicsById.get(ticket.epicId) : undefined,
          repositories: (ticket.repositoryProjectIds.length
            ? ticket.repositoryProjectIds
            : [ticket.primaryT3ProjectId]
          ).flatMap((id) => {
            const title = projectsById.get(id);
            return title ? [title] : [];
          }),
          threadCount: new Set(
            ticketAssignments
              .filter(({ threadId }) => threadsById.has(threadId))
              .map(({ threadId }) => threadId),
          ).size,
          pullRequests: getWorkbenchTicketPullRequests({
            assignments: ticketAssignments,
            threadsById,
            archivedThreadsById: new Map(),
          }),
        },
      ];
    }),
  );
};

export type WorkbenchSidebarTicketDetails =
  ReturnType<typeof getWorkbenchSidebarTicketDetails> extends ReadonlyMap<
    WorkbenchTicketId,
    infer Details
  >
    ? Details
    : never;
