import { scopeProjectRef, type scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useAtomValue } from "@effect/atom-react";
import {
  resolveThreadCurrentPullRequestLink,
  visibleThreadPullRequests,
} from "@t3tools/client-runtime/thread-pull-requests";
import {
  linkedPullRequestSnapshotStatus,
  prStatusIndicator,
  resolveThreadPullRequestBadge,
} from "../components/ThreadStatusIndicators";
import { useEnvironment } from "../state/environments";
import { useProject, useThreadShell } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { deriveProviderInstanceEntries, type ProviderInstanceEntry } from "../providerInstances";
import type { WorkbenchSidebarThread } from "./workbenchSidebar.logic";
import { resolveWorkbenchSidebarThreadPullRequests } from "./workbenchSidebarThread.logic";

type ThreadShell = ReturnType<typeof useThreadShell>;
type ThreadProject = ReturnType<typeof useProject>;
type ThreadEnvironment = ReturnType<typeof useEnvironment>;
type ThreadRef = ReturnType<typeof scopeThreadRef>;
type CurrentPullRequest = ReturnType<typeof resolveThreadCurrentPullRequestLink>;

interface WorkbenchSidebarThreadRowData {
  shell: ThreadShell;
  project: ThreadProject;
  environment: ThreadEnvironment;
  providerEntry: ProviderInstanceEntry | null;
  pullRequests: ReturnType<typeof resolveWorkbenchSidebarThreadPullRequests>;
  pullRequestBadge: ReturnType<typeof resolveThreadPullRequestBadge>;
  currentPullRequest: CurrentPullRequest;
  pullRequestIndicator: ReturnType<typeof prStatusIndicator>;
}

function resolveProviderEntry(
  shell: ThreadShell,
  providers: ReturnType<typeof deriveProviderInstanceEntries>,
) {
  if (shell === null) return null;
  return (
    providers.find(
      (entry) =>
        entry.instanceId === (shell.runtime?.providerInstanceId ?? shell.modelSelection.instanceId),
    ) ?? null
  );
}

function resolveThreadPullRequestState(
  pullRequests: ReturnType<typeof resolveWorkbenchSidebarThreadPullRequests>,
) {
  const pullRequestBadge = resolveThreadPullRequestBadge(pullRequests);
  const currentPullRequest = resolveThreadCurrentPullRequestLink(
    visibleThreadPullRequests(pullRequests),
  );
  const pullRequestStatus = currentPullRequest?.snapshot
    ? linkedPullRequestSnapshotStatus(currentPullRequest)
    : null;
  return {
    pullRequestBadge,
    currentPullRequest,
    pullRequestIndicator: prStatusIndicator(
      pullRequestStatus?.pr ?? null,
      pullRequestStatus?.sourceControlProvider,
    ),
  };
}

export function useWorkbenchSidebarThreadRowData({
  thread,
  threadRef,
}: {
  thread: Pick<WorkbenchSidebarThread, "environmentId">;
  threadRef: ThreadRef;
}): WorkbenchSidebarThreadRowData {
  const shell = useThreadShell(threadRef);
  const project = useProject(shell ? scopeProjectRef(shell.environmentId, shell.projectId) : null);
  const environment = useEnvironment(thread.environmentId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(thread.environmentId));
  const providerEntry = resolveProviderEntry(shell, deriveProviderInstanceEntries(providers ?? []));
  const pullRequests = shell ? resolveWorkbenchSidebarThreadPullRequests(shell) : [];
  const pullRequestState = resolveThreadPullRequestState(pullRequests);

  return {
    shell,
    project,
    environment,
    providerEntry,
    pullRequests,
    ...pullRequestState,
  };
}
