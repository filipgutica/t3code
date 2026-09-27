import type {
  EnvironmentId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicket,
  WorkbenchTicketId,
  WorkbenchAssignment,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useCallback, useMemo, useState } from "react";
import { resolveThreadStatusPill } from "../components/Sidebar.logic";
import { getWorkbenchAgentPresentation } from "./workbench.logic";
import { getWorkbenchTicketPullRequests } from "./workbenchPullRequests.logic";
import {
  activeWorkbenchAttentionAssignments,
  getWorkbenchPullRequestAttention,
  workbenchAttentionIdentity,
  workbenchThreadAttentionReasons,
  type WorkbenchAttentionMode,
  type WorkbenchPullRequestAttention,
} from "./workbenchAttention.logic";

export function useWorkbenchAttention({
  environmentId,
  projectId,
  attentionMode,
  tickets,
  assignments,
  threadsById,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: WorkbenchProjectId;
  readonly attentionMode: WorkbenchAttentionMode;
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
}) {
  const [attentionRefresh, setAttentionRefresh] = useState(0);
  const refreshAttention = () => setAttentionRefresh((previous) => previous + 1);
  const activeAssignments = useMemo(
    () => activeWorkbenchAttentionAssignments({ assignments, threadsById, environmentId }),
    [assignments, threadsById, environmentId],
  );
  const assignmentsByTicket = useMemo(() => {
    const groups = new Map<WorkbenchTicketId, WorkbenchAssignment[]>();
    for (const assignment of activeAssignments) {
      const group = groups.get(assignment.ticketId) ?? [];
      group.push(assignment);
      groups.set(assignment.ticketId, group);
    }
    return groups;
  }, [activeAssignments]);
  const attentionReferencesByTicket = useMemo(
    () =>
      new Map(
        tickets.map((ticket) => [
          ticket.id,
          getWorkbenchTicketPullRequests({
            assignments: assignmentsByTicket.get(ticket.id) ?? [],
            threadsById,
            archivedThreadsById: new Map(),
            includeBranchPullRequest: false,
          }).map((row) => row.pullRequest),
        ]),
      ),
    [tickets, assignmentsByTicket, threadsById],
  );
  const attentionReferences = useMemo(
    () => [
      ...new Map(
        [...attentionReferencesByTicket.values()]
          .flat()
          .filter((reference) => reference.state !== "closed" && reference.state !== "merged")
          .map((reference) => [workbenchAttentionIdentity(environmentId, reference), reference]),
      ).values(),
    ],
    [attentionReferencesByTicket, environmentId],
  );
  const attentionScope = JSON.stringify([
    environmentId,
    projectId,
    attentionMode,
    attentionRefresh,
    attentionReferences.map((reference) => [
      workbenchAttentionIdentity(environmentId, reference),
      reference.state,
      reference.checksState,
      reference.reviewDecision,
    ]),
  ]);
  const [attentionResult, setAttentionResult] = useState<{
    scope: string;
    observations: ReadonlyMap<string, WorkbenchPullRequestAttention>;
  }>({ scope: attentionScope, observations: new Map() });
  const setAttentionObservations = useCallback(
    (observations: ReadonlyMap<string, WorkbenchPullRequestAttention>) =>
      setAttentionResult({ scope: attentionScope, observations }),
    [attentionScope],
  );
  const observations =
    attentionResult.scope === attentionScope
      ? attentionResult.observations
      : new Map<string, WorkbenchPullRequestAttention>();
  const attentionReasonsByTicket = useMemo(
    () =>
      new Map(
        tickets.map((ticket) => {
          const presentations = (assignmentsByTicket.get(ticket.id) ?? []).flatMap((assignment) => {
            const thread = threadsById.get(assignment.threadId);
            return thread
              ? [
                  getWorkbenchAgentPresentation({
                    nativeLabel: resolveThreadStatusPill({ thread })?.label,
                    sessionStatus: thread.session?.status,
                    turnState: thread.latestTurn?.state,
                    settledOverride: thread.settledOverride,
                    ticketStatus: ticket.status,
                  }),
                ]
              : [];
          });
          const reasons = new Set(workbenchThreadAttentionReasons(presentations));
          for (const reference of attentionReferencesByTicket.get(ticket.id) ?? []) {
            const observation =
              observations.get(workbenchAttentionIdentity(environmentId, reference)) ??
              getWorkbenchPullRequestAttention({
                reference,
                summary: null,
                activity: null,
                loading: true,
                error: false,
              });
            observation.reasons.forEach((reason) => reasons.add(reason));
          }
          return [ticket.id, [...reasons]];
        }),
      ),
    [
      tickets,
      assignmentsByTicket,
      threadsById,
      attentionReferencesByTicket,
      observations,
      environmentId,
    ],
  );
  const attentionCoverage = `${attentionReferences.filter((reference) => observations.get(workbenchAttentionIdentity(environmentId, reference))?.inspected).length} of ${attentionReferences.length} linked PRs inspected`;
  return {
    attentionRefresh,
    refreshAttention,
    attentionReferences,
    attentionScope,
    setAttentionObservations,
    attentionReasonsByTicket,
    attentionCoverage,
  };
}
