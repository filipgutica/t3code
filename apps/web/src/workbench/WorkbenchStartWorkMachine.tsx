import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type WorkbenchProject,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import { useId, useState } from "react";

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
import {
  chooseWorkbenchThreadMachine,
  getWorkbenchThreadMachines,
} from "./workbenchRemoteProjects";

type StartWorkMachineInput = {
  readonly environmentId: EnvironmentId;
  readonly board: Pick<
    WorkbenchProject,
    "remoteProjects" | "repositoryKeys" | "defaultEnvironmentId"
  >;
  /** Null until the draft is a saved Ticket. */
  readonly ticket: WorkbenchTicket | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
};

const resolveStartWorkMachine = ({
  environmentId,
  board,
  ticket,
  projects,
  picked,
}: StartWorkMachineInput & { readonly picked: EnvironmentId | undefined }) => {
  if (ticket === null) return null;
  const machines = getWorkbenchThreadMachines({
    board,
    boardEnvironmentId: environmentId,
    repositoryProjectIds: ticket.repositoryProjectIds,
    projects,
  });
  const machine = chooseWorkbenchThreadMachine({
    machines,
    picked,
    defaultEnvironmentId: board.defaultEnvironmentId,
    boardEnvironmentId: environmentId,
    scopeEnvironmentId: undefined,
  });
  // Like Create Thread, a picked machine that lost a repository or disconnected blocks Start
  // work instead of quietly continuing on the Board's machine.
  const unavailable = picked !== undefined && machine === undefined;
  if (machines.length < 2 && !unavailable) return null;
  const value = unavailable ? picked : (machine?.environmentId ?? environmentId);
  const environmentIds = machines.map((candidate) => candidate.environmentId);
  return {
    boardEnvironmentId: environmentId,
    environmentIds: unavailable ? [...environmentIds, picked] : environmentIds,
    value,
    unavailable,
    // Start work then opens Create Thread there; the planning Thread stays on the Board's machine.
    elsewhere: value !== environmentId,
  };
};

/**
 * Where Start work runs a saved Ticket's work, offered only when its repositories are on several
 * machines. Like Create Thread, the default follows the Board's Default machine.
 */
export function useWorkbenchStartWorkMachine({
  onStartWorkOn,
  ...input
}: StartWorkMachineInput & {
  /** Opens Create Thread on another machine after Start work prepared the Ticket. */
  readonly onStartWorkOn: (ticket: WorkbenchTicket, threadEnvironmentId: EnvironmentId) => void;
}) {
  const [picked, setPicked] = useState<EnvironmentId>();
  const choice = resolveStartWorkMachine({ ...input, picked });
  return {
    runOn: choice && { ...choice, onChange: setPicked },
    onWorkStarted: () => {
      if (input.ticket && choice?.elsewhere) onStartWorkOn(input.ticket, choice.value);
    },
  };
}

export type WorkbenchStartWorkMachineChoice = NonNullable<
  ReturnType<typeof useWorkbenchStartWorkMachine>["runOn"]
>;

/** The Run on picker for Start work and Create Thread, styled like the composer's. */
export function WorkbenchRunOnPicker({
  boardEnvironmentId,
  environmentIds,
  value,
  onChange,
  disabled,
}: Pick<WorkbenchStartWorkMachineChoice, "boardEnvironmentId" | "environmentIds" | "value"> & {
  readonly onChange: (environmentId: EnvironmentId) => void;
  readonly disabled: boolean;
}) {
  const { environments } = useEnvironments();
  // The Board chat and the Ticket page can both show Start work.
  const triggerId = useId();
  const machineOf = (id: EnvironmentId) => {
    const environment = environments.find((candidate) => candidate.environmentId === id);
    return {
      label: environment?.label ?? (id === boardEnvironmentId ? "This machine" : "Another machine"),
      kind: resolveEnvironmentMachineKind(environment?.serverConfig ?? null),
    };
  };
  const selected = machineOf(value);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Label htmlFor={triggerId}>Run on</Label>
      <Select
        modal={false}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next) onChange(next);
        }}
      >
        <ComposerSelectControl id={triggerId} size="xs" className="min-w-0 max-w-full">
          <EnvironmentMachineIcon kind={selected.kind} className="size-3 shrink-0" />
          <ComposerContextLabel>{selected.label}</ComposerContextLabel>
        </ComposerSelectControl>
        <SelectPopup alignItemWithTrigger={false}>
          <SelectGroup>
            <SelectGroupLabel>Run on</SelectGroupLabel>
            {environmentIds.map((id) => {
              const machine = machineOf(id);
              return (
                <SelectItem key={id} value={id}>
                  <span className="inline-flex items-center gap-1.5">
                    <EnvironmentMachineIcon kind={machine.kind} className="size-3" />
                    {machine.label}
                  </span>
                </SelectItem>
              );
            })}
          </SelectGroup>
        </SelectPopup>
      </Select>
    </div>
  );
}
