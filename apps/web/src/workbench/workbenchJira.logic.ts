import type {
  WorkbenchJiraBoardConfiguration,
  WorkbenchJiraBoardColumn,
  WorkbenchJiraStatusMapping,
  WorkbenchJiraIssueSnapshot,
  WorkbenchTicket,
  WorkbenchTicketId,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";

import { WORKBENCH_TICKET_STATUSES, WORKBENCH_TICKET_STATUS_LABELS } from "./workbench.logic";

// Jira text and the version used to edit it must come from the same snapshot.
export const resolveWorkbenchTicketContent = ({
  ticket,
  jiraIssue,
}: {
  readonly ticket: Pick<WorkbenchTicket, "title" | "markdown">;
  readonly jiraIssue: Pick<WorkbenchJiraIssueSnapshot, "summary" | "description"> | undefined;
}) => ({
  title: jiraIssue?.summary ?? ticket.title,
  markdown: jiraIssue?.description ?? ticket.markdown,
});

export const getWorkbenchJiraBindingSprints = (binding: {
  readonly sprintId: number;
  readonly sprintName: string;
  readonly selectedSprints?: ReadonlyArray<{ readonly id: number; readonly name: string }>;
}) =>
  binding.selectedSprints?.length
    ? binding.selectedSprints
    : [{ id: binding.sprintId, name: binding.sprintName }];

export const resolveWorkbenchJiraRedirectUri = ({
  desktop,
  browserOrigin,
  serverHttpUrl,
}: {
  readonly desktop: boolean;
  readonly browserOrigin: string;
  readonly serverHttpUrl: string;
}) =>
  desktop
    ? new URL("/oauth/workbench/jira/callback", serverHttpUrl).toString()
    : new URL("/workbench", browserOrigin).toString();

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
  name,
  done,
}: {
  readonly columnIndex: number;
  readonly name: string;
  readonly done: boolean;
}): WorkbenchTicketStatus => {
  if (done) return "done";
  if (/^to[ _-]?do$/i.test(name.trim())) return "todo";
  if (columnIndex === 0) return "todo";
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
        name: column.name,
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
  patch,
  jiraFieldsManaged,
}: {
  readonly patch: Partial<WorkbenchTicketUpdateFields>;
  readonly jiraFieldsManaged: boolean;
}): Partial<WorkbenchTicketUpdateFields> {
  if (!jiraFieldsManaged) return patch;
  return {
    ...(patch.markdown !== undefined ? { markdown: patch.markdown } : {}),
    ...(patch.repositoryProjectIds !== undefined
      ? { repositoryProjectIds: patch.repositoryProjectIds }
      : {}),
    ...(patch.primaryT3ProjectId !== undefined
      ? { primaryT3ProjectId: patch.primaryT3ProjectId }
      : {}),
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
    done: orderLane("done"),
  };
}

export function getWorkbenchBoardColumns<Ticket extends Pick<WorkbenchTicket, "id" | "status">>({
  tickets,
  mirrorColumns,
  issueLinks,
}: {
  readonly tickets: ReadonlyArray<Ticket>;
  readonly mirrorColumns: ReadonlyArray<WorkbenchJiraBoardColumn> | null;
  readonly issueLinks: ReadonlyMap<
    WorkbenchTicketId,
    { readonly issue: { readonly status: { readonly id: string } } }
  >;
}): Array<{ id: string; title: string; status: WorkbenchTicketStatus; tickets: Array<Ticket> }> {
  const columns = mirrorColumns?.length
    ? mirrorColumns.map((column, index) => ({
        id: `jira-${index}`,
        title: column.name,
        status: suggestedWorkbenchStatus({
          columnIndex: index,
          name: column.name,
          done: column.done,
        }),
        tickets: [] as Array<Ticket>,
      }))
    : WORKBENCH_TICKET_STATUSES.map((status) => ({
        id: status,
        title: WORKBENCH_TICKET_STATUS_LABELS[status],
        status,
        tickets: [] as Array<Ticket>,
      }));
  for (const ticket of tickets) {
    const link = issueLinks.get(ticket.id);
    const jiraIndex =
      link && mirrorColumns?.length
        ? mirrorColumns.findIndex((column) => column.statusIds.includes(link.issue.status.id))
        : -1;
    let column = jiraIndex >= 0 ? columns[jiraIndex] : undefined;
    if (!column && ticket.status === "todo") {
      column = columns.find(
        (candidate) => candidate.status === "todo" && /^to[ _-]?do$/iu.test(candidate.title.trim()),
      );
    }
    if (!column) column = columns.find((candidate) => candidate.status === ticket.status);
    if (!column) {
      column = {
        id: ticket.status,
        title: WORKBENCH_TICKET_STATUS_LABELS[ticket.status],
        status: ticket.status,
        tickets: [],
      };
      columns.push(column);
    }
    column.tickets.push(ticket);
  }
  return columns;
}
