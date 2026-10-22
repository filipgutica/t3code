import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import type {
  ContextMenuItem,
  EnvironmentId,
  LocalApi,
  WorkbenchJiraGetTicketTransitionsResult,
  WorkbenchJiraIssueLink,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";
import { useNavigate, useRouter } from "@tanstack/react-router";
import * as Cause from "effect/Cause";

import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { readLocalApi } from "../localApi";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readEnvironmentScope } from "../state/session";
import { useSidebar } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { workbenchEnvironment } from "./state";
import { getWorkbenchTicketStatusMoves, WORKBENCH_TICKET_STATUS_LABELS } from "./workbench.logic";
import type { WorkbenchSidebarTicket } from "./workbenchSidebar.logic";
import {
  enqueueWorkbenchSidebarTicketAction,
  takeWorkbenchSidebarTicketAction,
  type WorkbenchSidebarTicketAction,
} from "./workbenchSidebarTicketAction";

type TicketMenuAction =
  | "new-thread"
  | "change-status"
  | `jira-transition:${string}`
  | `status:${WorkbenchTicketStatus}`
  | "copy-link"
  | "open-jira"
  | "archive";

const menuItems = ({
  ticket,
  issueLink,
  jiraOwnershipKnown,
  transitions,
}: {
  readonly ticket: WorkbenchSidebarTicket;
  readonly issueLink: WorkbenchJiraIssueLink | null;
  readonly jiraOwnershipKnown: boolean;
  readonly transitions: WorkbenchJiraGetTicketTransitionsResult | null;
}): ReadonlyArray<ContextMenuItem<TicketMenuAction>> => {
  const active = ticket.archivedAt === null;
  const statusChildren = issueLink
    ? transitions && active
      ? jiraTransitionItems(transitions).map((item) => ({
          ...item,
          id: `jira-transition:${item.id}` as const,
        }))
      : undefined
    : getWorkbenchTicketStatusMoves(ticket.status).map((status) => ({
        id: `status:${status}` as const,
        label: WORKBENCH_TICKET_STATUS_LABELS[status],
      }));
  return [
    { id: "new-thread", label: "New Thread", disabled: !active },
    {
      id: "change-status",
      label: "Change status",
      disabled: !active,
      ...(statusChildren ? { children: statusChildren } : {}),
    },
    { id: "copy-link", label: "Copy Ticket link", separatorBefore: true },
    ...(issueLink ? [{ id: "open-jira" as const, label: "Open in Jira" }] : []),
    ...(!issueLink && jiraOwnershipKnown
      ? [
          {
            id: "archive" as const,
            label: ticket.archivedAt === null ? "Archive Ticket" : "Restore Ticket",
            separatorBefore: true,
          },
        ]
      : []),
  ];
};

function reportMenuFailure(title: string, cause: unknown): void {
  toastManager.add({
    type: "error",
    title,
    description: cause instanceof Error ? cause.message : "Please try again.",
  });
}

function jiraTransitionItems(result: WorkbenchJiraGetTicketTransitionsResult) {
  if (result.remoteUpdatedAt === null) {
    return [{ id: "unavailable", label: "Refresh Jira before changing status", disabled: true }];
  }
  if (!result.transitions.some((transition) => transition.unavailableReason === null)) {
    return [{ id: "unavailable", label: "No transitions available", disabled: true }];
  }
  return result.transitions.map((transition) => ({
    id: transition.id,
    label:
      transition.name === transition.to.name
        ? transition.to.name
        : `${transition.to.name} · ${transition.name}`,
    disabled: transition.unavailableReason !== null,
  }));
}

function jiraTransitionAction({
  environmentId,
  ticket,
  transitions,
  transitionId,
}: {
  readonly environmentId: EnvironmentId;
  readonly ticket: WorkbenchSidebarTicket;
  readonly transitions: WorkbenchJiraGetTicketTransitionsResult;
  readonly transitionId: string | null;
}): WorkbenchSidebarTicketAction | null {
  const transition = transitions.transitions.find(
    (candidate) => candidate.id === transitionId && candidate.unavailableReason === null,
  );
  return transition && transitions.remoteUpdatedAt !== null
    ? {
        environmentId,
        ticketId: ticket.id,
        kind: "jira-transition",
        transitionId: transition.id,
        destination: transition.to,
        expectedRemoteUpdatedAt: transitions.remoteUpdatedAt,
      }
    : null;
}

async function selectJiraTransition({
  api,
  environmentId,
  ticket,
  issueLink,
  position,
}: {
  readonly api: LocalApi;
  readonly environmentId: EnvironmentId;
  readonly ticket: WorkbenchSidebarTicket;
  readonly issueLink: WorkbenchJiraIssueLink;
  readonly position: { x: number; y: number };
}): Promise<WorkbenchSidebarTicketAction | null> {
  const query = workbenchEnvironment.jiraGetTicketTransitions({
    environmentId,
    input: { ticketId: ticket.id, remoteUpdatedAt: issueLink.issue.remoteUpdatedAt },
  });
  const result = await executeAtomQuery(appAtomRegistry, query, {
    refresh: true,
    reportFailure: false,
    reportDefect: false,
  });
  if (result._tag === "Failure") {
    reportMenuFailure("Could not load Jira transitions", Cause.squash(result.cause));
    return null;
  }
  const transitions = result.value;
  let transitionId: string | null;
  try {
    transitionId = await api.contextMenu.show(jiraTransitionItems(transitions), position);
  } catch (cause) {
    reportMenuFailure("Could not open Jira transitions", cause);
    return null;
  }
  return jiraTransitionAction({ environmentId, ticket, transitions, transitionId });
}

function localTicketAction({
  selected,
  environmentId,
  ticket,
  issueLink,
  jiraOwnershipKnown,
}: {
  readonly selected: TicketMenuAction;
  readonly environmentId: EnvironmentId;
  readonly ticket: WorkbenchSidebarTicket;
  readonly issueLink: WorkbenchJiraIssueLink | null;
  readonly jiraOwnershipKnown: boolean;
}): WorkbenchSidebarTicketAction | null {
  const target = { environmentId, ticketId: ticket.id };
  if (selected === "new-thread") {
    return ticket.archivedAt === null ? { ...target, kind: "new-thread" } : null;
  }
  if (selected === "archive") {
    return jiraOwnershipKnown && !issueLink
      ? { ...target, kind: "archive", archived: ticket.archivedAt === null }
      : null;
  }
  if (!selected.startsWith("status:") || ticket.archivedAt !== null || issueLink) return null;
  const status = selected.slice("status:".length) as WorkbenchTicketStatus;
  return getWorkbenchTicketStatusMoves(ticket.status).includes(status)
    ? { ...target, kind: "status", status }
    : null;
}

async function copyTicketLink(href: string): Promise<void> {
  try {
    await writeTextToClipboard(new URL(href, window.location.href).toString(), "Ticket link");
  } catch (cause) {
    reportMenuFailure("Could not copy Ticket link", cause);
  }
}

async function openJiraLink(
  api: LocalApi,
  issueLink: WorkbenchJiraIssueLink | null,
): Promise<void> {
  if (!issueLink) return;
  try {
    await api.shell.openExternal(issueLink.issue.url);
  } catch (cause) {
    reportMenuFailure("Could not open Jira", cause);
  }
}

export function useWorkbenchSidebarTicketActionMenu({
  environmentId,
  ticket,
  issueLink,
  jiraOwnershipKnown,
  readOnly,
}: {
  readonly environmentId: EnvironmentId | null | undefined;
  readonly ticket: WorkbenchSidebarTicket;
  readonly issueLink: WorkbenchJiraIssueLink | null;
  readonly jiraOwnershipKnown: boolean;
  readonly readOnly: boolean;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const permission = useAtomValue(
    workbenchEnvironment.updateTicket.permissionAtom(environmentId ?? null),
  );
  const canMutate = Boolean(environmentId && permission && !readOnly);
  const runSelected = async ({
    selected,
    position,
    transitions = null,
  }: {
    readonly selected: TicketMenuAction;
    readonly position: { x: number; y: number };
    readonly transitions?: WorkbenchJiraGetTicketTransitionsResult | null;
  }) => {
    if (!environmentId) return;
    const api = readLocalApi();
    if (!api) return;
    if (selected === "copy-link") {
      const location = router.buildLocation({
        to: "/workbench",
        search: { environmentId, workbenchProjectId: ticket.projectId, ticketId: ticket.id },
      });
      await copyTicketLink(location.href);
      return;
    }
    if (selected === "open-jira") {
      await openJiraLink(api, issueLink);
      return;
    }
    if (readOnly || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    let action: WorkbenchSidebarTicketAction | null;
    if (selected === "change-status" && issueLink && ticket.archivedAt === null) {
      action = await selectJiraTransition({ api, environmentId, ticket, issueLink, position });
    } else if (
      selected.startsWith("jira-transition:") &&
      issueLink &&
      transitions &&
      ticket.archivedAt === null
    ) {
      action = jiraTransitionAction({
        environmentId,
        ticket,
        transitions,
        transitionId: selected.slice("jira-transition:".length),
      });
    } else {
      action = localTicketAction({
        selected,
        environmentId,
        ticket,
        issueLink,
        jiraOwnershipKnown,
      });
    }
    if (!action || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    enqueueWorkbenchSidebarTicketAction(action);
    if (isMobile) setOpenMobile(false);
    try {
      await navigate({
        to: "/workbench",
        search: { environmentId, workbenchProjectId: ticket.projectId, ticketId: ticket.id },
        replace: true,
      });
    } catch (cause) {
      takeWorkbenchSidebarTicketAction(environmentId, ticket.id);
      reportMenuFailure("Could not open Ticket", cause);
    }
  };
  const openMenu = (position: { x: number; y: number }) => {
    if (!environmentId) return;
    void (async () => {
      const api = readLocalApi();
      if (!api) return;
      const mutable =
        !readOnly && readEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
      const cached =
        mutable && ticket.archivedAt === null && issueLink?.issue.remoteUpdatedAt != null
          ? appAtomRegistry.get(
              workbenchEnvironment.jiraGetTicketTransitions({
                environmentId,
                input: { ticketId: ticket.id, remoteUpdatedAt: issueLink.issue.remoteUpdatedAt },
              }),
            )
          : null;
      const transitions = cached?._tag === "Success" ? cached.value : null;
      const selected = await api.contextMenu.show(
        !mutable
          ? [
              { id: "copy-link" as const, label: "Copy Ticket link" },
              ...(issueLink ? [{ id: "open-jira" as const, label: "Open in Jira" }] : []),
            ]
          : menuItems({ ticket, issueLink, jiraOwnershipKnown, transitions }),
        position,
      );
      if (selected !== null) await runSelected({ selected, position, transitions });
    })().catch((cause: unknown) => reportMenuFailure("Could not complete Ticket action", cause));
  };
  const newThread = (position: { x: number; y: number }) => {
    if (!canMutate || ticket.archivedAt !== null || ticket.status === "done") return;
    void runSelected({ selected: "new-thread", position }).catch((cause: unknown) =>
      reportMenuFailure("Could not complete Ticket action", cause),
    );
  };
  return {
    openMenu,
    prefetchTransitions: () => {
      if (
        !environmentId ||
        !issueLink ||
        !canMutate ||
        ticket.archivedAt !== null ||
        !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
      )
        return;
      void executeAtomQuery(
        appAtomRegistry,
        workbenchEnvironment.jiraGetTicketTransitions({
          environmentId,
          input: { ticketId: ticket.id, remoteUpdatedAt: issueLink.issue.remoteUpdatedAt },
        }),
        { reportFailure: false, reportDefect: false },
      );
    },
    canCreateThread: canMutate && ticket.archivedAt === null && ticket.status !== "done",
    newThread,
  };
}
