import type {
  EnvironmentId,
  ProjectId,
  WorkbenchTicket,
  WorkbenchTicketWorkspace,
} from "@t3tools/contracts";

export type WorkbenchRepositoryScope = Pick<
  WorkbenchTicket,
  "primaryT3ProjectId" | "repositoryProjectIds"
>;

export type WorkbenchRepositoryScopeDraft = {
  readonly environmentId: EnvironmentId;
  readonly ticket: WorkbenchTicket;
  readonly value: WorkbenchRepositoryScope;
  readonly prepare: boolean;
};

export const getWorkbenchRepositoryScope = (ticket: WorkbenchTicket): WorkbenchRepositoryScope => ({
  primaryT3ProjectId: ticket.primaryT3ProjectId,
  repositoryProjectIds: ticket.repositoryProjectIds,
});

export const isWorkbenchRepositoryScopeEqual = (
  left: WorkbenchRepositoryScope,
  right: WorkbenchRepositoryScope,
) =>
  left.primaryT3ProjectId === right.primaryT3ProjectId &&
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
  scope.repositoryProjectIds.includes(scope.primaryT3ProjectId) &&
  new Set(scope.repositoryProjectIds).size === scope.repositoryProjectIds.length &&
  scope.repositoryProjectIds.every((id) => projects.some((project) => project.id === id));

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
