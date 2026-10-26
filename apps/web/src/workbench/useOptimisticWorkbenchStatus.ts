import type {
  EnvironmentId,
  WorkbenchTicket,
  WorkbenchTicketId,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";
import { useLayoutEffect, useState, useRef } from "react";

export type WorkbenchStatusOperationToken = symbol;

export interface UseOptimisticWorkbenchStatusOptions {
  readonly environmentId: EnvironmentId | null;
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
}

export interface WorkbenchStatusBeginInput {
  readonly ticketId: WorkbenchTicketId;
  readonly status: WorkbenchTicketStatus;
}

export interface WorkbenchStatusSucceedInput {
  readonly token: WorkbenchStatusOperationToken;
  readonly status?: WorkbenchTicketStatus;
  readonly revision?: number;
}

export interface OptimisticWorkbenchStatus {
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly pendingTicketIds: ReadonlySet<WorkbenchTicketId>;
  readonly begin: (input: WorkbenchStatusBeginInput) => WorkbenchStatusOperationToken | false;
  readonly succeed: (input: WorkbenchStatusSucceedInput) => void;
  readonly fail: (token: WorkbenchStatusOperationToken) => void;
}

interface StatusOverlay {
  readonly token: WorkbenchStatusOperationToken;
  readonly ticketId: WorkbenchTicketId;
  status: WorkbenchTicketStatus;
  phase: "pending" | "succeeded";
  revision?: number;
}

interface OptimisticStatusState {
  environmentId: EnvironmentId | null;
  readonly overlaysByTicket: Map<WorkbenchTicketId, StatusOverlay>;
  ticketsById: ReadonlyMap<WorkbenchTicketId, WorkbenchTicket>;
}

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

  return overlay.revision === undefined || ticket.revision >= overlay.revision;
};

const pruneOverlays = (state: OptimisticStatusState) => {
  for (const [ticketId, overlay] of state.overlaysByTicket) {
    if (!state.ticketsById.has(ticketId)) {
      state.overlaysByTicket.delete(ticketId);
      continue;
    }
    if (isAuthoritative(state, overlay)) state.overlaysByTicket.delete(ticketId);
  }
};

export function useOptimisticWorkbenchStatus({
  environmentId,
  tickets,
}: UseOptimisticWorkbenchStatusOptions): OptimisticWorkbenchStatus {
  const [stored, setStored] = useState<OptimisticStatusState>(() => ({
    environmentId,
    overlaysByTicket: new Map(),
    ticketsById: new Map(),
  }));
  const stateRef = useRef(stored);
  const state: OptimisticStatusState = (() => {
    const next = {
      environmentId,
      overlaysByTicket: new Map(
        stored.environmentId === environmentId ? stored.overlaysByTicket : [],
      ),
      ticketsById: new Map(tickets.map((ticket) => [ticket.id, ticket])),
    };
    pruneOverlays(next);
    return next;
  })();
  if (
    stored.environmentId !== state.environmentId ||
    stored.overlaysByTicket.size !== state.overlaysByTicket.size
  ) {
    setStored(state);
  }
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const begin = ({ ticketId, status }: WorkbenchStatusBeginInput) => {
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
      phase: "pending",
    });
    stateRef.current = currentState;
    setStored(currentState);
    return token;
  };

  const succeed = ({ token, status, revision }: WorkbenchStatusSucceedInput) => {
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
    };
    currentState.overlaysByTicket.set(overlay.ticketId, saved);

    if (isAuthoritative(currentState, saved)) {
      currentState.overlaysByTicket.delete(overlay.ticketId);
    }
    stateRef.current = currentState;
    setStored(currentState);
  };

  const fail = (token: WorkbenchStatusOperationToken) => {
    const currentState = {
      ...stateRef.current,
      overlaysByTicket: new Map(stateRef.current.overlaysByTicket),
    };
    const overlay = findOverlayByToken(currentState.overlaysByTicket, token);
    if (overlay === undefined) return;
    currentState.overlaysByTicket.delete(overlay.ticketId);
    stateRef.current = currentState;
    setStored(currentState);
  };

  const pendingTicketIds = new Set(state.overlaysByTicket.keys());
  const projectedTickets = tickets.map((ticket) => {
    const overlay = state.overlaysByTicket.get(ticket.id);
    return overlay === undefined ? ticket : { ...ticket, status: overlay.status };
  });
  return {
    tickets: projectedTickets,
    pendingTicketIds,
    begin,
    succeed,
    fail,
  };
}
