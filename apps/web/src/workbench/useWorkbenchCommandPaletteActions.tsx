import { useLocation, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ArrowLeftIcon, LayoutDashboardIcon, MessageCircleIcon, PlusIcon } from "lucide-react";
import type { CommandPaletteActionItem } from "../components/CommandPalette.logic";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";
import { parseWorkbenchSearch } from "./workbenchSearch";
import { getWorkbenchCommandPaletteTargets } from "./workbenchCommandPalette.logic";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";
import { useNavigateToLastWorkbench } from "./workbenchLastLocation";

const selectPageChatAvailable = (
  state: ReturnType<typeof useWorkbenchFloatingChatStore.getState>,
) => state.pageChat !== null;

const pageChatActions = (available: boolean): CommandPaletteActionItem[] =>
  available
    ? [
        {
          kind: "action",
          value: "workbench:show-ticket-chat",
          title: "Show chat",
          searchTerms: ["Show chat", "workbench", "thread", "floating"],
          icon: <MessageCircleIcon className="size-4 text-icon-muted" />,
          run: async () => useWorkbenchFloatingChatStore.getState().expand(),
        },
      ]
    : [];

const ticketActions = (
  targets: ReturnType<typeof getWorkbenchCommandPaletteTargets>,
  navigate: ReturnType<typeof useNavigate>,
): CommandPaletteActionItem[] => {
  const items: CommandPaletteActionItem[] = [];
  if (targets.createTicket) {
    const target = targets.createTicket;
    items.push({
      kind: "action",
      value: "workbench:new-ticket",
      title: "New Ticket",
      searchTerms: ["New Ticket", "workbench", "create"],
      icon: <PlusIcon className="size-4 text-icon-muted" />,
      run: () => navigate({ to: "/workbench", search: target }),
    });
  }
  if (targets.ticket) {
    const target = targets.ticket;
    items.push({
      kind: "action",
      value: "workbench:back-to-ticket",
      title: "Back to Ticket",
      searchTerms: ["Back to Ticket", "workbench"],
      icon: <ArrowLeftIcon className="size-4 text-icon-muted" />,
      run: () => navigate({ to: "/workbench", search: target }),
    });
  }
  return items;
};

export const useWorkbenchCommandPaletteActions = ({
  thread,
  draftEnvironmentId,
}: {
  readonly thread:
    | { readonly environmentId: EnvironmentId; readonly id: ThreadId }
    | null
    | undefined;
  readonly draftEnvironmentId: EnvironmentId | undefined;
}): CommandPaletteActionItem[] => {
  const location = useLocation();
  const navigate = useNavigate();
  const navigateToLastWorkbench = useNavigateToLastWorkbench();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const pageChatAvailable = useWorkbenchFloatingChatStore(selectPageChatAvailable);
  const onWorkbench = location.pathname === "/workbench";
  const search = onWorkbench ? parseWorkbenchSearch(location.search) : {};
  const environmentId =
    search.environmentId ?? thread?.environmentId ?? draftEnvironmentId ?? primaryEnvironmentId;
  const connected = environments.some(
    (environment) =>
      environment.environmentId === environmentId && environment.connection.phase === "connected",
  );
  const query = useEnvironmentQuery(
    environmentId && connected ? workbenchEnvironment.snapshot({ environmentId, input: {} }) : null,
  );
  // A successful snapshot doubles as feature detection for upstream or older remote hosts.
  if (!environmentId || !connected || !query.isSuccess || !query.data) return [];
  const targets = getWorkbenchCommandPaletteTargets({
    environmentId,
    snapshot: query.data,
    workspaceId: search.workbenchProjectId,
    threadId: !onWorkbench && thread?.environmentId === environmentId ? thread.id : undefined,
  });
  const items: CommandPaletteActionItem[] = [
    {
      kind: "action",
      value: "workbench:open",
      title: "Open Workbench",
      searchTerms: ["Open Workbench", "board", "tickets"],
      icon: <LayoutDashboardIcon className="size-4 text-icon-muted" />,
      // Without a Board from the current page, return to wherever the user left Workbench.
      run: () =>
        targets.board.workbenchProjectId === undefined
          ? navigateToLastWorkbench(targets.board)
          : navigate({ to: "/workbench", search: targets.board }),
    },
  ];
  items.push(...ticketActions(targets, navigate));
  items.push(...pageChatActions(pageChatAvailable));
  return items;
};
