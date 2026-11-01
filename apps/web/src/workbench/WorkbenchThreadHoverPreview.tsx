import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ReactElement } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { WorkbenchSidebarThreadPreview } from "./WorkbenchSidebarThreadPreview";
import { useWorkbenchSidebarThreadRowData } from "./WorkbenchSidebarThreadRow.logic";

function WorkbenchThreadPreviewContent({
  environmentId,
  threadId,
  title,
  shell,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly shell: EnvironmentThreadShell | undefined;
}) {
  const data = useWorkbenchSidebarThreadRowData({
    thread: { environmentId },
    threadRef: scopeThreadRef(environmentId, threadId),
    fallbackShell: shell,
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
  shell,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  /** The caller's shell, for archived Threads the live shell store omits. */
  readonly shell?: EnvironmentThreadShell | undefined;
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
          shell={shell}
        />
      </TooltipPopup>
    </Tooltip>
  );
}
