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
  mergeWorkbenchPullRequestAttention,
  workbenchAttentionIdentity,
  workbenchThreadAttentionReasons,
  type WorkbenchAttentionSignal,
  type WorkbenchAttentionInspection,
  type WorkbenchPullRequestAttention,
} from "./workbenchAttention.logic";

const pendingObservation = (
  observation: WorkbenchPullRequestAttention,
): WorkbenchPullRequestAttention => ({
  ...observation,
  reasons: [
    ...observation.reasons.filter((reason) => !reason.startsWith("PR attention ")),
    "PR attention loading",
  ],
  inspectionStatus: "loading",
  inspected: false,
  terminal: false,
  activityComplete: false,
  checksKnown: false,
  reviewDecisionKnown: false,
  resolvedReviewThreadIds: [],
});

export function useWorkbenchAttention({
  environmentId,
  projectId,
  tickets,
  assignments,
  threadsById,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: WorkbenchProjectId | null;
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
          }),
        ]),
      ),
    [tickets, assignmentsByTicket, threadsById],
  );
  const attentionReferences = useMemo(
    () =>
      environmentId === null
        ? []
        : [
            ...new Map(
              [...attentionReferencesByTicket.values()]
                .flat()
                .map((row) => row.pullRequest)
                .filter((reference) => reference.state !== "closed" && reference.state !== "merged")
                .map((reference) => [
                  workbenchAttentionIdentity(environmentId, reference),
                  reference,
                ]),
            ).values(),
          ],
    [attentionReferencesByTicket, environmentId],
  );
  const attentionEntityScope = JSON.stringify([environmentId, projectId]);
  const referenceScopes = useMemo(
    () =>
      environmentId === null
        ? new Map<string, string>()
        : new Map(
            attentionReferences.map((reference) => [
              workbenchAttentionIdentity(environmentId, reference),
              JSON.stringify([reference.state, reference.checksState, reference.reviewDecision]),
            ]),
          ),
    [environmentId, attentionReferences],
  );
  const attentionScope = JSON.stringify([
    attentionEntityScope,
    [...referenceScopes],
    attentionRefresh,
  ]);
  const [attentionResult, setAttentionResult] = useState<{
    scope: string;
    entityScope: string;
    observations: ReadonlyMap<string, WorkbenchPullRequestAttention>;
  }>({
    scope: attentionScope,
    entityScope: attentionEntityScope,
    observations: new Map(),
  });
  const setAttentionObservations = useCallback(
    (observations: ReadonlyMap<string, WorkbenchPullRequestAttention>) =>
      setAttentionResult((previous) => {
        const merged = new Map(
          previous.entityScope === attentionEntityScope
            ? [...previous.observations]
                .filter(([key]) => referenceScopes.has(key))
                .map(
                  ([key, observation]) =>
                    [
                      key,
                      previous.scope === attentionScope
                        ? observation
                        : pendingObservation(observation),
                    ] as const,
                )
            : [],
        );
        for (const [key, observation] of observations) {
          if (!referenceScopes.has(key)) continue;
          merged.set(
            key,
            mergeWorkbenchPullRequestAttention({ previous: merged.get(key), next: observation }),
          );
        }
        return {
          scope: attentionScope,
          entityScope: attentionEntityScope,
          observations: merged,
        };
      }),
    [attentionScope, attentionEntityScope, referenceScopes],
  );
  const observations = useMemo(
    () =>
      attentionResult.entityScope !== attentionEntityScope
        ? new Map<string, WorkbenchPullRequestAttention>()
        : attentionResult.scope === attentionScope
          ? attentionResult.observations
          : new Map(
              [...attentionResult.observations]
                .filter(([key]) => referenceScopes.has(key))
                .map(([key, observation]) => [key, pendingObservation(observation)]),
            ),
    [attentionResult, attentionEntityScope, attentionScope, referenceScopes],
  );
  const attentionByTicket = useMemo(
    () =>
      new Map(
        tickets.map((ticket) => {
          const signals: WorkbenchAttentionSignal[] = [];
          const inspections: WorkbenchAttentionInspection[] = [];
          const threadIds = new Set<ThreadId>();
          const presentations = (assignmentsByTicket.get(ticket.id) ?? []).flatMap((assignment) => {
            const thread = threadsById.get(assignment.threadId);
            if (!thread || threadIds.has(thread.id)) return [];
            threadIds.add(thread.id);
            const presentation = getWorkbenchAgentPresentation({
              nativeLabel: resolveThreadStatusPill({ thread })?.label,
              sessionStatus: thread.session?.status,
              turnState: thread.latestTurn?.state,
              settledOverride: thread.settledOverride,
              ticketStatus: ticket.status,
            });
            if (
              presentation?.label === "Waiting for input" ||
              presentation?.label === "Ready for review"
            ) {
              signals.push({
                kind: presentation.label === "Waiting for input" ? "waiting" : "review-ready",
                source: { type: "thread", threadId: thread.id, threadTitle: thread.title },
              });
            }
            return [presentation];
          });
          const reasons = new Set(workbenchThreadAttentionReasons(presentations));
          for (const row of attentionReferencesByTicket.get(ticket.id) ?? []) {
            if (environmentId === null) continue;
            const reference = row.pullRequest;
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
            for (const kind of observation.signalKinds) {
              signals.push({
                kind,
                source: { type: "pull-request", row },
                unresolvedReviewThreads: observation.unresolvedReviewThreads,
              });
            }
            if (reference.state !== "closed" && reference.state !== "merged") {
              inspections.push({
                row,
                status: observation.inspectionStatus,
                inspected: observation.inspected,
              });
            }
          }
          return [ticket.id, { reasons: [...reasons], signals, inspections }];
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
  const attentionReasonsByTicket = useMemo(
    () => new Map([...attentionByTicket].map(([id, result]) => [id, result.reasons])),
    [attentionByTicket],
  );
  const attentionSignalsByTicket = useMemo(
    () => new Map([...attentionByTicket].map(([id, result]) => [id, result.signals])),
    [attentionByTicket],
  );
  const attentionInspectionsByTicket = useMemo(
    () => new Map([...attentionByTicket].map(([id, result]) => [id, result.inspections])),
    [attentionByTicket],
  );
  const attentionCoverage = `${attentionReferences.filter((reference) => environmentId !== null && observations.get(workbenchAttentionIdentity(environmentId, reference))?.inspected).length} of ${attentionReferences.length} linked PRs inspected`;
  return {
    attentionRefresh,
    refreshAttention,
    attentionReferences,
    attentionScope,
    setAttentionObservations,
    attentionReasonsByTicket,
    attentionSignalsByTicket,
    attentionInspectionsByTicket,
    attentionCoverage,
  };
}
