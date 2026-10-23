import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { effectiveSnoozed, snoozeWakeLabel } from "@t3tools/client-runtime/state/thread-settled";
import {
  resolveThreadCurrentPullRequestLink,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import {
  linkedPullRequestSnapshotStatus,
  prStatusIndicator,
  resolveThreadPullRequestBadge,
} from "../components/ThreadStatusIndicators";
import { useOpenPrLink } from "../lib/openPullRequestLink";
import { useRightPanelStore } from "../rightPanelStore";
import { useEnvironment } from "../state/environments";
import { useThreadActionMenu } from "../hooks/useThreadActionMenu";
import { useNowMinute } from "../hooks/useNowMinute";
import { useThreadActions } from "../hooks/useThreadActions";
import {
  readEnvironmentSupportsSettlement,
  readThreadShell,
  useProject,
  useThreadShell,
} from "../state/entities";
import { readEnvironmentScope, useEnvironmentScope } from "../state/session";
import { serverEnvironment } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { toastManager } from "../components/ui/toast";
import { deriveProviderInstanceEntries, type ProviderInstanceEntry } from "../providerInstances";
import { getWorkbenchThreadExecutionStatus } from "./workbenchThreadStatus.logic";
import type { WorkbenchSidebarThread } from "./workbenchSidebar.logic";
import {
  resolveWorkbenchSidebarRepositoryLabel,
  resolveWorkbenchSidebarThreadPullRequests,
} from "./workbenchSidebarThread.logic";
import { filterWorkbenchThreadActionMenuItems } from "./workbenchThreadActionMenu";

type ThreadShell = ReturnType<typeof useThreadShell>;
type ThreadProject = ReturnType<typeof useProject>;
type ThreadEnvironment = ReturnType<typeof useEnvironment>;
type ThreadRef = ReturnType<typeof scopeThreadRef>;
type CurrentPullRequest = ReturnType<typeof resolveThreadCurrentPullRequestLink>;

export interface WorkbenchSidebarThreadRowData {
  shell: ThreadShell;
  project: ThreadProject;
  environment: ThreadEnvironment;
  providerEntry: ProviderInstanceEntry | null;
  status: ReturnType<typeof getWorkbenchThreadExecutionStatus>;
  failed: boolean;
  snoozed: boolean;
  /** Native's snoozed-row countdown, such as "23h". */
  wakeLabel: string | null;
  pullRequests: ReturnType<typeof resolveWorkbenchSidebarThreadPullRequests>;
  pullRequestBadge: ReturnType<typeof resolveThreadPullRequestBadge>;
  currentPullRequest: CurrentPullRequest;
  pullRequestIndicator: ReturnType<typeof prStatusIndicator>;
  repositoryLabel: string | null;
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

function resolveRepositoryLabel(project: ThreadProject) {
  return resolveWorkbenchSidebarRepositoryLabel(
    project ? { title: project.title, repositoryIdentity: project.repositoryIdentity } : null,
  );
}

// Like native's sidebar partition, the clock key is an input so the React Compiler recomputes
// snooze state when the minute or a wake deadline passes.
function resolveThreadActivityState(shell: ThreadShell, _clockKey: string) {
  if (shell === null) {
    return { status: null, failed: false, snoozed: false, wakeLabel: null };
  }
  const status = getWorkbenchThreadExecutionStatus(shell);
  const now = new Date().toISOString();
  const snoozed = effectiveSnoozed(shell, { now });
  return {
    status,
    failed: status?.kind === "failed",
    snoozed,
    wakeLabel:
      snoozed && shell.snoozedUntil != null ? snoozeWakeLabel(shell.snoozedUntil, { now }) : null,
  };
}

// Native's scheduleSnoozeWake: wake times are second-precise, and setTimeout delays are signed
// 32-bit, so far-future wakes are capped instead of firing immediately.
function scheduleSnoozeWake(wakeAt: string | null, onWake: () => void): (() => void) | undefined {
  const wakeAtMs = wakeAt === null ? Number.NaN : Date.parse(wakeAt);
  if (Number.isNaN(wakeAtMs)) return undefined;
  const delayMs = Math.min(Math.max(0, wakeAtMs - Date.now()) + 50, 2_147_483_647);
  const id = window.setTimeout(onWake, delayMs);
  return () => window.clearTimeout(id);
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
  thread: WorkbenchSidebarThread;
  threadRef: ThreadRef;
}): WorkbenchSidebarThreadRowData {
  const shell = useThreadShell(threadRef);
  const project = useProject(shell ? scopeProjectRef(shell.environmentId, shell.projectId) : null);
  const environment = useEnvironment(thread.environmentId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(thread.environmentId));
  const providerEntry = resolveProviderEntry(shell, deriveProviderInstanceEntries(providers ?? []));
  const nowMinute = useNowMinute();
  const [wakeTick, bumpWakeTick] = useState(0);
  const snoozedUntil = shell?.snoozedUntil ?? null;
  useEffect(
    () => scheduleSnoozeWake(snoozedUntil, () => bumpWakeTick((tick) => tick + 1)),
    [snoozedUntil],
  );
  const activityState = resolveThreadActivityState(shell, `${nowMinute}:${wakeTick}`);
  const pullRequests = shell ? resolveWorkbenchSidebarThreadPullRequests(shell) : [];
  const pullRequestState = resolveThreadPullRequestState(pullRequests);

  return {
    shell,
    project,
    environment,
    providerEntry,
    ...activityState,
    pullRequests,
    ...pullRequestState,
    repositoryLabel: resolveRepositoryLabel(project),
  };
}

export function useWorkbenchSidebarThreadRename(thread: WorkbenchSidebarThread) {
  const [renameTitle, setRenameTitle] = useState<string | null>(null);
  const renameCommitted = useRef(false);
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });

  const startRename = () => {
    renameCommitted.current = false;
    setRenameTitle(thread.title);
  };

  const cancelRename = () => {
    renameCommitted.current = true;
    setRenameTitle(null);
  };

  const commitRename = () => {
    if (renameCommitted.current || renameTitle === null) return;
    renameCommitted.current = true;
    setRenameTitle(null);
    const title = renameTitle.trim();
    if (!title) {
      toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
      return;
    }
    if (title === thread.title) return;
    void updateMetadata({
      environmentId: thread.environmentId,
      input: { threadId: thread.id, title },
    }).then((result) => {
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        const description = error instanceof Error ? error.message : "An error occurred.";
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description,
        });
      }
    });
  };

  return { renameTitle, setRenameTitle, startRename, cancelRename, commitRename };
}

export function useWorkbenchSidebarThreadInteraction({
  thread,
  threadRef,
  projectCwd,
  isActive,
  onOpenThread,
  startRename,
  currentPullRequest,
  shell,
}: {
  thread: WorkbenchSidebarThread;
  threadRef: ThreadRef;
  projectCwd: string | null;
  isActive: boolean;
  onOpenThread: (thread: WorkbenchSidebarThread) => void;
  startRename: () => void;
  currentPullRequest: CurrentPullRequest;
  shell: ThreadShell;
}) {
  const openPrLink = useOpenPrLink(threadRef);
  const { settleThread, unsettleThread, confirmAndUnpinThread, unsnoozeThread } =
    useThreadActions();
  const config = useAtomValue(serverEnvironment.configValueAtom(thread.environmentId));
  const canOperate = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const settlementPending = useRef(false);
  const [settlementBusy, setSettlementBusy] = useState(false);
  const { openMenu } = useThreadActionMenu({
    threadRef,
    projectCwd,
    onStartRename: startRename,
    filterMenuItems: filterWorkbenchThreadActionMenuItems,
  });
  const handleOpenPullRequest = (event: ReactMouseEvent<HTMLElement>) => {
    const url = currentPullRequest?.url;
    if (!url) return;
    const openedInRightPanel = openPrLink(event, url, threadRef);
    if (openedInRightPanel && !isActive) onOpenThread(thread);
  };
  const handleOpenPullRequestStack = () => {
    useRightPanelStore.getState().open(threadRef, "pull-requests");
    if (!isActive) onOpenThread(thread);
  };

  const toggleSettlement = () => {
    const current = readThreadShell(threadRef);
    if (
      settlementPending.current ||
      !current ||
      current.archivedAt !== null ||
      !readEnvironmentSupportsSettlement(threadRef.environmentId) ||
      !readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)
    )
      return;
    const settled = current.settledOverride === "settled";
    const reportFailure = (cause: unknown) => {
      toastManager.add({
        type: "error",
        title: settled ? "Failed to un-settle thread" : "Failed to settle thread",
        description: cause instanceof Error ? cause.message : "Please try again.",
      });
    };
    settlementPending.current = true;
    setSettlementBusy(true);
    void (async () => {
      const result = await (settled ? unsettleThread : settleThread)(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        reportFailure(squashAtomCommandFailure(result));
      }
    })()
      .catch(reportFailure)
      .finally(() => {
        settlementPending.current = false;
        setSettlementBusy(false);
      });
  };

  const runNativeAction = (
    failureTitle: string,
    action: (target: ThreadRef) => Promise<AtomCommandResult<unknown, unknown>>,
  ) => {
    void action(threadRef).then((result) => {
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: failureTitle,
          description: error instanceof Error ? error.message : "Please try again.",
        });
      }
    });
  };

  return {
    openMenu,
    handleOpenPullRequest,
    handleOpenPullRequestStack,
    canToggleSettlement:
      canOperate &&
      config?.environment.capabilities.threadSettlement === true &&
      shell !== null &&
      shell.archivedAt === null,
    isSettled: shell?.settledOverride === "settled",
    settlementBusy,
    toggleSettlement,
    canUnpin: canOperate && config?.environment.capabilities.threadPinning === true,
    canWake: canOperate && config?.environment.capabilities.threadSnooze === true,
    unpin: () => runNativeAction("Failed to unpin thread", confirmAndUnpinThread),
    wake: () => runNativeAction("Failed to wake thread", unsnoozeThread),
  };
}
