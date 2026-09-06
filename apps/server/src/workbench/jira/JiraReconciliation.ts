import {
  type IsoDateTime,
  type WorkbenchJiraBindingId,
  type WorkbenchJiraIssueLink,
  type WorkbenchJiraIssueSnapshot,
  type WorkbenchJiraSyncResult,
} from "@t3tools/contracts";

export interface JiraIssueImport {
  readonly ticketId: WorkbenchJiraIssueLink["ticketId"];
  readonly issue: WorkbenchJiraIssueSnapshot;
}

/**
 * Reconciles only Jira-owned link state. Repository scope, Assignments, and
 * Thread history are intentionally absent and cannot be overwritten by synchronization.
 */
export function reconcileJiraIssueLinks(input: {
  readonly bindingId: WorkbenchJiraBindingId;
  readonly existing: ReadonlyArray<WorkbenchJiraIssueLink>;
  readonly incoming: ReadonlyArray<JiraIssueImport>;
  readonly syncedAt: IsoDateTime;
}): WorkbenchJiraSyncResult {
  const existingByIssueId = new Map(input.existing.map((link) => [link.issue.issueId, link]));
  const seenIssueIds = new Set<string>();
  let activated = 0;
  let updated = 0;

  const activeLinks = input.incoming.map(({ ticketId, issue }) => {
    seenIssueIds.add(issue.issueId);
    const previous = existingByIssueId.get(issue.issueId);
    if (previous === undefined || !previous.active) activated += 1;
    else updated += 1;

    return {
      bindingId: input.bindingId,
      // Once linked, the local Ticket identity is durable even if an importer
      // proposes a different generated ID during a later refresh.
      ticketId: previous?.ticketId ?? ticketId,
      issue,
      active: true,
      linkedAt: previous?.linkedAt ?? input.syncedAt,
      lastSeenAt: input.syncedAt,
    } satisfies WorkbenchJiraIssueLink;
  });

  let deactivated = 0;
  const inactiveLinks = input.existing.flatMap((link) => {
    if (seenIssueIds.has(link.issue.issueId)) return [];
    if (link.active) deactivated += 1;
    return [{ ...link, active: false }];
  });

  return {
    bindingId: input.bindingId,
    syncedAt: input.syncedAt,
    activated,
    updated,
    deactivated,
    links: [...activeLinks, ...inactiveLinks],
  };
}
