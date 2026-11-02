import type {
  EnvironmentId,
  ProjectId,
  WorkbenchTicket,
  WorkbenchTicketWorkspace,
} from "@t3tools/contracts";

export type WorkbenchRepositoryScope = Pick<WorkbenchTicket, "repositoryProjectIds">;

export type WorkbenchRepositoryScopeDraft = {
  readonly environmentId: EnvironmentId;
  readonly ticket: WorkbenchTicket;
  readonly value: WorkbenchRepositoryScope;
  readonly prepare: boolean;
};

export const getWorkbenchRepositoryScope = (ticket: WorkbenchTicket): WorkbenchRepositoryScope => ({
  repositoryProjectIds: ticket.repositoryProjectIds,
});

export const isWorkbenchRepositoryScopeEqual = (
  left: WorkbenchRepositoryScope,
  right: WorkbenchRepositoryScope,
) =>
  left.repositoryProjectIds.length === right.repositoryProjectIds.length &&
  left.repositoryProjectIds.every((id, index) => id === right.repositoryProjectIds[index]);

export const isWorkbenchRepositoryScopeValid = ({
  scope,
  projects,
}: {
  readonly scope: WorkbenchRepositoryScope;
  readonly projects: ReadonlyArray<{ readonly id: ProjectId }>;
}) =>
  scope.repositoryProjectIds.length > 0 &&
  new Set(scope.repositoryProjectIds).size === scope.repositoryProjectIds.length &&
  scope.repositoryProjectIds.every((id) => projects.some((project) => project.id === id));

/**
 * The repository a new Thread works in: `preferred` while the Ticket still links it, else the
 * first. Callers prefer the user's pick, or the repository of the Ticket's active Thread.
 */
export const resolveWorkbenchThreadRepository = ({
  ticket,
  preferred,
}: {
  readonly ticket: WorkbenchRepositoryScope;
  readonly preferred: ProjectId | undefined;
}): ProjectId | undefined =>
  preferred !== undefined && ticket.repositoryProjectIds.includes(preferred)
    ? preferred
    : ticket.repositoryProjectIds[0];

export const isWorkbenchTicketWorkspaceReady = ({
  ticket,
  workspace,
}: {
  readonly ticket: WorkbenchRepositoryScope;
  readonly workspace: WorkbenchTicketWorkspace | undefined;
}) =>
  workspace?.status === "ready" &&
  ticket.repositoryProjectIds.every((id) =>
    workspace.repositories.some(
      (repository) => repository.projectId === id && repository.status === "ready",
    ),
  );
