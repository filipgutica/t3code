import type { ServerConfig } from "@t3tools/contracts";
import { useWorkbenchTicketDrafts } from "./useWorkbenchTicketDrafts";
import { useWorkbenchThreadLookup } from "./useWorkbenchThreadLookup";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { useMemo } from "react";
import { useProjects } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { useEnvironmentQuery } from "../state/query";

import { useOptimisticWorkbenchStatus } from "./useOptimisticWorkbenchStatus";
import { workbenchEnvironment } from "./state";

export function useWorkbenchPageData(environmentId: EnvironmentId | null) {
  const allProjects = useProjects();
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const { providers, keybindings, availableEditors } = workbenchEnvironmentConfig(serverConfig);
  const query = useEnvironmentQuery(
    environmentId === null ? null : workbenchEnvironment.snapshot({ environmentId, input: {} }),
  );
  const jiraQuery = useEnvironmentQuery(
    environmentId === null ? null : workbenchEnvironment.jiraSnapshot({ environmentId, input: {} }),
  );
  const refreshWorkbenchSnapshot = query.refresh;
  const refreshJiraSnapshot = jiraQuery.refresh;
  const projects = useMemo(
    () => allProjects.filter((project) => project.environmentId === environmentId),
    [allProjects, environmentId],
  );
  const repositoriesById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const snapshot = query.data;
  const snapshotProjects = snapshot?.projects ?? null;
  const jiraSnapshot = jiraQuery.data;
  const optimisticStatus = useOptimisticWorkbenchStatus({
    environmentId,
    tickets: snapshot?.tickets ?? [],
    issueLinks: jiraSnapshot?.issueLinks ?? [],
  });
  const { ticketDrafts, clearTicketDraft } = useWorkbenchTicketDrafts({
    environmentId,
    snapshot,
    jiraSnapshot,
  });
  const threadLookup = useWorkbenchThreadLookup({ environmentId, snapshot });
  return {
    projects,
    repositoriesById,
    providers,
    keybindings,
    availableEditors,
    query,
    jiraQuery,
    refreshWorkbenchSnapshot,
    refreshJiraSnapshot,
    ticketDrafts,
    clearTicketDraft,
    snapshot,
    snapshotProjects,
    jiraSnapshot,
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
