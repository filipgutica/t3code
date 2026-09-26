import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  WorkbenchJiraBinding,
  WorkbenchJiraLocalTicketMigrationItem,
  WorkbenchJiraLocalEpicMigrationItem,
  WorkbenchJiraMigrateLocalTicketsResult,
} from "@t3tools/contracts";
import type { RefObject } from "react";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { failureMessage } from "./workbenchPageCommands";

export function useWorkbenchJiraMigration({
  environmentId,
  statusEnvironmentRef,
  setJiraPendingAction,
  setJiraError,
  refreshJiraSnapshot,
  refreshWorkbenchSnapshot,
}: {
  environmentId: EnvironmentId | null;
  statusEnvironmentRef: RefObject<EnvironmentId | null>;
  setJiraPendingAction: (action: string | null) => void;
  setJiraError: (message: string | null) => void;
  refreshJiraSnapshot: () => unknown;
  refreshWorkbenchSnapshot: () => unknown;
}) {
  const jiraReadSnapshot = useAtomCommand(workbenchEnvironment.jiraReadSnapshot, {
    reportFailure: false,
  });
  const jiraMigrateLocalTickets = useAtomCommand(workbenchEnvironment.jiraMigrateLocalTickets, {
    reportFailure: false,
  });
  async function wasJiraMigrationCommitted(binding: WorkbenchJiraBinding): Promise<boolean> {
    if (environmentId === null || binding.localMigrationPending !== true) return false;
    const result = await jiraReadSnapshot({ environmentId, input: {} });
    if (statusEnvironmentRef.current !== environmentId || result._tag !== "Success") return false;
    const saved = result.value.bindings.find((candidate) => candidate.id === binding.id);
    // Only the server can clear this gate. Preserve the original migration
    // error unless this fresh response confirms it already committed.
    return saved !== undefined && saved.localMigrationPending !== true;
  }

  async function migrateJiraLocalData({
    binding,
    action,
    tickets,
    epics,
  }: {
    readonly binding: WorkbenchJiraBinding;
    readonly action: "publish" | "delete" | "none";
    readonly tickets: ReadonlyArray<WorkbenchJiraLocalTicketMigrationItem>;
    readonly epics: ReadonlyArray<WorkbenchJiraLocalEpicMigrationItem>;
  }): Promise<WorkbenchJiraMigrateLocalTicketsResult | null> {
    if (environmentId === null || action === "none") return null;
    const targetEnvironmentId = environmentId;
    setJiraPendingAction("migrate-local");
    setJiraError(null);
    try {
      const result = await jiraMigrateLocalTickets({
        environmentId: targetEnvironmentId,
        input: {
          bindingId: binding.id,
          action,
          tickets,
          ...(epics.length > 0 ? { epics } : {}),
        },
      });
      if (statusEnvironmentRef.current !== targetEnvironmentId) return null;
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return null;
        setJiraError(failureMessage(result));
        return null;
      }
      await Promise.all([refreshJiraSnapshot(), refreshWorkbenchSnapshot()]);
      return result.value;
    } catch (cause) {
      if (statusEnvironmentRef.current !== targetEnvironmentId) return null;
      setJiraError(
        cause instanceof Error && cause.message.trim().length > 0
          ? cause.message
          : "Local Jira migration failed.",
      );
      return null;
    } finally {
      if (statusEnvironmentRef.current === targetEnvironmentId) setJiraPendingAction(null);
    }
  }

  return { wasJiraMigrationCommitted, migrateJiraLocalData };
}
