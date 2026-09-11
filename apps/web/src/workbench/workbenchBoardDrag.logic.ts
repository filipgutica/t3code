import type {
  WorkbenchEpicId,
  WorkbenchJiraBoardColumn,
  WorkbenchJiraGetTicketTransitionsResult,
  WorkbenchJiraStatusMapping,
  WorkbenchJiraTicketTransition,
  WorkbenchTicket,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";

export const canMoveWorkbenchBoardTicket = ({
  ticket,
  sourceColumnId,
  target,
  jiraManaged,
  groupByEpic,
  pending,
}: {
  ticket: Pick<WorkbenchTicket, "status" | "epicId" | "archivedAt">;
  sourceColumnId: string | undefined;
  target: { columnId: string; status: WorkbenchTicketStatus; epicId: WorkbenchEpicId | null };
  jiraManaged: boolean;
  groupByEpic: boolean;
  pending: boolean;
}): boolean =>
  !pending &&
  ticket.archivedAt == null &&
  sourceColumnId !== undefined &&
  sourceColumnId !== target.columnId &&
  (jiraManaged || ticket.status !== target.status) &&
  (!groupByEpic || ticket.epicId === target.epicId);

export const getWorkbenchBoardDropJiraStatusIds = ({
  columnId,
  status,
  mirrorColumns,
  statusMappings,
}: {
  columnId: string;
  status: WorkbenchTicketStatus;
  mirrorColumns: ReadonlyArray<WorkbenchJiraBoardColumn> | null;
  statusMappings: ReadonlyArray<WorkbenchJiraStatusMapping>;
}): ReadonlyArray<string> =>
  mirrorColumns?.find((_, index) => columnId === `jira-${index}`)?.statusIds ??
  statusMappings
    .filter((mapping) => mapping.workbenchStatus === status)
    .map((mapping) => mapping.jiraStatusId);

export const getWorkbenchJiraDropAction = ({
  result,
  jiraStatusIds,
}: {
  result: WorkbenchJiraGetTicketTransitionsResult;
  jiraStatusIds: ReadonlyArray<string>;
}):
  | { kind: "unavailable"; reason: string }
  | { kind: "transition"; transition: WorkbenchJiraTicketTransition }
  | { kind: "choose"; transitions: ReadonlyArray<WorkbenchJiraTicketTransition> } => {
  if (result.remoteUpdatedAt === null) {
    return { kind: "unavailable", reason: "Refresh Jira before changing this ticket's status." };
  }
  const matching = result.transitions.filter((transition) =>
    jiraStatusIds.includes(transition.to.id),
  );
  const available = matching.filter((transition) => transition.unavailableReason === null);
  if (available.length === 0) {
    return {
      kind: "unavailable",
      reason:
        matching[0]?.unavailableReason ??
        "This ticket has no available Jira transition to this column.",
    };
  }
  if (available.length === 1 && available[0]) {
    return { kind: "transition", transition: available[0] };
  }
  return { kind: "choose", transitions: available };
};
