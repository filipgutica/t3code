import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { BlocksIcon, TicketIcon } from "lucide-react";

import {
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../components/WorkspaceBreadcrumb";
import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";
import { getWorkbenchContextForThread, WORKBENCH_TICKET_STATUS_LABELS } from "./workbench.logic";

export function WorkbenchThreadBreadcrumb({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { data } = useEnvironmentQuery(workbenchEnvironment.snapshot({ environmentId, input: {} }));
  const context = getWorkbenchContextForThread(data ?? null, threadId);
  if (!context) return null;
  const { ticket, workspace: project } = context;

  return (
    <>
      <WorkspaceBreadcrumbItem className="hidden shrink-0 lg:flex">
        <Link
          aria-label={`Back to Workspace ${project.title} Board`}
          className="inline-flex h-7 max-w-48 items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2 text-xs font-medium text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          search={{ environmentId, workbenchProjectId: project.id }}
          title={`${project.title} Board`}
          to="/workbench"
        >
          <BlocksIcon className="size-3.5 shrink-0 text-primary" />
          <span className="hidden xl:inline">Agent Workbench</span>
          <span aria-hidden className="hidden text-muted-foreground/60 2xl:inline">
            ·
          </span>
          <span className="hidden truncate text-muted-foreground 2xl:inline">{project.title}</span>
          <span className="xl:hidden">Workbench</span>
        </Link>
      </WorkspaceBreadcrumbItem>
      <WorkspaceBreadcrumbSeparator className="hidden lg:flex" />
      <WorkspaceBreadcrumbItem className="min-w-0 shrink">
        <Link
          aria-label={`Back to Ticket ${ticket.title} in Workspace ${project.title}`}
          className="inline-flex h-7 min-w-0 max-w-64 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          search={{ environmentId, workbenchProjectId: project.id, ticketId: ticket.id }}
          title={`${project.title} · ${WORKBENCH_TICKET_STATUS_LABELS[ticket.status]}`}
          to="/workbench"
        >
          <BlocksIcon className="size-3.5 shrink-0 text-primary lg:hidden" />
          <TicketIcon className="hidden size-3.5 shrink-0 lg:block" />
          <span className="truncate">{ticket.title}</span>
          <span className="hidden shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground xl:inline">
            {WORKBENCH_TICKET_STATUS_LABELS[ticket.status]}
          </span>
        </Link>
      </WorkspaceBreadcrumbItem>
      <WorkspaceBreadcrumbSeparator />
    </>
  );
}
