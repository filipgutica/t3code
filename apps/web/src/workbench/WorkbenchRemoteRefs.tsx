import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createContext, useContext } from "react";

import type { WorkbenchThreadLookupState } from "./workbench.logic";
import type { WorkbenchRemoteRepository } from "./workbenchRemote.logic";

/** What the Board page knows about its refs on other machines, for rows deep in the Ticket. */
export interface WorkbenchRemoteRefs {
  readonly repositories: ReadonlyMap<ProjectId, WorkbenchRemoteRepository>;
  readonly environmentStates: ReadonlyMap<EnvironmentId, WorkbenchThreadLookupState>;
  readonly environmentLabels: ReadonlyMap<EnvironmentId, string>;
}

export const WorkbenchRemoteRefsContext = createContext<WorkbenchRemoteRefs>({
  repositories: new Map(),
  environmentStates: new Map(),
  environmentLabels: new Map(),
});

export const useWorkbenchRemoteRefs = () => useContext(WorkbenchRemoteRefsContext);
