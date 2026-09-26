import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  WorkbenchProjectId,
  WorkbenchJiraBindingId,
  WorkbenchJiraBinding,
  WorkbenchJiraSyncResult,
} from "@t3tools/contracts";
import type { RefObject } from "react";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { failureMessage } from "./workbenchPageCommands";
export type WorkbenchJiraSyncNotice = {
  readonly environmentId: EnvironmentId;
  readonly projectId: WorkbenchProjectId;
  readonly bindingId: WorkbenchJiraBindingId;
  readonly state: "syncing" | "success" | "empty" | "error";
  readonly message: string;
};

export function useWorkbenchJiraSync({
  environmentId,
  statusEnvironmentRef,
  setJiraPendingAction,
  setJiraError,
  refreshJiraSnapshot,
  refreshWorkbenchSnapshot,
  setJiraSyncNotice,
}: {
  environmentId: EnvironmentId | null;
  statusEnvironmentRef: RefObject<EnvironmentId | null>;
  setJiraPendingAction: (action: string | null) => void;
  setJiraError: (message: string | null) => void;
  refreshJiraSnapshot: () => unknown;
  refreshWorkbenchSnapshot: () => unknown;
  setJiraSyncNotice: (notice: WorkbenchJiraSyncNotice) => void;
}) {
  const jiraSyncBinding = useAtomCommand(workbenchEnvironment.jiraSyncBinding, {
    reportFailure: false,
  });
  async function syncJiraBinding(
    binding: WorkbenchJiraBinding,
  ): Promise<WorkbenchJiraSyncResult | null> {
    if (environmentId === null) return null;
    const targetEnvironmentId = environmentId;
    setJiraPendingAction("sync");
    setJiraError(null);
    setJiraSyncNotice({
      environmentId: targetEnvironmentId,
      projectId: binding.projectId,
      bindingId: binding.id,
      state: "syncing",
      message: "Syncing tickets from Jira…",
    });
    try {
      const result = await jiraSyncBinding({
        environmentId: targetEnvironmentId,
        input: { bindingId: binding.id },
      });
      if (statusEnvironmentRef.current !== targetEnvironmentId) return null;
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return null;
        const message = failureMessage(result);
        setJiraError(message);
        setJiraSyncNotice({
          environmentId: targetEnvironmentId,
          projectId: binding.projectId,
          bindingId: binding.id,
          state: "error",
          message,
        });
        await refreshJiraSnapshot();
        return null;
      }
      setJiraSyncNotice(
        jiraSyncSuccessNotice({ result: result.value, targetEnvironmentId, binding }),
      );
      await Promise.all([refreshJiraSnapshot(), refreshWorkbenchSnapshot()]);
      return result.value;
    } catch (cause) {
      if (statusEnvironmentRef.current !== targetEnvironmentId) return null;
      const message =
        cause instanceof Error && cause.message.trim().length > 0
          ? cause.message
          : "Jira synchronization failed.";
      setJiraError(message);
      setJiraSyncNotice({
        environmentId: targetEnvironmentId,
        projectId: binding.projectId,
        bindingId: binding.id,
        state: "error",
        message,
      });
      return null;
    } finally {
      if (statusEnvironmentRef.current === targetEnvironmentId) setJiraPendingAction(null);
    }
  }

  return { jiraSyncBinding, syncJiraBinding };
}

function jiraSyncSuccessNotice({
  result,
  targetEnvironmentId,
  binding,
}: {
  result: WorkbenchJiraSyncResult;
  targetEnvironmentId: EnvironmentId;
  binding: WorkbenchJiraBinding;
}): WorkbenchJiraSyncNotice {
  const activeLinks = result.links.filter((link) => link.active);
  const message =
    activeLinks.length === 0
      ? "No Jira issues are assigned to you in this sprint."
      : `Synced ${activeLinks.length} Jira ${activeLinks.length === 1 ? "ticket" : "tickets"}.`;
  return {
    environmentId: targetEnvironmentId,
    projectId: binding.projectId,
    bindingId: binding.id,
    state: activeLinks.length === 0 ? "empty" : "success",
    message,
  };
}
