import {
  workbenchProgressCounts,
  type EnvironmentId,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";
import { WorkbenchProvenanceBadge } from "./WorkbenchReferences";
import { WorkbenchProgressCount } from "./WorkbenchProgressCount";
import { WorkbenchProgressChecklist } from "./WorkbenchProgress";
import { WorkbenchQueryError } from "./WorkbenchQueryError";
import { WorkbenchTicketPanelHeader } from "./WorkbenchTicketPanelHeader";

export function WorkbenchTicketProgress({
  ticket,
  updatedBy,
}: {
  ticket: WorkbenchTicket;
  updatedBy: string | null;
}) {
  const progress = ticket.progress ?? "";
  const { done, total } = workbenchProgressCounts(progress);
  return (
    <section
      aria-label="Ticket Progress"
      className="min-w-0 shrink-0 rounded-xl border border-border/60 bg-card/30 px-4 py-3"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Progress</h2>
        <WorkbenchProgressCount done={done} total={total} />
        {updatedBy ? <WorkbenchProvenanceBadge text={`Updated by ${updatedBy}`} /> : null}
      </div>
      {total > 0 ? (
        <div className="space-y-3">
          <div
            role="progressbar"
            aria-label="Completed Progress items"
            aria-valuenow={done}
            aria-valuemin={0}
            aria-valuemax={total}
            className="h-1 overflow-hidden rounded-full bg-border"
          >
            <div className="h-full bg-success" style={{ width: `${(done / total) * 100}%` }} />
          </div>
          <WorkbenchProgressChecklist progress={progress} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No progress yet. Ask the agent to plan the work.
        </p>
      )}
    </section>
  );
}

export function WorkbenchTicketSharedContext({
  environmentId,
  ticket,
}: {
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
        {expanded ? <SharedContextContent environmentId={environmentId} ticket={ticket} /> : null}
      </div>
    </section>
  );
}

function SharedContextContent({
  environmentId,
  ticket,
}: {
  environmentId: EnvironmentId;
  ticket: WorkbenchTicket;
}) {
  const query = useEnvironmentQuery(
    workbenchEnvironment.ticketContext({
      environmentId,
      input: { ticketId: ticket.id, revision: ticket.revision },
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
    <pre
      tabIndex={0}
      aria-label="Shared context text"
      className="max-h-96 overflow-auto border-t border-border/50 px-4 py-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]"
    >
      {query.data.text}
    </pre>
  );
}
