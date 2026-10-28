import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import type {
  ContextMenuItem,
  EnvironmentId,
  LocalApi,
  WorkbenchParsedReferenceUrl,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";
import { useNavigate, useRouter } from "@tanstack/react-router";

import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { readLocalApi } from "../localApi";
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
  | `status:${WorkbenchTicketStatus}`
  | "copy-link"
  | "open-issue"
  | "archive";

const openIssueItem = (issue: WorkbenchParsedReferenceUrl | null) =>
  issue ? [{ id: "open-issue" as const, label: `Open ${issue.label}` }] : [];

const menuItems = ({
  ticket,
  issue,
}: {
  readonly ticket: WorkbenchSidebarTicket;
  readonly issue: WorkbenchParsedReferenceUrl | null;
}): ReadonlyArray<ContextMenuItem<TicketMenuAction>> => {
  const active = ticket.archivedAt === null;
  return [
    { id: "new-thread", label: "New Thread", disabled: !active },
    {
      id: "change-status",
      label: "Change status",
      disabled: !active,
      children: getWorkbenchTicketStatusMoves(ticket.status).map((status) => ({
        id: `status:${status}` as const,
        label: WORKBENCH_TICKET_STATUS_LABELS[status],
      })),
    },
    { id: "copy-link", label: "Copy Ticket link", separatorBefore: true },
    ...openIssueItem(issue),
    {
      id: "archive",
      label: active ? "Archive Ticket" : "Restore Ticket",
      separatorBefore: true,
    },
  ];
};

function reportMenuFailure(title: string, cause: unknown): void {
  toastManager.add({
    type: "error",
    title,
    description: cause instanceof Error ? cause.message : "Please try again.",
  });
}

function ticketAction({
  selected,
  environmentId,
  ticket,
}: {
  readonly selected: TicketMenuAction;
  readonly environmentId: EnvironmentId;
  readonly ticket: WorkbenchSidebarTicket;
}): WorkbenchSidebarTicketAction | null {
  const target = { environmentId, ticketId: ticket.id };
  if (selected === "new-thread") {
    return ticket.archivedAt === null ? { ...target, kind: "new-thread" } : null;
  }
  if (selected === "archive") {
    return { ...target, kind: "archive", archived: ticket.archivedAt === null };
  }
  if (!selected.startsWith("status:") || ticket.archivedAt !== null) return null;
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

async function openIssueLink(
  api: LocalApi,
  issue: WorkbenchParsedReferenceUrl | null,
): Promise<void> {
  if (!issue) return;
  try {
    await api.shell.openExternal(issue.url);
  } catch (cause) {
    reportMenuFailure("Could not open the issue", cause);
  }
}

export function useWorkbenchSidebarTicketActionMenu({
  environmentId,
  ticket,
  issue,
  readOnly,
}: {
  readonly environmentId: EnvironmentId | null | undefined;
  readonly ticket: WorkbenchSidebarTicket;
  /** The Ticket's first issue Reference. */
  readonly issue: WorkbenchParsedReferenceUrl | null;
  readonly readOnly: boolean;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const permission = useAtomValue(
    workbenchEnvironment.updateTicket.permissionAtom(environmentId ?? null),
  );
  const canMutate = Boolean(environmentId && permission && !readOnly);
  const runSelected = async (selected: TicketMenuAction) => {
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
    if (selected === "open-issue") {
      await openIssueLink(api, issue);
      return;
    }
    if (readOnly || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    const action = ticketAction({ selected, environmentId, ticket });
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
      const selected = await api.contextMenu.show(
        !mutable
          ? [{ id: "copy-link" as const, label: "Copy Ticket link" }, ...openIssueItem(issue)]
          : menuItems({ ticket, issue }),
        position,
      );
      if (selected !== null) await runSelected(selected);
    })().catch((cause: unknown) => reportMenuFailure("Could not complete Ticket action", cause));
  };
  const newThread = () => {
    if (!canMutate || ticket.archivedAt !== null || ticket.status === "done") return;
    void runSelected("new-thread").catch((cause: unknown) =>
      reportMenuFailure("Could not complete Ticket action", cause),
    );
  };
  return {
    openMenu,
    canCreateThread: canMutate && ticket.archivedAt === null && ticket.status !== "done",
    newThread,
  };
}
