import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ReactElement } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { WorkbenchSidebarThreadPreview } from "./WorkbenchSidebarThreadPreview";
import { useWorkbenchSidebarThreadRowData } from "./WorkbenchSidebarThreadRow.logic";

function WorkbenchThreadPreviewContent({
  environmentId,
  threadId,
  title,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
}) {
  const data = useWorkbenchSidebarThreadRowData({
    thread: { environmentId },
    threadRef: scopeThreadRef(environmentId, threadId),
  });
  return (
    <WorkbenchSidebarThreadPreview
      thread={{ title }}
      shell={data.shell}
      project={data.project}
      environment={data.environment}
      providerEntry={data.providerEntry}
      pullRequests={data.pullRequests}
    />
  );
}

/** The sidebar's hover preview beside a Thread row. Its content, and data, mount only while shown. */
export function WorkbenchThreadHoverPreview({
  environmentId,
  threadId,
  title,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup align="start" side="right" variant="glass" className="text-left">
        <WorkbenchThreadPreviewContent
          environmentId={environmentId}
          threadId={threadId}
          title={title}
        />
      </TooltipPopup>
    </Tooltip>
  );
}
