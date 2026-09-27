import type {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchTicket,
  WorkbenchTicketWorkspaceRepository,
} from "@t3tools/contracts";

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useComposerDraftStore } from "../composerDraftStore";
import { buildTicketReviewComment } from "./workbench.logic";

export function attachWorkbenchTicketContext(input: {
  readonly environmentId: EnvironmentId;
  readonly thread: {
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  };
  readonly ticket: Pick<
    WorkbenchTicket,
    "id" | "title" | "markdown" | "kind" | "repositoryProjectIds" | "primaryT3ProjectId"
  >;
  readonly projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly title: string;
    readonly workspaceRoot: string;
  }>;
  readonly repositories: ReadonlyArray<
    Pick<WorkbenchTicketWorkspaceRepository, "projectId" | "worktreePath" | "status">
  >;
}) {
  const { environmentId, thread, ticket, projects, repositories } = input;
  const preparedPaths = new Map(
    repositories
      .filter((repository) => repository.status === "ready")
      .map((repository) => [repository.projectId, repository.worktreePath]),
  );
  const threadProject = projects.find((project) => project.id === thread.projectId);
  const checkout = thread.worktreePath ?? threadProject?.workspaceRoot ?? "Directory unavailable";
  const comment = buildTicketReviewComment(
    {
      ...ticket,
      markdown: [
        ticket.markdown,
        "",
        "## Current Thread checkout",
        "",
        `${threadProject?.title ?? thread.projectId} — ${checkout}`,
      ].join("\n"),
    },
    projects.map((project) => ({
      ...project,
      workspaceRoot: preparedPaths.get(project.id) ?? project.workspaceRoot,
    })),
  );
  useComposerDraftStore
    .getState()
    .addReviewComment(scopeThreadRef(environmentId, thread.id), comment);
}
