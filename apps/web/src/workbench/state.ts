import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { connectionAtomRuntime } from "../connection/runtime";

const snapshot = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:workbench:snapshot",
  tag: WS_METHODS.workbenchGetSnapshot,
  staleTimeMs: 5_000,
});

const scheduler = createAtomCommandScheduler();
const serialPerEnvironment = {
  mode: "serial",
  key: ({ environmentId }: { readonly environmentId: EnvironmentId }) => environmentId,
} as const;

const refreshSnapshot = (
  { environmentId }: { readonly environmentId: EnvironmentId },
  registry: AtomRegistry.AtomRegistry,
) =>
  Effect.sync(() =>
    registry.refresh(
      snapshot({
        environmentId,
        input: {},
      }),
    ),
  );

export const workbenchEnvironment = {
  snapshot,
  createProject: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:create-project",
    tag: WS_METHODS.workbenchCreateProject,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  createTicket: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:create-ticket",
    tag: WS_METHODS.workbenchCreateTicket,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  updateTicket: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:update-ticket",
    tag: WS_METHODS.workbenchUpdateTicket,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  createAssignment: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:create-assignment",
    tag: WS_METHODS.workbenchCreateAssignment,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
  replaceAssignment: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:workbench:replace-assignment",
    tag: WS_METHODS.workbenchReplaceAssignment,
    scheduler,
    concurrency: serialPerEnvironment,
    onSuccess: refreshSnapshot,
  }),
};
