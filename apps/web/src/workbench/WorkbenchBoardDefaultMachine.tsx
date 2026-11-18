import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";

import { Label } from "../components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useEnvironments } from "../state/environments";

const AUTOMATIC = "automatic";

/** Where new Threads start when a Board's repositories are checked out on several machines. */
export function WorkbenchBoardDefaultMachine({
  environmentId,
  projects,
  value,
  pending,
  onChange,
}: {
  readonly environmentId: EnvironmentId | null | undefined;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly value: EnvironmentId | undefined;
  readonly pending: boolean;
  readonly onChange: (environmentId: EnvironmentId | undefined) => void;
}) {
  const { environments } = useEnvironments();
  const machineIds = [
    ...new Set([
      ...projects.flatMap((project) =>
        project.workspaceRoot === "" ? [] : [project.environmentId],
      ),
      ...(value === undefined ? [] : [value]),
    ]),
  ];
  if (machineIds.length < 2) return null;
  const labelOf = (id: EnvironmentId) =>
    id === environmentId
      ? "This machine"
      : (environments.find((environment) => environment.environmentId === id)?.label ??
        "Another machine");
  return (
    <div className="space-y-1.5">
      <Label htmlFor="workbench-default-machine">Default machine</Label>
      <Select
        value={value ?? AUTOMATIC}
        disabled={pending}
        onValueChange={(next) => {
          if (next) onChange(next === AUTOMATIC ? undefined : (next as EnvironmentId));
        }}
      >
        <SelectTrigger id="workbench-default-machine" size="sm" className="max-w-72">
          <SelectValue>{value === undefined ? "Automatic" : labelOf(value)}</SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          <SelectItem value={AUTOMATIC}>Automatic</SelectItem>
          {machineIds.map((id) => (
            <SelectItem key={id} value={id}>
              {labelOf(id)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <p className="text-xs text-muted-foreground">
        New Threads start on this machine when it has the Ticket's repositories. Automatic uses the
        Board's machine. Ticket worktrees are always prepared on the Board's machine.
      </p>
    </div>
  );
}
