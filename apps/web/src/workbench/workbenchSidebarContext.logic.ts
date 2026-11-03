import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  WorkbenchAssignment,
  WorkbenchProject,
  WorkbenchTicket,
  WorkbenchTicketId,
} from "@t3tools/contracts";

import { WORKBENCH_TICKET_STATUS_LABELS } from "./workbench.logic";
import { getWorkbenchTicketPullRequests } from "./workbenchPullRequests.logic";
import {
  getTicketIssue,
  getTicketReferences,
  type WorkbenchReferencesByTicket,
} from "./workbenchReferences.logic";
import { getWorkbenchTicketExecutionStatuses } from "./workbenchThreadStatus.logic";

/** Project already-loaded context once, without fetching PRs for each sidebar row. */
export const getWorkbenchSidebarTicketDetails = ({
  environmentId,
  tickets,
  assignments,
  threads,
  projects,
  workbenchProjects,
  referencesByTicket,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly tickets: ReadonlyArray<
    Pick<WorkbenchTicket, "id" | "projectId" | "status" | "blocked" | "repositoryProjectIds">
  >;
  readonly assignments: ReadonlyArray<
    Pick<WorkbenchAssignment, "ticketId" | "threadId" | "supersededAt">
  >;
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
      | "hasPendingApprovals"
      | "hasPendingUserInput"
      | "runtime"
      | "latestRun"
      | "goal"
      | "archivedAt"
    >
  >;
  readonly projects: ReadonlyArray<Pick<EnvironmentProject, "id" | "environmentId" | "title">>;
  readonly workbenchProjects: ReadonlyArray<Pick<WorkbenchProject, "id" | "archivedAt">>;
  readonly referencesByTicket: WorkbenchReferencesByTicket;
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
  const activeWorkspaceIds = new Set(
    workbenchProjects.filter((workspace) => workspace.archivedAt == null).map(({ id }) => id),
  );
  const executionStatuses = getWorkbenchTicketExecutionStatuses({
    environmentId,
    assignments,
    threadsById,
  });
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
      const ticketAssignments = assignmentsByTicket.get(ticket.id) ?? [];
      return [
        ticket.id,
        {
          environmentId,
          readOnly: environmentId === null || !activeWorkspaceIds.has(ticket.projectId),
          executionStatus: executionStatuses.get(ticket.id) ?? null,
          statusLabel: WORKBENCH_TICKET_STATUS_LABELS[ticket.status],
          attentionLabel: ticket.blocked ? "Blocked" : null,
          issue: getTicketIssue(getTicketReferences(referencesByTicket, ticket.id)),
          repositories: ticket.repositoryProjectIds.flatMap((id) => {
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
