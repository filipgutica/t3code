import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import {
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../components/WorkspaceBreadcrumb";
import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";

export function WorkbenchThreadBreadcrumb({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { data } = useEnvironmentQuery(workbenchEnvironment.snapshot({ environmentId, input: {} }));
  const assignment = data?.assignments.find((candidate) => candidate.threadId === threadId);
  const ticket = assignment
    ? data?.tickets.find((candidate) => candidate.id === assignment.ticketId)
    : undefined;
  const project = ticket
    ? data?.projects.find((candidate) => candidate.id === ticket.projectId)
    : undefined;
  if (!ticket || !project) return null;

  return (
    <>
      <WorkspaceBreadcrumbItem className="shrink-0">
        <Link
          aria-label={`Back to Workbench ticket ${ticket.title}`}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          search={{ projectId: project.id, ticketId: ticket.id }}
          to="/workbench"
        >
          <ArrowLeftIcon className="size-3.5 shrink-0" />
          <span className="hidden sm:inline">Back to</span>
          <span>Workbench</span>
        </Link>
      </WorkspaceBreadcrumbItem>
      <WorkspaceBreadcrumbSeparator />
    </>
  );
}
