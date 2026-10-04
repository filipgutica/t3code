import type {
  EnvironmentId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicket,
  WorkbenchTicketId,
  WorkbenchAssignment,
  ScopedThreadRef,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useAtomValue } from "@effect/atom-react";
import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";
import { environmentThreadDetails } from "../state/threads";
import { useUiStateStore } from "../uiStateStore";
import { resolveThreadStatusPill } from "../components/Sidebar.logic";
import { getWorkbenchAgentPresentation } from "./workbench.logic";
import { getWorkbenchTicketPullRequests } from "./workbenchPullRequests.logic";
import {
  activeWorkbenchAttentionAssignments,
  getWorkbenchPullRequestAttention,
  getWorkbenchThreadNotification,
  mergeWorkbenchPullRequestAttention,
  workbenchAttentionIdentity,
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

type PendingRequestsByThread = ReadonlyMap<ThreadId, PendingThreadRequests>;

const useWorkbenchThreadNotifications = ({
  environmentId,
  tickets,
  activeAssignments,
  threadsById,
  activeThreadRef,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly activeAssignments: ReadonlyArray<WorkbenchAssignment>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly activeThreadRef: ScopedThreadRef | null;
}) => {
  const pendingThreadIds = useMemo(() => {
    const ticketIds = new Set(tickets.map((ticket) => ticket.id));
    const ids = new Set(
      activeAssignments
        .filter((assignment) => ticketIds.has(assignment.ticketId))
        .map((assignment) => assignment.threadId),
    );
    if (activeThreadRef?.environmentId === environmentId) ids.add(activeThreadRef.threadId);
    return [...ids].filter((id) => {
      const thread = threadsById.get(id);
      return thread?.hasPendingUserInput || thread?.hasPendingApprovals;
    });
  }, [activeAssignments, activeThreadRef, environmentId, threadsById, tickets]);
  // Only pending Threads need native details; the server pins their unresolved requests.
  const pendingRequestsByThread = useAtomValue(
    useMemo(
      () =>
        Atom.make((get) => {
          const requests = new Map<ThreadId, PendingThreadRequests>();
          if (environmentId === null) return requests;
          for (const id of pendingThreadIds) {
            const pending = get(
              environmentThreadDetails.pendingRequestsAtom(scopeThreadRef(environmentId, id)),
            );
            if (pending !== null) requests.set(id, pending);
          }
          return requests;
        }).pipe(Atom.setIdleTTL(0)),
      [environmentId, pendingThreadIds],
    ),
  );
  const visitedByThread = useUiStateStore((state) => state.threadLastVisitedAtById);
  const markThreadVisited = useUiStateStore((state) => state.markThreadVisited);
  const activeThread =
    activeThreadRef?.environmentId === environmentId
      ? threadsById.get(activeThreadRef.threadId)
      : undefined;
  const activeNotification = activeThread
    ? getWorkbenchThreadNotification({
        nativeLabel: resolveThreadStatusPill({ thread: activeThread })?.label,
        runStatus: activeThread.latestRun?.status,
        completedAt: activeThread.latestRun?.completedAt,
        pendingRequests: pendingRequestsByThread.get(activeThread.id),
      })
    : null;
  const activeNotificationAt = activeNotification?.occurredAt;
  useEffect(() => {
    if (activeThreadRef && activeNotificationAt) {
      markThreadVisited(scopedThreadKey(activeThreadRef), activeNotificationAt);
    }
  }, [activeThreadRef, activeNotificationAt, markThreadVisited]);
  return { pendingRequestsByThread, visitedByThread };
};

const getTicketThreadAttention = ({
  ticket,
  assignments,
  threadsById,
  pendingRequestsByThread,
  visitedByThread,
  activeThreadRef,
}: {
  readonly ticket: WorkbenchTicket;
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly pendingRequestsByThread: PendingRequestsByThread;
  readonly visitedByThread: Readonly<Record<string, string>>;
  readonly activeThreadRef: ScopedThreadRef | null;
}) => {
  const signals: WorkbenchAttentionSignal[] = [];
  const threadIds = new Set<ThreadId>();
  const reasons = new Set<string>();
  for (const assignment of assignments) {
    const thread = threadsById.get(assignment.threadId);
    if (!thread || threadIds.has(thread.id)) continue;
    threadIds.add(thread.id);
    const nativeLabel = resolveThreadStatusPill({ thread })?.label;
    const presentation = getWorkbenchAgentPresentation({
      nativeLabel,
      runtimeStatus: thread.runtime?.status,
      runStatus: thread.latestRun?.status,
      settledOverride: thread.settledOverride,
      ticketStatus: ticket.status,
    });
    const notification = getWorkbenchThreadNotification({
      nativeLabel,
      runStatus: thread.latestRun?.status,
      completedAt: thread.latestRun?.completedAt,
      pendingRequests: pendingRequestsByThread.get(thread.id),
      lastVisitedAt:
        visitedByThread[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
    });
    const isOpen =
      activeThreadRef?.environmentId === thread.environmentId &&
      activeThreadRef.threadId === thread.id;
    if (notification && !isOpen) {
      signals.push({
        kind: notification.kind,
        source: { type: "thread", threadId: thread.id, threadTitle: thread.title },
      });
      if (presentation) reasons.add(presentation.label);
    }
  }
  return { signals, reasons };
};

export function useWorkbenchAttention({
  environmentId,
  projectId,
  tickets,
  assignments,
  threadsById,
  activeThreadRef,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: WorkbenchProjectId | null;
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly activeThreadRef: ScopedThreadRef | null;
}) {
  const [attentionRefresh, setAttentionRefresh] = useState(0);
  const refreshAttention = () => setAttentionRefresh((previous) => previous + 1);
  const activeAssignments = useMemo(
    () => activeWorkbenchAttentionAssignments({ assignments, threadsById, environmentId }),
    [assignments, threadsById, environmentId],
  );
  const { pendingRequestsByThread, visitedByThread } = useWorkbenchThreadNotifications({
    environmentId,
    tickets,
    activeAssignments,
    threadsById,
    activeThreadRef,
  });
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
          const { signals, reasons } = getTicketThreadAttention({
            ticket,
            assignments: assignmentsByTicket.get(ticket.id) ?? [],
            threadsById,
            pendingRequestsByThread,
            visitedByThread,
            activeThreadRef,
          });
          const inspections: WorkbenchAttentionInspection[] = [];
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
      pendingRequestsByThread,
      visitedByThread,
      activeThreadRef,
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
