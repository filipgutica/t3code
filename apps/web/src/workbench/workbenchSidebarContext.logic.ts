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

import { getWorkbenchThreadsById, WORKBENCH_TICKET_STATUS_LABELS } from "./workbench.logic";
import {
  getWorkbenchBoardRepositoriesById,
  getWorkbenchRemoteRepositories,
} from "./workbenchRemote.logic";
import { getWorkbenchTicketPullRequests } from "./workbenchPullRequests.logic";
import {
  getTicketIssue,
  getTicketReferences,
  type WorkbenchReferencesByTicket,
} from "./workbenchReferences.logic";
import {
  getWorkbenchTicketExecutionStatuses,
  getWorkbenchTicketThreadStatuses,
} from "./workbenchThreadStatus.logic";

/** Project already-loaded context once, without fetching PRs for each sidebar row. */
export const getWorkbenchSidebarTicketDetails = ({
  environmentId,
  tickets,
  assignments,
  threads,
  projects,
  workbenchProjects,
  environmentLabels,
  referencesByTicket,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly tickets: ReadonlyArray<
    Pick<WorkbenchTicket, "id" | "projectId" | "status" | "blocked" | "repositoryProjectIds">
  >;
  readonly assignments: ReadonlyArray<
    Pick<WorkbenchAssignment, "ticketId" | "threadId" | "supersededAt" | "environmentId">
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
  readonly workbenchProjects: ReadonlyArray<
    Pick<WorkbenchProject, "id" | "archivedAt" | "remoteProjects">
  >;
  readonly environmentLabels: ReadonlyMap<EnvironmentId, string>;
  readonly referencesByTicket: WorkbenchReferencesByTicket;
}) => {
  const threadsById = getWorkbenchThreadsById({
    hostEnvironmentId: environmentId,
    assignments,
    threads,
  });
  const hostProjects = projects.filter((project) => project.environmentId === environmentId);
  const remoteRepositoriesByBoard = getWorkbenchRemoteRepositories({
    boards: workbenchProjects,
    projects,
    environmentLabels,
  });
  const repositoriesByBoard = new Map(
    [...remoteRepositoriesByBoard].map(([boardId, remoteRepositories]) => [
      boardId,
      getWorkbenchBoardRepositoriesById({ hostProjects, remoteRepositories }),
    ]),
  );
  const hostRepositoriesById = getWorkbenchBoardRepositoriesById({
    hostProjects,
    remoteRepositories: undefined,
  });
  const activeWorkspaceIds = new Set(
    workbenchProjects.filter((workspace) => workspace.archivedAt == null).map(({ id }) => id),
  );
  const executionInput = { environmentId, assignments, threadsById };
  const executionStatuses = getWorkbenchTicketExecutionStatuses(executionInput);
  const threadStatuses = getWorkbenchTicketThreadStatuses(executionInput);
  const assignmentsByTicket = new Map<
    WorkbenchTicketId,
    Array<Pick<WorkbenchAssignment, "threadId" | "environmentId">>
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
            const repository = (
              repositoriesByBoard.get(ticket.projectId) ?? hostRepositoriesById
            ).get(id);
            return repository ? [repository.title] : [];
          }),
          threads: (threadStatuses.get(ticket.id) ?? []).map((entry) => ({
            ...entry,
            title: threadsById.get(entry.threadId)?.title ?? "",
          })),
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
