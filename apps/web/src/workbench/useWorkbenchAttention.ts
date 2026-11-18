import { useStableCallback } from "../hooks/useStableCallback";
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
import { Atom } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import { useWorkbenchAttentionQueries, workbenchPullRequestRef } from "./WorkbenchAttentionQueries";
import { pullRequestEnvironment } from "../state/pullRequests";
import { environmentThreadDetails } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useUiStateStore } from "../uiStateStore";
import { resolveThreadLastVisitedAt, resolveThreadStatusPill } from "../components/Sidebar.logic";
import {
  getWorkbenchTicketPullRequests,
  type TicketPullRequestReference,
  type WorkbenchTicketPullRequest,
} from "./workbenchPullRequests.logic";
import {
  activeWorkbenchAttentionAssignments,
  getWorkbenchPullRequestAttention,
  getWorkbenchThreadNotification,
  getWorkbenchAttentionSignalLabel,
  workbenchAttentionIdentity,
  type WorkbenchAttentionSignal,
  type WorkbenchAttentionInspection,
} from "./workbenchAttention.logic";

type PendingRequestsByThread = ReadonlyMap<ThreadId, PendingThreadRequests>;
const FOCUS_REFRESH_MIN_AWAY_MS = 5_000;

const getObservedPullRequestRow = ({
  row,
  pullRequestTitle,
}: {
  row: WorkbenchTicketPullRequest;
  pullRequestTitle: string | undefined;
}) =>
  pullRequestTitle ? { ...row, pullRequest: { ...row.pullRequest, title: pullRequestTitle } } : row;

const useWorkbenchThreadNotifications = ({
  environmentId,
  tickets,
  activeAssignments,
  threadsById,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly activeAssignments: ReadonlyArray<WorkbenchAssignment>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
}) => {
  const pendingThreadIds = (() => {
    const ticketIds = new Set(tickets.map((ticket) => ticket.id));
    const ids = new Set(
      activeAssignments
        .filter((assignment) => ticketIds.has(assignment.ticketId))
        .map((assignment) => assignment.threadId),
    );
    return [...ids].filter((id) => {
      const thread = threadsById.get(id);
      return thread?.hasPendingUserInput || thread?.hasPendingApprovals;
    });
  })();
  // Only pending Threads need native details; the server pins their unresolved requests.
  const pendingRequestsByThread = useAtomValue(
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
  );
  const visitedByThread = useUiStateStore((state) => state.threadLastVisitedAtById);
  return { pendingRequestsByThread, visitedByThread };
};

const getTicketThreadAttention = ({
  assignments,
  threadsById,
  pendingRequestsByThread,
  visitedByThread,
  activeThreadRef,
}: {
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
    const notification = getWorkbenchThreadNotification({
      nativeLabel,
      runStatus: thread.latestRun?.status,
      completedAt: thread.latestRun?.completedAt,
      pendingRequests: pendingRequestsByThread.get(thread.id),
      lastVisitedAt: resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        visitedByThread[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
      ),
    });
    const isOpen =
      activeThreadRef?.environmentId === thread.environmentId &&
      activeThreadRef.threadId === thread.id;
    if (notification && !isOpen) {
      const signal: WorkbenchAttentionSignal = {
        ...notification,
        source: { type: "thread", threadId: thread.id, threadTitle: thread.title },
      };
      signals.push(signal);
      reasons.add(getWorkbenchAttentionSignalLabel(signal));
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
  const invalidatePullRequest = useAtomCommand(pullRequestEnvironment.invalidate, {
    reportFailure: false,
  });
  const activeAssignments = activeWorkbenchAttentionAssignments({
    assignments,
    threadsById,
    environmentId,
  });
  const { pendingRequestsByThread, visitedByThread } = useWorkbenchThreadNotifications({
    environmentId,
    tickets,
    activeAssignments,
    threadsById,
  });
  const assignmentsByTicket = (() => {
    const groups = new Map<WorkbenchTicketId, WorkbenchAssignment[]>();
    for (const assignment of activeAssignments) {
      const group = groups.get(assignment.ticketId) ?? [];
      group.push(assignment);
      groups.set(assignment.ticketId, group);
    }
    return groups;
  })();
  const attentionReferencesByTicket = new Map(
    tickets.map((ticket) => [
      ticket.id,
      getWorkbenchTicketPullRequests({
        assignments: assignmentsByTicket.get(ticket.id) ?? [],
        threadsById,
        archivedThreadsById: new Map(),
        includeBranchPullRequest: false,
      }),
    ]),
  );
  const attentionReferences =
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
        ];
  const attentionEntityScope = JSON.stringify([environmentId, projectId]);
  const referenceScopes =
    environmentId === null
      ? new Map<string, string>()
      : new Map(
          attentionReferences.map((reference) => [
            workbenchAttentionIdentity(environmentId, reference),
            JSON.stringify([reference.state, reference.checksState, reference.reviewDecision]),
          ]),
        );
  const attentionScope = JSON.stringify([
    attentionEntityScope,
    [...referenceScopes],
    attentionRefresh,
  ]);
  const observations = useWorkbenchAttentionQueries({
    environmentId,
    entityScope: attentionEntityScope,
    scope: attentionScope,
    references: attentionReferences,
    refreshGeneration: attentionRefresh,
  });
  const observationOf = (reference: TicketPullRequestReference) =>
    environmentId === null
      ? undefined
      : observations.get(workbenchAttentionIdentity(environmentId, reference));
  // Changes made on the host, such as resolving a review thread, send no refresh signal,
  // so a refresh re-reads flagged PRs past the server cache. Atom commands settle without throwing.
  const refreshing = useRef(false);
  const refreshAttention = useStableCallback(() => {
    if (refreshing.current) return;
    refreshing.current = true;
    const flagged =
      environmentId === null
        ? []
        : attentionReferences
            .filter((reference) => (observationOf(reference)?.signalKinds.length ?? 0) > 0)
            .map((reference) =>
              invalidatePullRequest({
                environmentId,
                input: { reference: workbenchPullRequestRef(reference) },
              }),
            );
    void Promise.all(flagged).then(() => {
      refreshing.current = false;
      setAttentionRefresh((previous) => previous + 1);
    });
  });
  // Only a real absence, such as a visit to the PR host, spends host requests; alt-tab glances
  // and clicks into embedded frames also blur the window.
  const blurredAt = useRef<number | null>(null);
  const refreshAttentionOnFocus = useStableCallback(() => {
    const awayMs = blurredAt.current === null ? 0 : Date.now() - blurredAt.current;
    blurredAt.current = null;
    if (attentionReferences.length > 0 && awayMs >= FOCUS_REFRESH_MIN_AWAY_MS) refreshAttention();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to window focus: returning from the PR host is when its state most likely changed
  useEffect(() => {
    const onBlur = () => {
      blurredAt.current = Date.now();
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", refreshAttentionOnFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", refreshAttentionOnFocus);
    };
  }, [refreshAttentionOnFocus]);
  const attentionByTicket = new Map(
    tickets.map((ticket) => {
      const { signals, reasons } = getTicketThreadAttention({
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
          observationOf(reference) ??
          getWorkbenchPullRequestAttention({
            reference,
            summary: null,
            activity: null,
            loading: true,
            error: false,
          });
        observation.reasons.forEach((reason) => reasons.add(reason));
        const observedRow = getObservedPullRequestRow({
          row,
          pullRequestTitle: observation.pullRequestTitle,
        });
        for (const kind of observation.signalKinds) {
          signals.push({
            kind,
            source: { type: "pull-request", row: observedRow },
            unresolvedReviewThreads: observation.unresolvedReviewThreads,
          });
        }
        if (reference.state !== "closed" && reference.state !== "merged") {
          inspections.push({
            row: observedRow,
            status: observation.inspectionStatus,
            displayStatus: observation.displayInspectionStatus,
            inspected: observation.inspected,
          });
        }
      }
      return [ticket.id, { reasons: [...reasons], signals, inspections }];
    }),
  );
  const attentionReasonsByTicket = new Map(
    [...attentionByTicket].map(([id, result]) => [id, result.reasons]),
  );
  const attentionSignalsByTicket = new Map(
    [...attentionByTicket].map(([id, result]) => [id, result.signals]),
  );
  const attentionInspectionsByTicket = new Map(
    [...attentionByTicket].map(([id, result]) => [id, result.inspections]),
  );
  const attentionCoverage = `${attentionReferences.filter((reference) => observationOf(reference)?.inspected).length} of ${attentionReferences.length} linked PRs inspected`;
  return {
    attentionRefresh,
    refreshAttention,
    attentionReferences,
    attentionScope,
    attentionReasonsByTicket,
    attentionSignalsByTicket,
    attentionInspectionsByTicket,
    attentionCoverage,
  };
}
