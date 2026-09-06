import {
  type EnvironmentId,
  type ThreadId,
  WorkbenchEpicId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  AlertCircleIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  BlocksIcon,
  LayoutDashboardIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useMemo } from "react";

import { SidebarChromeFooter } from "../components/sidebar/SidebarChrome";
import { Button } from "../components/ui/button";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../components/ui/sidebar";
import { Skeleton } from "../components/ui/skeleton";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";

const isWorkbenchProjectId = Schema.is(WorkbenchProjectId);
const isWorkbenchTicketId = Schema.is(WorkbenchTicketId);
const isWorkbenchEpicId = Schema.is(WorkbenchEpicId);

export function WorkbenchSidebar({
  context,
}: {
  readonly context?:
    | {
        readonly environmentId: EnvironmentId;
        readonly threadId: ThreadId;
        readonly workspaceId: WorkbenchProjectId;
        readonly ticketId: WorkbenchTicketId;
      }
    | undefined;
}) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId = context?.environmentId ?? primaryEnvironmentId;
  const navigate = useNavigate();
  const search = useSearch({
    strict: false,
    select: (value) => ({
      projectId: isWorkbenchProjectId(value.projectId) ? value.projectId : undefined,
      ticketId: isWorkbenchTicketId(value.ticketId) ? value.ticketId : undefined,
      epicId: isWorkbenchEpicId(value.epicId) ? value.epicId : undefined,
    }),
  });
  const selectedWorkspaceId = context?.workspaceId ?? search.projectId;
  const selectedTicketId = context?.ticketId ?? search.ticketId;
  const selectedEpicId = context ? undefined : search.epicId;
  const { isMobile, setOpenMobile } = useSidebar();
  const query = useEnvironmentQuery(
    environmentId === null ? null : workbenchEnvironment.snapshot({ environmentId, input: {} }),
  );
  const snapshot = query.data;
  const ticketCountsByWorkspace = useMemo(() => {
    const counts = new Map<WorkbenchProjectId, number>();
    for (const ticket of snapshot?.tickets ?? []) {
      if (ticket.archivedAt != null) continue;
      counts.set(ticket.projectId, (counts.get(ticket.projectId) ?? 0) + 1);
    }
    return counts;
  }, [snapshot?.tickets]);
  const archivedTickets = useMemo(
    () =>
      (snapshot?.tickets ?? []).filter(
        (ticket) => ticket.projectId === selectedWorkspaceId && ticket.archivedAt != null,
      ),
    [selectedWorkspaceId, snapshot?.tickets],
  );

  const selectWorkspace = (projectId: WorkbenchProjectId) => {
    if (isMobile) setOpenMobile(false);
    void navigate({
      to: "/workbench",
      search: { projectId },
      replace: true,
    });
  };
  const leaveWorkbench = () => {
    if (isMobile) setOpenMobile(false);
    void (context
      ? navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: context.environmentId, threadId: context.threadId },
          search: {},
        })
      : navigate({ to: "/", search: {} }));
  };
  const addWorkspace = () => {
    if (isMobile) setOpenMobile(false);
    void navigate({
      to: "/workbench",
      search: {
        ...(selectedWorkspaceId ? { projectId: selectedWorkspaceId } : {}),
        ...(selectedTicketId ? { ticketId: selectedTicketId } : {}),
        ...(selectedEpicId ? { epicId: selectedEpicId } : {}),
        create: "workspace",
      },
      replace: true,
    });
  };

  return (
    <>
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup className="gap-2 p-[var(--sidebar-content-inset)]">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={leaveWorkbench}>
                <ArrowLeftIcon />
                <span>Back to Threads</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <div className="flex h-8 items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wide text-sidebar-muted-foreground">
            <BlocksIcon className="size-3.5" />
            <span>Workspaces</span>
          </div>
          <SidebarMenu className="ps-px">
            <SidebarMenuItem>
              <SidebarMenuButton onClick={addWorkspace} variant="outline">
                <PlusIcon />
                <span>Add Workspace</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          {environmentId === null ? (
            <p className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
              Connect an environment to view Workbench Workspaces.
            </p>
          ) : query.isPending && snapshot === null ? (
            <div className="space-y-1" aria-label="Loading Workbench Workspaces">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-5/6" />
            </div>
          ) : query.error && snapshot === null ? (
            <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive-foreground">
              <p className="flex items-start gap-2">
                <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{query.error}</span>
              </p>
              <Button className="w-full" onClick={query.refresh} size="xs" variant="outline">
                <RefreshCwIcon /> Retry
              </Button>
            </div>
          ) : snapshot?.projects.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
              No Workspaces yet. Use Add Workspace above.
            </p>
          ) : (
            <div className="space-y-4">
              <SidebarMenu aria-label="Workbench Workspaces" className="ps-px">
                {(snapshot?.projects ?? []).map((workspace) => (
                  <SidebarMenuItem key={workspace.id}>
                    <SidebarMenuButton
                      aria-current={workspace.id === selectedWorkspaceId ? "page" : undefined}
                      isActive={workspace.id === selectedWorkspaceId}
                      onClick={() => selectWorkspace(workspace.id)}
                    >
                      <LayoutDashboardIcon />
                      <span className="min-w-0 flex-1 truncate">{workspace.title}</span>
                      <span className="text-xs tabular-nums text-sidebar-muted-foreground">
                        {ticketCountsByWorkspace.get(workspace.id) ?? 0}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
              {selectedWorkspaceId ? (
                <section aria-label="Archived Tickets" className="space-y-2">
                  <div className="flex items-center justify-between gap-2 px-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-sidebar-muted-foreground">
                      Archived Tickets
                    </h2>
                    <span className="text-xs tabular-nums text-sidebar-muted-foreground">
                      {archivedTickets.length}
                    </span>
                  </div>
                  {archivedTickets.length > 0 ? (
                    <SidebarMenu className="ps-px">
                      {archivedTickets.map((ticket) => (
                        <SidebarMenuItem key={ticket.id}>
                          <SidebarMenuButton
                            isActive={ticket.id === selectedTicketId}
                            onClick={() => {
                              if (isMobile) setOpenMobile(false);
                              void navigate({
                                to: "/workbench",
                                search: { projectId: ticket.projectId, ticketId: ticket.id },
                                replace: true,
                              });
                            }}
                          >
                            <ArchiveIcon />
                            <span className="min-w-0 flex-1 truncate">{ticket.title}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  ) : (
                    <p className="px-2 text-xs text-sidebar-muted-foreground">
                      No archived Tickets.
                    </p>
                  )}
                </section>
              ) : null}
            </div>
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}
