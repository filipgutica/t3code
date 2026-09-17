import { useNavigate } from "@tanstack/react-router";
import { BlocksIcon } from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback } from "react";

import { useSidebar } from "../components/ui/sidebar";

export interface WorkbenchSidebarUtilityItemProps {
  readonly render: (props: {
    readonly icon: ReactNode;
    readonly label: string;
    readonly onClick: () => void;
  }) => ReactNode;
}

export const WorkbenchSidebarUtilityItem = memo(function WorkbenchSidebarUtilityItem({
  render,
}: WorkbenchSidebarUtilityItemProps) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const handleClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/workbench", search: {} });
  }, [isMobile, navigate, setOpenMobile]);

  return render({
    icon: <BlocksIcon />,
    label: "Agent Workbench",
    onClick: handleClick,
  });
});
