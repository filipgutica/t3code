import type { UnarchiveThreadInput } from "@t3tools/client-runtime/operations";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

interface OpenWorkbenchAssignedThreadInput {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly archived: boolean;
}

interface OpenWorkbenchAssignedThreadDependencies {
  readonly unarchive: (input: {
    readonly environmentId: EnvironmentId;
    readonly input: UnarchiveThreadInput;
  }) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly refreshArchived: () => void;
  readonly navigate: () => Promise<void>;
}

export async function openWorkbenchAssignedThread(
  input: OpenWorkbenchAssignedThreadInput,
  dependencies: OpenWorkbenchAssignedThreadDependencies,
) {
  if (input.archived) {
    const result = await dependencies.unarchive({
      environmentId: input.environmentId,
      input: { threadId: input.threadId },
    });
    if (result._tag === "Failure") {
      return { state: "restore-failed", failure: result } as const;
    }
    dependencies.refreshArchived();
  }

  try {
    await dependencies.navigate();
  } catch (cause) {
    return { state: "navigation-failed", cause } as const;
  }
  return { state: "opened" } as const;
}
