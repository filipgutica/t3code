import { resolveEnvironmentMachineKind, type EnvironmentId } from "@t3tools/contracts";

import { useEnvironments } from "../state/environments";

/** A machine's name and icon kind for Workbench machine pickers and labels. */
export function useWorkbenchMachineOf(boardEnvironmentId: EnvironmentId | null | undefined) {
  const { environments } = useEnvironments();
  return (id: EnvironmentId | null | undefined) => {
    const environment = environments.find((candidate) => candidate.environmentId === id);
    return {
      label: environment?.label ?? (id === boardEnvironmentId ? "This machine" : "Another machine"),
      kind: resolveEnvironmentMachineKind(environment?.serverConfig ?? null),
    };
  };
}
