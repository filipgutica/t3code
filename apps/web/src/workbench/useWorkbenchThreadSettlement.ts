import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useThreadActions } from "../hooks/useThreadActions";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "../state/server";

/**
 * Settles or un-settles one Thread at a time with the native actions, as sidebar rows do. Each
 * Thread settles on its own environment, which may be another machine than the Board host.
 */
export function useWorkbenchThreadSettlement(environmentId: EnvironmentId) {
  const { settleThread, unsettleThread } = useThreadActions();
  const [settlementPendingThreadId, setSettlementPendingThreadId] = useState<ThreadId | null>(null);
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const supportsSettlement = serverConfig?.environment.capabilities.threadSettlement === true;
  const toggleThreadSettlement = async (thread: EnvironmentThreadShell) => {
    const threadServerConfig =
      thread.environmentId === environmentId
        ? serverConfig
        : appAtomRegistry.get(serverEnvironment.configValueAtom(thread.environmentId));
    if (
      threadServerConfig?.environment.capabilities.threadSettlement !== true ||
      settlementPendingThreadId !== null
    )
      return;
    const wasSettled = thread.settledOverride === "settled";
    const threadRef = scopeThreadRef(thread.environmentId, thread.id);
    setSettlementPendingThreadId(thread.id);
    return (async () => {
      const result = wasSettled ? await unsettleThread(threadRef) : await settleThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: wasSettled ? "Failed to un-settle thread" : "Failed to settle thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })().finally(() => {
      setSettlementPendingThreadId((current) => (current === thread.id ? null : current));
    });
  };
  return { supportsSettlement, settlementPendingThreadId, toggleThreadSettlement };
}
