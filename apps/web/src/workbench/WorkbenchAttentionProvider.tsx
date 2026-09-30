import {
  EnvironmentId,
  type WorkbenchAssignment,
  type WorkbenchSnapshot,
} from "@t3tools/contracts";
import { Schema } from "effect";
import { useLocation, useSearch } from "@tanstack/react-router";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useThreadShells } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { WorkbenchAttentionQueries } from "./WorkbenchAttentionQueries";
import { useWorkbenchAttention } from "./useWorkbenchAttention";
import { useWorkbenchSidebar } from "./useWorkbenchSidebar";
import { workbenchEnvironment } from "./state";

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

/** One bounded collection feeds the board, Ticket page, and sidebar in the active environment. */
export function WorkbenchAttentionProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const search = useSearch({
    strict: false,
    select: (value) => ({
      environmentId: isEnvironmentId(value.environmentId) ? value.environmentId : undefined,
    }),
  });
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { isOnWorkbench, context } = useWorkbenchSidebar(pathname);
  const environmentId = context?.environmentId ?? search.environmentId ?? primaryEnvironmentId;
  const query = useEnvironmentQuery(
    !isOnWorkbench || environmentId === null
      ? null
      : workbenchEnvironment.snapshot({ environmentId, input: {} }),
  );
  return (
    <WorkbenchEnvironmentAttention
      environmentId={isOnWorkbench ? environmentId : null}
      snapshot={isOnWorkbench ? query.data : null}
    >
      {children}
    </WorkbenchEnvironmentAttention>
  );
}

function WorkbenchEnvironmentAttention({
  environmentId,
  snapshot,
  children,
}: {
  environmentId: Parameters<typeof useWorkbenchAttention>[0]["environmentId"];
  snapshot: WorkbenchSnapshot | null;
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
  const tickets = useMemo(
    () => snapshot?.tickets.filter((ticket) => ticket.archivedAt == null) ?? [],
    [snapshot?.tickets],
  );
  const attention = useWorkbenchAttention({
    environmentId,
    projectId: snapshot?.projects[0]?.id ?? null,
    tickets,
    assignments: snapshot?.assignments ?? emptyAssignments,
    threadsById,
  });
  return (
    <AttentionContext value={attention}>
      {environmentId !== null ? (
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
