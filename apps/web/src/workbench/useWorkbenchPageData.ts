import type { ServerConfig } from "@t3tools/contracts";
import { useWorkbenchTicketDrafts } from "./useWorkbenchTicketDrafts";
import { useWorkbenchThreadLookup } from "./useWorkbenchThreadLookup";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { useProjects } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { useEnvironmentQuery } from "../state/query";

import { useOptimisticWorkbenchStatus } from "./useOptimisticWorkbenchStatus";
import { workbenchEnvironment } from "./state";
import { groupWorkbenchReferences } from "./workbenchReferences.logic";

export function useWorkbenchPageData(environmentId: EnvironmentId | null) {
  // Workbench mutations share orchestration:operate in workbenchRpcPermissions.
  const canOperate = useAtomValue(workbenchEnvironment.createTicket.permissionAtom(environmentId));
  const allProjects = useProjects();
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const { providers, keybindings, availableEditors } = workbenchEnvironmentConfig(serverConfig);
  const query = useEnvironmentQuery(
    environmentId === null ? null : workbenchEnvironment.snapshot({ environmentId, input: {} }),
  );
  const refreshWorkbenchSnapshot = query.refresh;
  const projects = allProjects.filter((project) => project.environmentId === environmentId);
  const repositoriesById = new Map(projects.map((project) => [project.id, project]));
  const snapshot = query.data;
  const snapshotProjects = snapshot?.projects ?? null;
  const optimisticStatus = useOptimisticWorkbenchStatus({
    environmentId,
    tickets: snapshot?.tickets ?? [],
  });
  const { ticketDrafts, clearTicketDraft } = useWorkbenchTicketDrafts({
    environmentId,
    snapshot,
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
