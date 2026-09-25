import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import type {
  ContextMenuItem,
  EnvironmentId,
  WorkbenchJiraIssueLink,
  WorkbenchJiraTicketTransition,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";
import { useNavigate, useRouter } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import { useCallback } from "react";

import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { readLocalApi } from "../localApi";
import { appAtomRegistry } from "../rpc/atomRegistry";
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
  | `status:${WorkbenchTicketStatus}`
  | "copy-link"
  | "open-jira"
  | "archive";

const menuItems = ({
  ticket,
  issueLink,
  jiraOwnershipKnown,
}: {
  readonly ticket: WorkbenchSidebarTicket;
  readonly issueLink: WorkbenchJiraIssueLink | null;
  readonly jiraOwnershipKnown: boolean;
}): ReadonlyArray<ContextMenuItem<TicketMenuAction>> => {
  const active = ticket.archivedAt === null;
  return [
    { id: "new-thread", label: "New Thread", disabled: !active },
    {
      id: "change-status",
      label: "Change status",
      disabled: !active,
      ...(issueLink
        ? {}
        : {
            children: getWorkbenchTicketStatusMoves(ticket.status).map((status) => ({
              id: `status:${status}` as const,
              label: WORKBENCH_TICKET_STATUS_LABELS[status],
            })),
          }),
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

export function useWorkbenchSidebarTicketActionMenu({
  environmentId,
  ticket,
  issueLink,
  jiraOwnershipKnown,
}: {
  readonly environmentId: EnvironmentId | null | undefined;
  readonly ticket: WorkbenchSidebarTicket;
  readonly issueLink: WorkbenchJiraIssueLink | null;
  readonly jiraOwnershipKnown: boolean;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();

  const openMenu = useCallback(
    (position: { x: number; y: number }) => {
      if (!environmentId) return;
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        let selected: TicketMenuAction | null;
        try {
          selected = await api.contextMenu.show(
            menuItems({ ticket, issueLink, jiraOwnershipKnown }),
            position,
          );
        } catch (cause) {
          reportMenuFailure("Could not open Ticket actions", cause);
          return;
        }
        if (selected === null) return;

        if (selected === "copy-link") {
          const location = router.buildLocation({
            to: "/workbench",
            search: { environmentId, workbenchProjectId: ticket.projectId, ticketId: ticket.id },
          });
          try {
            await writeTextToClipboard(
              new URL(location.href, window.location.href).toString(),
              "Ticket link",
            );
          } catch (cause) {
            reportMenuFailure("Could not copy Ticket link", cause);
          }
          return;
        }
        if (selected === "open-jira") {
          if (!issueLink) return;
          try {
            await api.shell.openExternal(issueLink.issue.url);
          } catch (cause) {
            reportMenuFailure("Could not open Jira", cause);
          }
          return;
        }

        let action: WorkbenchSidebarTicketAction;
        const target = { environmentId, ticketId: ticket.id };
        if (selected === "new-thread") {
          if (ticket.archivedAt !== null) return;
          action = { ...target, kind: "new-thread" };
        } else if (selected === "archive") {
          if (!jiraOwnershipKnown || issueLink) return;
          action = { ...target, kind: "archive", archived: ticket.archivedAt === null };
        } else if (selected.startsWith("status:")) {
          if (ticket.archivedAt !== null || issueLink) return;
          const status = selected.slice("status:".length) as WorkbenchTicketStatus;
          if (!getWorkbenchTicketStatusMoves(ticket.status).includes(status)) return;
          action = { ...target, kind: "status", status };
        } else if (selected === "change-status" && issueLink && ticket.archivedAt === null) {
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
            return;
          }
          const transitions = result.value;
          if (transitions.remoteUpdatedAt === null) {
            await api.contextMenu.show(
              [{ id: "unavailable", label: "Refresh Jira before changing status", disabled: true }],
              position,
            );
            return;
          }
          const available = transitions.transitions.filter(
            (transition) => transition.unavailableReason === null,
          );
          if (available.length === 0) {
            await api.contextMenu.show(
              [{ id: "unavailable", label: "No transitions available", disabled: true }],
              position,
            );
            return;
          }
          const items: ReadonlyArray<ContextMenuItem<string>> = transitions.transitions.map(
            (transition) => ({
              id: transition.id,
              label:
                transition.name === transition.to.name
                  ? transition.to.name
                  : `${transition.to.name} · ${transition.name}`,
              disabled: transition.unavailableReason !== null,
            }),
          );
          let transitionId: string | null;
          try {
            transitionId = await api.contextMenu.show(items, position);
          } catch (cause) {
            reportMenuFailure("Could not open Jira transitions", cause);
            return;
          }
          const transition: WorkbenchJiraTicketTransition | undefined = available.find(
            (candidate) => candidate.id === transitionId,
          );
          if (!transition) return;
          action = {
            ...target,
            kind: "jira-transition",
            transitionId: transition.id,
            destination: transition.to,
            expectedRemoteUpdatedAt: transitions.remoteUpdatedAt,
          };
        } else {
          return;
        }

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
      })().catch((cause: unknown) => reportMenuFailure("Could not complete Ticket action", cause));
    },
    [
      environmentId,
      isMobile,
      issueLink,
      jiraOwnershipKnown,
      navigate,
      router,
      setOpenMobile,
      ticket,
    ],
  );

  return { openMenu };
}
