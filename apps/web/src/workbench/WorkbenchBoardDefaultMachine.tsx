import { ChevronDownIcon } from "lucide-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { resolveEnvironmentMachineKind, type EnvironmentId } from "@t3tools/contracts";

import { ComposerSelectControl } from "../components/chat/ComposerControl";
import { ComposerContextLabel } from "../components/ComposerContextLabel";
import { EnvironmentMachineIcon } from "../components/EnvironmentMachineIcon";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
} from "../components/ui/select";
import { useEnvironments } from "../state/environments";

const AUTOMATIC = "automatic";

/**
 * Where new Threads start when a Board's repositories are checked out on several machines.
 * Styled like the composer's Run on picker.
 */
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
  // A saved default stays visible so it can be reset to Automatic.
  if (machineIds.length < 2 && value === undefined) return null;
  const machineOf = (id: EnvironmentId | null | undefined) => {
    const environment = environments.find((candidate) => candidate.environmentId === id);
    return {
      label: environment?.label ?? (id === environmentId ? "This machine" : "Another machine"),
      kind: resolveEnvironmentMachineKind(environment?.serverConfig ?? null),
    };
  };
  const selected = machineOf(value ?? environmentId);
  return (
    <div className="space-y-1.5">
      <Label htmlFor="workbench-default-machine">Default machine</Label>
      <Select
        modal={false}
        value={value ?? AUTOMATIC}
        disabled={pending}
        onValueChange={(next) => {
          if (next) onChange(next === AUTOMATIC ? undefined : (next as EnvironmentId));
        }}
      >
        <ComposerSelectControl
          id="workbench-default-machine"
          size="xs"
          className="min-w-0 max-w-full"
        >
          <EnvironmentMachineIcon kind={selected.kind} className="size-3 shrink-0" />
          <ComposerContextLabel>
            {value === undefined ? "Automatic" : selected.label}
          </ComposerContextLabel>
          <ChevronDownIcon data-composer-control-chevron aria-hidden />
        </ComposerSelectControl>
        <SelectPopup alignItemWithTrigger={false}>
          <SelectGroup>
            <SelectGroupLabel>Run on</SelectGroupLabel>
            {[AUTOMATIC, ...machineIds].map((id) => {
              const machine = machineOf(id === AUTOMATIC ? environmentId : (id as EnvironmentId));
              return (
                <SelectItem key={id} value={id}>
                  <span className="inline-flex items-center gap-1.5">
                    <EnvironmentMachineIcon kind={machine.kind} className="size-3" />
                    {id === AUTOMATIC ? "Automatic" : machine.label}
                  </span>
                </SelectItem>
              );
            })}
          </SelectGroup>
        </SelectPopup>
      </Select>
      <p className="text-xs text-muted-foreground">
        New Threads start on this machine when it has the Ticket's repositories. Automatic prefers
        the Board's machine. Ticket worktrees are always prepared on the Board's machine.
      </p>
    </div>
  );
}
