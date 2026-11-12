import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { BlocksIcon, TicketIcon } from "lucide-react";

import {
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../components/WorkspaceBreadcrumb";
import { Badge } from "../components/ui/badge";
import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";
import { useWorkbenchThreadOwner } from "./useWorkbenchThreadOwner";
import { getWorkbenchContextForThread, WORKBENCH_TICKET_STATUS_LABELS } from "./workbench.logic";
import { workbenchDescriptionLinks } from "./workbenchReferences.logic";
import { WorkbenchThreadReferencesMenu } from "./WorkbenchThreadReferencesMenu";

export function WorkbenchThreadBreadcrumb({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const threadRef = { environmentId, threadId };
  const hostEnvironmentId = useWorkbenchThreadOwner(threadRef);
  const { data } = useEnvironmentQuery(
    hostEnvironmentId === null
      ? null
      : workbenchEnvironment.snapshot({ environmentId: hostEnvironmentId, input: {} }),
  );
  const context =
    hostEnvironmentId === null
      ? null
      : getWorkbenchContextForThread(data ?? null, hostEnvironmentId, threadRef);
  if (!context || hostEnvironmentId === null) return null;
  const { ticket, workspace: project } = context;
  const references = data?.references.filter((reference) => reference.ticketId === ticket.id) ?? [];
  const descriptionLinks = workbenchDescriptionLinks(ticket.markdown);

  return (
    <>
      <WorkspaceBreadcrumbItem className="hidden shrink-0 @3xl/header-actions:flex">
        <Link
          aria-label={`Back to Board ${project.title}`}
          className="inline-flex h-7 min-w-0 max-w-48 whitespace-nowrap items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2 text-xs font-medium text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          search={{ environmentId: hostEnvironmentId, workbenchProjectId: project.id }}
          title={`${project.title} Board`}
          to="/workbench"
        >
          <BlocksIcon className="size-3.5 shrink-0 text-primary" />
          <span className="hidden shrink-0 @4xl/header-actions:inline">Agent Workbench</span>
          <span
            aria-hidden
            className="hidden shrink-0 text-muted-foreground/60 @5xl/header-actions:inline"
          >
            ·
          </span>
          <span className="hidden min-w-0 truncate text-muted-foreground @5xl/header-actions:inline">
            {project.title}
          </span>
          <span className="shrink-0 @4xl/header-actions:hidden">Workbench</span>
        </Link>
      </WorkspaceBreadcrumbItem>
      <WorkspaceBreadcrumbSeparator className="hidden @3xl/header-actions:flex" />
      <WorkspaceBreadcrumbItem className="min-w-8 max-w-64 shrink">
        <Link
          aria-label={`Back to Ticket ${ticket.title} in Board ${project.title}`}
          className="inline-flex h-7 min-w-0 max-w-full items-center overflow-hidden whitespace-nowrap gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          search={{
            environmentId: hostEnvironmentId,
            workbenchProjectId: project.id,
            ticketId: ticket.id,
          }}
          title={`${project.title} · ${WORKBENCH_TICKET_STATUS_LABELS[ticket.status]}`}
          to="/workbench"
        >
          <BlocksIcon className="size-3.5 shrink-0 text-primary @3xl/header-actions:hidden" />
          <TicketIcon className="hidden size-3.5 shrink-0 @3xl/header-actions:block" />
          <span className="truncate">{ticket.title}</span>
          <Badge
            size="default"
            variant="secondary"
            className="hidden @5xl/header-actions:inline-flex"
          >
            {WORKBENCH_TICKET_STATUS_LABELS[ticket.status]}
          </Badge>
        </Link>
      </WorkspaceBreadcrumbItem>
      {/* File References are paths on the Board host, which a Thread elsewhere cannot open. */}
      {hostEnvironmentId === environmentId ? (
        <WorkbenchThreadReferencesMenu
          environmentId={environmentId}
          threadId={threadId}
          references={references}
          descriptionLinks={descriptionLinks}
        />
      ) : null}
      <WorkspaceBreadcrumbSeparator />
    </>
  );
}
