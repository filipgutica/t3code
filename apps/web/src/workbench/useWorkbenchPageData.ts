import type { ServerConfig } from "@t3tools/contracts";
import { useWorkbenchTicketDrafts } from "./useWorkbenchTicketDrafts";
import { useWorkbenchThreadLookup } from "./useWorkbenchThreadLookup";
import { useAtomMount, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { useConnectedEnvironmentIds } from "../state/environments";
import { getWorkbenchProjects } from "./workbenchRemoteProjects";
import { useProjects } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { useEnvironmentQuery } from "../state/query";

import { useOptimisticWorkbenchStatus } from "./useOptimisticWorkbenchStatus";
import { workbenchEnvironment } from "./state";
import { groupWorkbenchReferences } from "./workbenchReferences.logic";
import {
  idleWorkbenchSnapshotReconciliation,
  workbenchSnapshotReconciliation,
} from "./workbenchSnapshotReconciliation";

export function useWorkbenchPageData(environmentId: EnvironmentId | null) {
  useAtomMount(
    environmentId === null
      ? idleWorkbenchSnapshotReconciliation
      : workbenchSnapshotReconciliation(environmentId),
  );
  // Workbench mutations share orchestration:operate in workbenchRpcPermissions.
  const canOperate = useAtomValue(workbenchEnvironment.createTicket.permissionAtom(environmentId));
  const allProjects = useProjects();
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const { providers, keybindings, availableEditors } = workbenchEnvironmentConfig(serverConfig);
  const query = useEnvironmentQuery(
    environmentId === null ? null : workbenchEnvironment.snapshot({ environmentId, input: {} }),
  );
  const refreshWorkbenchSnapshot = query.refresh;
  const snapshot = query.data;
  const projects = getWorkbenchProjects({
    projects: allProjects,
    environmentId,
    connectedEnvironmentIds,
    boards: snapshot?.projects ?? [],
  });
  const repositoriesById = new Map(projects.map((project) => [project.id, project]));
  const snapshotProjects = snapshot?.projects ?? null;
  const optimisticStatus = useOptimisticWorkbenchStatus({
    environmentId,
    tickets: snapshot?.tickets ?? [],
  });
  const { ticketDrafts, clearTicketDraft } = useWorkbenchTicketDrafts({
    environmentId,
  });
  const threadLookup = useWorkbenchThreadLookup({ environmentId, snapshot });
  const referencesByTicket = groupWorkbenchReferences(snapshot?.references ?? []);
  return {
    canOperate,
    projects,
    repositoriesById,
    providers,
    keybindings,
    availableEditors,
    query,
    refreshWorkbenchSnapshot,
    ticketDrafts,
    clearTicketDraft,
    snapshot,
    snapshotProjects,
    referencesByTicket,
    optimisticStatus,
    ...threadLookup,
  };
}

function workbenchEnvironmentConfig(serverConfig: ServerConfig | null) {
  const providers = serverConfig?.providers ?? [];
  const keybindings = serverConfig?.keybindings ?? DEFAULT_RESOLVED_KEYBINDINGS;
  const availableEditors = serverConfig?.availableEditors ?? [];
  return { providers, keybindings, availableEditors };
}
