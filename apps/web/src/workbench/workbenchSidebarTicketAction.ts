import type {
  EnvironmentId,
  WorkbenchJiraTicketTransition,
  WorkbenchTicketId,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";

type TicketActionTarget = {
  readonly environmentId: EnvironmentId;
  readonly ticketId: WorkbenchTicketId;
};

export type WorkbenchSidebarTicketAction = TicketActionTarget &
  (
    | { readonly kind: "new-thread" }
    | { readonly kind: "status"; readonly status: WorkbenchTicketStatus }
    | {
        readonly kind: "jira-transition";
        readonly transitionId: string;
        readonly destination: WorkbenchJiraTicketTransition["to"];
        readonly expectedRemoteUpdatedAt: string;
      }
    | { readonly kind: "archive"; readonly archived: boolean }
  );

const ACTION_LIFETIME_MS = 30_000;
const pendingByEnvironment = new Map<
  EnvironmentId,
  { readonly action: WorkbenchSidebarTicketAction; readonly createdAt: number }
>();
const listeners = new Set<() => void>();

function pendingAction(environmentId: EnvironmentId): WorkbenchSidebarTicketAction | null {
  const pending = pendingByEnvironment.get(environmentId);
  if (!pending) return null;
  if (Date.now() - pending.createdAt <= ACTION_LIFETIME_MS) return pending.action;
  pendingByEnvironment.delete(environmentId);
  return null;
}

/** One-shot handoff: the Workbench page resolves the current Ticket before mutating it. */
export function enqueueWorkbenchSidebarTicketAction(action: WorkbenchSidebarTicketAction): void {
  pendingByEnvironment.set(action.environmentId, { action, createdAt: Date.now() });
  for (const listener of listeners) listener();
}

export function peekWorkbenchSidebarTicketAction(
  environmentId: EnvironmentId,
): WorkbenchSidebarTicketAction | null {
  return pendingAction(environmentId);
}

export function takeWorkbenchSidebarTicketAction(
  environmentId: EnvironmentId,
  ticketId: WorkbenchTicketId,
): WorkbenchSidebarTicketAction | null {
  const action = pendingAction(environmentId);
  if (action?.ticketId !== ticketId) return null;
  pendingByEnvironment.delete(environmentId);
  return action;
}

export function subscribeWorkbenchSidebarTicketActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
