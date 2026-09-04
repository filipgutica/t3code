import type {
  WorkbenchJiraBoardConfiguration,
  WorkbenchJiraStatusMapping,
  WorkbenchTicket,
  WorkbenchTicketId,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";

type WorkbenchTicketUpdateFields = Pick<
  WorkbenchTicket,
  | "title"
  | "markdown"
  | "kind"
  | "epicId"
  | "repositoryProjectIds"
  | "primaryT3ProjectId"
  | "status"
  | "blocked"
>;

const suggestedWorkbenchStatus = ({
  columnIndex,
  columnCount,
  done,
}: {
  readonly columnIndex: number;
  readonly columnCount: number;
  readonly done: boolean;
}): WorkbenchTicketStatus => {
  if (done) return "done";
  if (columnIndex === 0) return "todo";
  if (columnCount >= 4 && columnIndex === columnCount - 2) return "ready_for_review";
  return "in_progress";
};

export function suggestWorkbenchJiraStatusMappings(
  configuration: WorkbenchJiraBoardConfiguration,
): ReadonlyArray<WorkbenchJiraStatusMapping> {
  return configuration.columns.flatMap((column, columnIndex) =>
    column.statusIds.map((jiraStatusId) => ({
      jiraStatusId,
      workbenchStatus: suggestedWorkbenchStatus({
        columnIndex,
        columnCount: configuration.columns.length,
        done: column.done,
      }),
    })),
  );
}

export function reconcileWorkbenchJiraStatusMappings({
  configuration,
  existingMappings,
}: {
  readonly configuration: WorkbenchJiraBoardConfiguration;
  readonly existingMappings: ReadonlyArray<WorkbenchJiraStatusMapping>;
}): ReadonlyArray<WorkbenchJiraStatusMapping> {
  const existingByStatusId = new Map(
    existingMappings.map((mapping) => [mapping.jiraStatusId, mapping.workbenchStatus]),
  );
  return suggestWorkbenchJiraStatusMappings(configuration).map((suggested) => ({
    jiraStatusId: suggested.jiraStatusId,
    workbenchStatus: existingByStatusId.get(suggested.jiraStatusId) ?? suggested.workbenchStatus,
  }));
}

export const resolveWorkbenchJiraOAuthCallback = ({
  code,
  state,
  error,
}: {
  readonly code?: string | undefined;
  readonly state?: string | undefined;
  readonly error?: string | undefined;
}): { code: string; state: string } | { error: string } | null => {
  if (!code && !state && !error) return null;
  if (error) {
    return {
      error:
        error === "access_denied"
          ? "Jira authorization was cancelled or denied. Connect again when you are ready to grant access."
          : "Atlassian could not authorize Jira. Try connecting again.",
    };
  }
  if (!code || !state) {
    return { error: "Jira returned an incomplete authorization response. Try connecting again." };
  }
  return { code, state };
};

export function resolveWorkbenchTicketUpdateFields({
  ticket,
  patch,
  jiraFieldsManaged,
}: {
  readonly ticket: WorkbenchTicket;
  readonly patch: Partial<WorkbenchTicketUpdateFields>;
  readonly jiraFieldsManaged: boolean;
}): WorkbenchTicketUpdateFields {
  return {
    title: jiraFieldsManaged ? ticket.title : (patch.title ?? ticket.title),
    markdown: patch.markdown ?? ticket.markdown,
    kind: jiraFieldsManaged ? ticket.kind : (patch.kind ?? ticket.kind),
    epicId: jiraFieldsManaged
      ? ticket.epicId
      : patch.epicId === undefined
        ? ticket.epicId
        : patch.epicId,
    repositoryProjectIds:
      patch.repositoryProjectIds ??
      (ticket.repositoryProjectIds.length > 0
        ? ticket.repositoryProjectIds
        : [ticket.primaryT3ProjectId]),
    primaryT3ProjectId: patch.primaryT3ProjectId ?? ticket.primaryT3ProjectId,
    status: jiraFieldsManaged ? ticket.status : (patch.status ?? ticket.status),
    blocked: jiraFieldsManaged ? ticket.blocked : (patch.blocked ?? ticket.blocked),
  };
}

export function orderWorkbenchTicketsByJiraRank<Ticket extends { readonly id: WorkbenchTicketId }>(
  tickets: ReadonlyArray<Ticket>,
  jiraIssueLinksByTicketId: ReadonlyMap<
    WorkbenchTicketId,
    { readonly issue: { readonly rank: number } }
  >,
  activeJiraTicketIds: ReadonlySet<WorkbenchTicketId>,
): ReadonlyArray<Ticket> {
  const rankedJiraTickets = tickets
    .filter((ticket) => activeJiraTicketIds.has(ticket.id))
    .toSorted(
      (left, right) =>
        (jiraIssueLinksByTicketId.get(left.id)?.issue.rank ?? 0) -
        (jiraIssueLinksByTicketId.get(right.id)?.issue.rank ?? 0),
    );
  let rankedIndex = 0;

  return tickets.map((ticket) => {
    if (!activeJiraTicketIds.has(ticket.id)) return ticket;
    const rankedTicket = rankedJiraTickets[rankedIndex];
    rankedIndex += 1;
    return rankedTicket ?? ticket;
  });
}

export function orderWorkbenchTicketLanesByJiraRank<
  Ticket extends { readonly id: WorkbenchTicketId },
>(
  ticketsByLane: Readonly<Record<WorkbenchTicketStatus, ReadonlyArray<Ticket>>>,
  jiraIssueLinksByTicketId: ReadonlyMap<
    WorkbenchTicketId,
    { readonly issue: { readonly rank: number } }
  >,
  activeJiraTicketIds: ReadonlySet<WorkbenchTicketId>,
): Readonly<Record<WorkbenchTicketStatus, ReadonlyArray<Ticket>>> {
  const orderLane = (status: WorkbenchTicketStatus) =>
    orderWorkbenchTicketsByJiraRank(
      ticketsByLane[status],
      jiraIssueLinksByTicketId,
      activeJiraTicketIds,
    );

  return {
    todo: orderLane("todo"),
    in_progress: orderLane("in_progress"),
    ready_for_review: orderLane("ready_for_review"),
    done: orderLane("done"),
  };
}
