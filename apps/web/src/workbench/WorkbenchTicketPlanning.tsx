import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  workbenchProgressCounts,
  type EnvironmentId,
  type ThreadId,
  type WorkbenchAssignment,
  type WorkbenchReference,
  type WorkbenchTicket,
  type WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import { useId, useState } from "react";

import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";
import { WorkbenchDescription } from "./WorkbenchDescription";
import { WorkbenchProvenanceBadge } from "./WorkbenchReferences";
import { WorkbenchProgressCount } from "./WorkbenchProgressCount";
import { WorkbenchProgressChecklist } from "./WorkbenchProgress";
import { WorkbenchQueryError } from "./WorkbenchQueryError";
import { useWorkbenchThreadRecaps } from "./useWorkbenchThreadRecaps";
import {
  WorkbenchTicketPanelHeader,
  useWorkbenchTicketPanelCollapsed,
} from "./WorkbenchTicketPanelHeader";

export function WorkbenchTicketProgress({
  ticket,
  updatedBy,
}: {
  ticket: WorkbenchTicket;
  updatedBy: string | null;
}) {
  const [collapsed, setCollapsed] = useWorkbenchTicketPanelCollapsed("progress");
  const contentId = useId();
  const progress = ticket.progress ?? "";
  const { done, total } = workbenchProgressCounts(progress);
  return (
    <section
      aria-label="Ticket Progress"
      className="min-w-0 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card/30"
    >
      <WorkbenchTicketPanelHeader
        title="Progress"
        heading={
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold leading-6">Progress</h2>
            <WorkbenchProgressCount done={done} total={total} />
            {updatedBy ? <WorkbenchProvenanceBadge text={`Updated by ${updatedBy}`} /> : null}
          </div>
        }
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
        contentId={contentId}
      />
      {total > 0 ? (
        <div
          role="progressbar"
          aria-label="Completed Progress items"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total}
          className="mx-4 mb-3 h-1 overflow-hidden rounded-full bg-border"
        >
          <div className="h-full bg-success" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      ) : null}
      <div id={contentId} hidden={collapsed} className="px-4 pb-3">
        {total > 0 ? (
          <WorkbenchProgressChecklist progress={progress} />
        ) : (
          <p className="text-sm text-muted-foreground">
            No progress yet. Ask the agent to plan the work.
          </p>
        )}
      </div>
    </section>
  );
}

type SharedContextSources = {
  references: ReadonlyArray<WorkbenchReference>;
  assignments: ReadonlyArray<WorkbenchAssignment>;
  threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  ticketWorkspace: WorkbenchTicketWorkspace | undefined;
};

/** Everything in the text that keeps the Ticket's revision: References, Threads, recaps, work area. */
const sharedContextInputs = (
  { references, assignments, threadsById, ticketWorkspace }: SharedContextSources,
  recaps: ReadonlyMap<ThreadId, string>,
) =>
  JSON.stringify([
    references.map((reference) => [reference.url, reference.title]),
    assignments.map(({ threadId }) => {
      const thread = threadsById.get(threadId);
      return [
        threadId,
        thread?.title,
        thread?.updatedAt,
        thread?.providerInstanceId,
        thread?.modelSelection.model,
        thread?.settledOverride,
        thread?.archivedAt,
        thread?.hasPendingApprovals,
        thread?.hasPendingUserInput,
        recaps.get(threadId) ?? null,
      ];
    }),
    ticketWorkspace ?? null,
  ]);

export function WorkbenchTicketSharedContext({
  environmentId,
  ticket,
  ...sources
}: SharedContextSources & {
  environmentId: EnvironmentId;
  ticket: WorkbenchTicket;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="min-w-0 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card/30">
      <WorkbenchTicketPanelHeader
        title="Shared context"
        description="What every Thread receives"
        collapsed={!expanded}
        onToggle={() => setExpanded((value) => !value)}
        contentId="workbench-ticket-shared-context"
      />
      <div id="workbench-ticket-shared-context" hidden={!expanded}>
        {expanded ? (
          <SharedContextContent environmentId={environmentId} ticket={ticket} sources={sources} />
        ) : null}
      </div>
    </section>
  );
}

function SharedContextContent({
  environmentId,
  ticket,
  sources,
}: {
  environmentId: EnvironmentId;
  ticket: WorkbenchTicket;
  sources: SharedContextSources;
}) {
  const recaps = useWorkbenchThreadRecaps(environmentId);
  const query = useEnvironmentQuery(
    workbenchEnvironment.ticketContext({
      environmentId,
      input: {
        ticketId: ticket.id,
        revision: ticket.revision,
        inputs: sharedContextInputs(sources, recaps),
      },
    }),
  );
  if (query.error) return <WorkbenchQueryError query={query} />;
  if (!query.isSuccess)
    return (
      <p role="status" className="px-4 pb-4 text-sm text-muted-foreground">
        Loading shared context…
      </p>
    );
  if (query.data === null)
    return (
      <p role="status" className="px-4 pb-4 text-sm text-muted-foreground">
        This Ticket no longer exists.
      </p>
    );
  return (
    <div className="border-t border-border/50">
      <p className="px-4 pt-3 text-xs tabular-nums text-muted-foreground">
        {query.data.text.length.toLocaleString()} characters
      </p>
      <div
        tabIndex={0}
        aria-label="Shared context text"
        className="max-h-96 overflow-auto px-4 py-3"
      >
        <WorkbenchDescription markdown={query.data.text} />
      </div>
    </div>
  );
}
