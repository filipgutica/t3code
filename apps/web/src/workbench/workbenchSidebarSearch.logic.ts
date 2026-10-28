import type { WorkbenchProject, WorkbenchProjectId, WorkbenchTicketId } from "@t3tools/contracts";

import {
  getTicketIssue,
  getTicketReferences,
  getWorkbenchReferenceSearchTerms,
  type WorkbenchReferencesByTicket,
} from "./workbenchReferences.logic";

import type {
  WorkbenchSidebarThread,
  WorkbenchSidebarTicket,
  WorkbenchSidebarTicketGroup,
  WorkbenchSidebarTicketSections,
} from "./workbenchSidebar.logic";

type WorkbenchSidebarSearchResultBase = {
  readonly key: string;
  readonly title: string;
  readonly subtitle: string;
  readonly workspaceId: WorkbenchProjectId;
  readonly workspaceTitle: string;
};

export type WorkbenchSidebarSearchResult = WorkbenchSidebarSearchResultBase &
  (
    | { readonly kind: "workspace" }
    | { readonly kind: "ticket"; readonly ticketId: WorkbenchTicketId }
    | { readonly kind: "draft"; readonly ticketId: WorkbenchTicketId }
    | {
        readonly kind: "thread";
        readonly ticketId: WorkbenchTicketId;
        readonly thread: WorkbenchSidebarThread;
      }
  );

type SearchContext = {
  readonly workspaceId: WorkbenchProjectId;
  readonly workspaceTitle: string;
  readonly matches: (value: string | undefined) => boolean;
  readonly referencesByTicket: WorkbenchReferencesByTicket;
};

const matchesTicket = ({
  ticketId,
  title,
  context,
}: {
  readonly ticketId: WorkbenchTicketId;
  readonly title: string;
  readonly context: SearchContext;
}) =>
  context.matches(title) ||
  getWorkbenchReferenceSearchTerms(getTicketReferences(context.referencesByTicket, ticketId)).some(
    context.matches,
  );

const issueLabelOf = (context: SearchContext, ticketId: WorkbenchTicketId) =>
  getTicketIssue(getTicketReferences(context.referencesByTicket, ticketId))?.label;

function getMatchingTicket({
  ticket,
  context,
}: {
  readonly ticket: WorkbenchSidebarTicket;
  readonly context: SearchContext;
}): ReadonlyArray<WorkbenchSidebarSearchResult> {
  if (!matchesTicket({ ticketId: ticket.id, title: ticket.title, context })) return [];
  return [
    {
      kind: "ticket",
      key: `ticket:${context.workspaceId}:${ticket.id}`,
      title: ticket.title,
      workspaceId: context.workspaceId,
      workspaceTitle: context.workspaceTitle,
      ticketId: ticket.id,
      subtitle: [
        context.workspaceTitle,
        issueLabelOf(context, ticket.id),
        ticket.archivedAt ? "Archived" : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
    },
  ];
}

function getMatchingTicketGroup({
  group,
  context,
}: {
  readonly group: WorkbenchSidebarTicketGroup;
  readonly context: SearchContext;
}): ReadonlyArray<WorkbenchSidebarSearchResult> {
  const threads: Array<WorkbenchSidebarSearchResult> = group.threads
    .filter((thread) => context.matches(thread.title))
    .map((thread) => ({
      kind: "thread",
      key: `thread:${context.workspaceId}:${thread.environmentId}:${thread.id}`,
      title: thread.title,
      workspaceId: context.workspaceId,
      workspaceTitle: context.workspaceTitle,
      subtitle: [
        context.workspaceTitle,
        issueLabelOf(context, group.ticket.id),
        group.ticket.title,
        thread.archivedAt ? "Archived Thread" : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      ticketId: group.ticket.id,
      thread,
    }));
  return [...getMatchingTicket({ ticket: group.ticket, context }), ...threads];
}

function getMatchingDrafts({
  drafts,
  context,
}: {
  readonly drafts: ReadonlyArray<{ readonly id: WorkbenchTicketId; readonly title: string }>;
  readonly context: SearchContext;
}): ReadonlyArray<WorkbenchSidebarSearchResult> {
  return drafts
    .filter((draft) => matchesTicket({ ticketId: draft.id, title: draft.title, context }))
    .map((draft) => ({
      kind: "draft",
      key: `draft:${context.workspaceId}:${draft.id}`,
      title: draft.title,
      workspaceId: context.workspaceId,
      workspaceTitle: context.workspaceTitle,
      subtitle: context.workspaceTitle,
      ticketId: draft.id,
    }));
}

/** Search returns destinations directly, without requiring sidebar disclosures. */
export function getWorkbenchSidebarSearchResults({
  query,
  projects,
  ticketGroupsByWorkspace,
  archivedTicketsByWorkspace,
  referencesByTicket,
  draftsByWorkspace,
}: {
  readonly query: string;
  readonly projects: ReadonlyArray<Pick<WorkbenchProject, "id" | "title" | "archivedAt">>;
  readonly ticketGroupsByWorkspace: ReadonlyMap<WorkbenchProjectId, WorkbenchSidebarTicketSections>;
  readonly archivedTicketsByWorkspace: ReadonlyMap<
    WorkbenchProjectId,
    ReadonlyArray<WorkbenchSidebarTicket>
  >;
  readonly referencesByTicket: WorkbenchReferencesByTicket;
  readonly draftsByWorkspace: ReadonlyMap<
    WorkbenchProjectId,
    ReadonlyArray<{ readonly id: WorkbenchTicketId; readonly title: string }>
  >;
}): ReadonlyArray<WorkbenchSidebarSearchResult> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const matches = (value: string | undefined) => value?.toLowerCase().includes(needle) ?? false;
  const results: Array<WorkbenchSidebarSearchResult> = [];

  for (const workspace of projects) {
    const context = {
      workspaceId: workspace.id,
      workspaceTitle: workspace.title,
      matches,
      referencesByTicket,
    };
    if (matches(workspace.title)) {
      results.push({
        workspaceId: workspace.id,
        workspaceTitle: workspace.title,
        kind: "workspace",
        key: `workspace:${workspace.id}`,
        title: workspace.title,
        subtitle: workspace.archivedAt ? "Archived Workspace" : "Workspace overview",
      });
    }

    const sections = ticketGroupsByWorkspace.get(workspace.id);
    results.push(
      ...[...(sections?.active ?? []), ...(sections?.done ?? [])].flatMap((group) =>
        getMatchingTicketGroup({ group, context }),
      ),
      ...(archivedTicketsByWorkspace.get(workspace.id) ?? []).flatMap((ticket) =>
        getMatchingTicket({ ticket, context }),
      ),
      ...getMatchingDrafts({ drafts: draftsByWorkspace.get(workspace.id) ?? [], context }),
    );
  }

  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.key)) return false;
    seen.add(result.key);
    return true;
  });
}
