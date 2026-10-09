import {
  EnvironmentId,
  type WorkbenchAssignment,
  type WorkbenchTicket,
  type WorkbenchSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { Schema } from "effect";
import { useLocation, useParams, useSearch } from "@tanstack/react-router";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { resolveThreadRouteRef } from "../threadRoutes";
import { useThreadShells } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { WorkbenchAttentionQueries } from "./WorkbenchAttentionQueries";
import { useWorkbenchAttention } from "./useWorkbenchAttention";
import { useWorkbenchSidebar } from "./useWorkbenchSidebar";
import { workbenchEnvironment } from "./state";
import { activeWorkbenchAttentionAssignments } from "./workbenchAttention.logic";

type Attention = ReturnType<typeof useWorkbenchAttention>;
const emptyAttention: Attention = {
  attentionRefresh: 0,
  refreshAttention: () => {},
  attentionReferences: [],
  attentionScope: "",
  setAttentionObservations: () => {},
  attentionReasonsByTicket: new Map(),
  attentionSignalsByTicket: new Map(),
  attentionInspectionsByTicket: new Map(),
  attentionCoverage: "0 of 0 linked PRs inspected",
};
const AttentionContext = createContext<Attention>(emptyAttention);
export const useWorkbenchAttentionData = () => useContext(AttentionContext);
const isEnvironmentId = Schema.is(EnvironmentId);
const emptyAssignments: readonly WorkbenchAssignment[] = [];
const emptyTickets: readonly WorkbenchTicket[] = [];

/** One bounded collection feeds the board, Ticket page, and sidebar in the active environment. */
export function WorkbenchAttentionProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const search = useSearch({
    strict: false,
    select: (value) => ({
      environmentId: isEnvironmentId(value.environmentId) ? value.environmentId : undefined,
    }),
  });
  const activeThreadRef = useParams({ strict: false, select: resolveThreadRouteRef });
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { isOnWorkbench, context } = useWorkbenchSidebar(pathname);
  const environmentId =
    context?.environmentId ??
    activeThreadRef?.environmentId ??
    search.environmentId ??
    primaryEnvironmentId;
  const needsSnapshot = isOnWorkbench || activeThreadRef !== null;
  const query = useEnvironmentQuery(
    !needsSnapshot || environmentId === null
      ? null
      : workbenchEnvironment.snapshot({ environmentId, input: {} }),
  );
  return (
    <WorkbenchEnvironmentAttention
      environmentId={needsSnapshot ? environmentId : null}
      activeThreadRef={activeThreadRef}
      snapshot={needsSnapshot ? query.data : null}
      isOnWorkbench={isOnWorkbench}
    >
      {children}
    </WorkbenchEnvironmentAttention>
  );
}

function WorkbenchEnvironmentAttention({
  environmentId,
  snapshot,
  activeThreadRef,
  isOnWorkbench,
  children,
}: {
  environmentId: Parameters<typeof useWorkbenchAttention>[0]["environmentId"];
  snapshot: WorkbenchSnapshot | null;
  activeThreadRef: ScopedThreadRef | null;
  isOnWorkbench: boolean;
  children: ReactNode;
}) {
  const shells = useThreadShells();
  const threadsById = useMemo(
    () =>
      new Map(
        shells
          .filter((thread) => thread.environmentId === environmentId)
          .map((thread) => [thread.id, thread]),
      ),
    [shells, environmentId],
  );
  const visibleTickets = useMemo(() => {
    const activeWorkspaceIds = new Set(
      snapshot?.projects
        .filter((project) => project.archivedAt == null)
        .map((project) => project.id),
    );
    return (
      snapshot?.tickets.filter(
        (ticket) => ticket.archivedAt == null && activeWorkspaceIds.has(ticket.projectId),
      ) ?? []
    );
  }, [snapshot?.projects, snapshot?.tickets]);
  const assignedThreadRef = useMemo(() => {
    if (!activeThreadRef || activeThreadRef.environmentId !== environmentId) return null;
    const ticketIds = new Set(visibleTickets.map((ticket) => ticket.id));
    const assigned = activeWorkbenchAttentionAssignments({
      assignments: snapshot?.assignments ?? emptyAssignments,
      threadsById,
      environmentId,
    }).some(
      (assignment) =>
        assignment.threadId === activeThreadRef.threadId && ticketIds.has(assignment.ticketId),
    );
    return assigned ? activeThreadRef : null;
  }, [activeThreadRef, environmentId, snapshot?.assignments, threadsById, visibleTickets]);
  const attention = useWorkbenchAttention({
    environmentId,
    projectId: snapshot?.projects.find((project) => project.archivedAt == null)?.id ?? null,
    tickets: isOnWorkbench ? visibleTickets : emptyTickets,
    assignments: isOnWorkbench ? (snapshot?.assignments ?? emptyAssignments) : emptyAssignments,
    threadsById,
    activeThreadRef: assignedThreadRef,
  });
  return (
    <AttentionContext value={attention}>
      {isOnWorkbench && environmentId !== null ? (
        <WorkbenchAttentionQueries
          key={attention.attentionScope}
          environmentId={environmentId}
          references={attention.attentionReferences}
          refresh={attention.attentionRefresh > 0}
          onChange={attention.setAttentionObservations}
        />
      ) : null}
      {children}
    </AttentionContext>
  );
}
