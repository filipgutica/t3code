import { BlocksIcon } from "lucide-react";
import type { ReactNode } from "react";
import { memo } from "react";

import { useSidebar } from "../components/ui/sidebar";
import { useEnvironment, usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";
import { useNavigateToLastWorkbench } from "./workbenchLastLocation";

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
  const navigateToLastWorkbench = useNavigateToLastWorkbench();
  const { isMobile, setOpenMobile } = useSidebar();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const connected = useEnvironment(primaryEnvironmentId)?.connection.phase === "connected";
  const query = useEnvironmentQuery(
    primaryEnvironmentId && connected
      ? workbenchEnvironment.snapshot({ environmentId: primaryEnvironmentId, input: {} })
      : null,
  );
  const handleClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigateToLastWorkbench();
  };

  if (!connected || !query.isSuccess || !query.data) return null;

  return render({
    icon: <BlocksIcon />,
    label: "Agent Workbench",
    onClick: handleClick,
  });
});
