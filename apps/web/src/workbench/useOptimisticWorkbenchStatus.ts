import type {
  EnvironmentId,
  WorkbenchJiraIssueLink,
  WorkbenchJiraIssueSnapshot,
  WorkbenchTicket,
  WorkbenchTicketId,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";
import { useCallback, useLayoutEffect, useMemo, useState, useRef } from "react";

type JiraStatus = WorkbenchJiraIssueSnapshot["status"];

export type WorkbenchStatusOperationToken = symbol;

export interface UseOptimisticWorkbenchStatusOptions {
  readonly environmentId: EnvironmentId | null;
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly issueLinks: ReadonlyArray<WorkbenchJiraIssueLink>;
}

export interface WorkbenchStatusBeginInput {
  readonly ticketId: WorkbenchTicketId;
  readonly status: WorkbenchTicketStatus;
  readonly jiraStatus?: JiraStatus;
}

export interface WorkbenchStatusSucceedInput {
  readonly token: WorkbenchStatusOperationToken;
  readonly status?: WorkbenchTicketStatus;
  readonly revision?: number;
  readonly jiraIssue?: WorkbenchJiraIssueSnapshot;
}

interface StatusOverlay {
  readonly token: WorkbenchStatusOperationToken;
  readonly ticketId: WorkbenchTicketId;
  status: WorkbenchTicketStatus;
  jiraStatus?: JiraStatus;
  jiraIssue?: WorkbenchJiraIssueSnapshot;
  requiresJiraLink: boolean;
  phase: "pending" | "succeeded";
  readonly initialRevision: number;
  revision?: number;
}

interface OptimisticStatusState {
  environmentId: EnvironmentId | null;
  readonly overlaysByTicket: Map<WorkbenchTicketId, StatusOverlay>;
  ticketsById: ReadonlyMap<WorkbenchTicketId, WorkbenchTicket>;
  issueLinksByTicketId: ReadonlyMap<WorkbenchTicketId, WorkbenchJiraIssueLink>;
}

const parseTimestamp = (timestamp: string | null | undefined): number | undefined => {
  if (timestamp === null || timestamp === undefined) return undefined;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const isTimestampAtLeast = ({
  current,
  expected,
}: {
  readonly current: string | null | undefined;
  readonly expected: string | null | undefined;
}): boolean => {
  if (expected === null) return current === null;
  const currentTime = parseTimestamp(current);
  const expectedTime = parseTimestamp(expected);
  return currentTime !== undefined && expectedTime !== undefined && currentTime >= expectedTime;
};

const findOverlayByToken = (
  overlaysByTicket: ReadonlyMap<WorkbenchTicketId, StatusOverlay>,
  token: WorkbenchStatusOperationToken,
): StatusOverlay | undefined => {
  for (const overlay of overlaysByTicket.values()) {
    if (overlay.token === token) return overlay;
  }
  return undefined;
};

const isAuthoritative = (state: OptimisticStatusState, overlay: StatusOverlay): boolean => {
  if (overlay.phase !== "succeeded") return false;

  const ticket = state.ticketsById.get(overlay.ticketId);
  if (ticket === undefined) return false;

  if (overlay.revision !== undefined) {
    if (ticket.revision < overlay.revision) return false;
  }

  if (overlay.jiraIssue !== undefined) {
    const link = state.issueLinksByTicketId.get(overlay.ticketId);
    if (
      !isTimestampAtLeast({
        current: link?.issue.remoteUpdatedAt,
        expected: overlay.jiraIssue.remoteUpdatedAt,
      })
    )
      return false;
    if (ticket.status === overlay.status) return true;
    const currentTime = parseTimestamp(link?.issue.remoteUpdatedAt);
    const savedTime = parseTimestamp(overlay.jiraIssue.remoteUpdatedAt);
    return (
      currentTime !== undefined &&
      savedTime !== undefined &&
      currentTime > savedTime &&
      ticket.revision > overlay.initialRevision
    );
  }

  return true;
};

const pruneOverlays = (state: OptimisticStatusState) => {
  for (const [ticketId, overlay] of state.overlaysByTicket) {
    if (!state.ticketsById.has(ticketId)) {
      state.overlaysByTicket.delete(ticketId);
      continue;
    }
    if (overlay.requiresJiraLink && state.issueLinksByTicketId.get(ticketId)?.active !== true) {
      state.overlaysByTicket.delete(ticketId);
      continue;
    }
    if (isAuthoritative(state, overlay)) state.overlaysByTicket.delete(ticketId);
  }
};

export function useOptimisticWorkbenchStatus({
  environmentId,
  tickets,
  issueLinks,
}: UseOptimisticWorkbenchStatusOptions) {
  const [stored, setStored] = useState<OptimisticStatusState>(() => ({
    environmentId,
    overlaysByTicket: new Map(),
    ticketsById: new Map(),
    issueLinksByTicketId: new Map(),
  }));
  const stateRef = useRef(stored);
  const state = useMemo<OptimisticStatusState>(() => {
    const next = {
      environmentId,
      overlaysByTicket: new Map(
        stored.environmentId === environmentId ? stored.overlaysByTicket : [],
      ),
      ticketsById: new Map(tickets.map((ticket) => [ticket.id, ticket])),
      issueLinksByTicketId: new Map(issueLinks.map((link) => [link.ticketId, link])),
    };
    pruneOverlays(next);
    return next;
  }, [environmentId, tickets, issueLinks, stored]);
  if (
    stored.environmentId !== state.environmentId ||
    stored.overlaysByTicket.size !== state.overlaysByTicket.size
  ) {
    setStored(state);
  }
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const begin = useCallback(({ ticketId, status, jiraStatus }: WorkbenchStatusBeginInput) => {
    const currentState = {
      ...stateRef.current,
      overlaysByTicket: new Map(stateRef.current.overlaysByTicket),
    };
    pruneOverlays(currentState);
    if (
      currentState.environmentId === null ||
      !currentState.ticketsById.has(ticketId) ||
      currentState.overlaysByTicket.has(ticketId)
    ) {
      return false;
    }

    const token = Symbol("workbench-status");
    currentState.overlaysByTicket.set(ticketId, {
      token,
      ticketId,
      status,
      ...(jiraStatus === undefined ? {} : { jiraStatus }),
      requiresJiraLink: jiraStatus !== undefined,
      phase: "pending",
      initialRevision: currentState.ticketsById.get(ticketId)?.revision ?? 0,
    });
    stateRef.current = currentState;
    setStored(currentState);
    return token;
  }, []);

  const succeed = useCallback(
    ({ token, status, revision, jiraIssue }: WorkbenchStatusSucceedInput) => {
      const currentState = {
        ...stateRef.current,
        overlaysByTicket: new Map(stateRef.current.overlaysByTicket),
      };
      const overlay = findOverlayByToken(currentState.overlaysByTicket, token);
      if (overlay === undefined) return;

      const saved: StatusOverlay = {
        ...overlay,
        phase: "succeeded",
        ...(revision !== undefined ? { revision } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(jiraIssue !== undefined
          ? { jiraIssue, jiraStatus: jiraIssue.status, requiresJiraLink: true }
          : {}),
      };
      currentState.overlaysByTicket.set(overlay.ticketId, saved);

      if (isAuthoritative(currentState, saved)) {
        currentState.overlaysByTicket.delete(overlay.ticketId);
      }
      stateRef.current = currentState;
      setStored(currentState);
    },
    [],
  );

  const fail = useCallback((token: WorkbenchStatusOperationToken) => {
    const currentState = {
      ...stateRef.current,
      overlaysByTicket: new Map(stateRef.current.overlaysByTicket),
    };
    const overlay = findOverlayByToken(currentState.overlaysByTicket, token);
    if (overlay === undefined) return;
    currentState.overlaysByTicket.delete(overlay.ticketId);
    stateRef.current = currentState;
    setStored(currentState);
  }, []);

  const pendingTicketIds = useMemo(() => new Set(state.overlaysByTicket.keys()), [state]);
  const projectedTickets = useMemo(
    () =>
      tickets.map((ticket) => {
        const overlay = state.overlaysByTicket.get(ticket.id);
        return overlay === undefined ? ticket : { ...ticket, status: overlay.status };
      }),
    [state, tickets],
  );
  const projectedIssueLinks = useMemo(
    () =>
      issueLinks.map((link) => {
        const overlay = state.overlaysByTicket.get(link.ticketId);
        const status = overlay?.jiraIssue?.status ?? overlay?.jiraStatus;
        return status === undefined ? link : { ...link, issue: { ...link.issue, status } };
      }),
    [state, issueLinks],
  );

  return {
    tickets: projectedTickets,
    issueLinks: projectedIssueLinks,
    pendingTicketIds,
    begin,
    succeed,
    fail,
  };
}
