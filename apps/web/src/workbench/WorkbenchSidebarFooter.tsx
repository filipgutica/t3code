import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, ChartNoAxesColumnIcon, SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { readPullRequestListPreferences } from "../components/pullRequest/pullRequestListPreferences";
import { SidebarProviderUpdatePill } from "../components/sidebar/SidebarProviderUpdatePill";
import { SidebarThreadUndoNotice } from "../components/sidebar/SidebarThreadUndoNotice";
import {
  SidebarUpdateArchitectureWarning,
  SidebarUpdatePill,
} from "../components/sidebar/SidebarUpdatePill";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { usePullRequestsSupported } from "../state/environments";

/** Workbench keeps one exit across boards and native Thread routes. */
export function WorkbenchSidebarFooter({
  onLeave,
  retainedWorktrees,
}: {
  onLeave: () => void;
  retainedWorktrees: ReactNode;
}) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const pullRequestsSupported = usePullRequestsSupported();
  const openUtility = (action: () => void) => {
    if (isMobile) setOpenMobile(false);
    action();
  };
  const utilities = [
    {
      label: "Settings",
      icon: <SettingsIcon />,
      onClick: () => openUtility(() => void navigate({ to: "/settings" })),
    },
    ...(pullRequestsSupported
      ? [
          {
            label: "Pull Requests",
            icon: <PullRequestGlyph.pullRequest />,
            onClick: () =>
              openUtility(
                () =>
                  void navigate({ to: "/pull-requests", search: readPullRequestListPreferences() }),
              ),
          },
        ]
      : []),
    {
      label: "Usage",
      icon: <ChartNoAxesColumnIcon />,
      onClick: () => openUtility(() => void navigate({ to: "/usage" })),
    },
  ];
  return (
    <SidebarFooter>
      <SidebarThreadUndoNotice />
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarMenu className="flex-row items-center">
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarMenuButton aria-label="Back to Threads" onClick={onLeave} size="sm">
            <ArrowLeftIcon />
            <span>Threads</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem className="shrink-0 empty:hidden">{retainedWorktrees}</SidebarMenuItem>
        {utilities.map(({ label, icon, onClick }) => (
          <SidebarMenuItem key={label} className="shrink-0">
            <Tooltip>
              <TooltipTrigger
                render={
                  <SidebarMenuButton aria-label={label} onClick={onClick} size="icon">
                    {icon}
                  </SidebarMenuButton>
                }
              />
              <TooltipPopup side="top">{label}</TooltipPopup>
            </Tooltip>
          </SidebarMenuItem>
        ))}
        <SidebarUpdatePill />
      </SidebarMenu>
    </SidebarFooter>
  );
}
