import { connectionRoutes, routeHttpBaseUrl } from "@t3tools/client-runtime/connection";
import { fetchRemoteEnvironmentDescriptor } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { relayEnvironmentDiscovery } from "../state/relay";

class WorkbenchDescriptorMismatch extends Data.TaggedError("WorkbenchDescriptorMismatch")<{
  readonly message: string;
}> {}

/** Incompatible hosts do not deliver a server config. Read their public descriptor instead. */
export const workbenchOutdatedServerDescriptor = Atom.family((environmentId: EnvironmentId) =>
  connectionAtomRuntime.atom((get) => {
    const entry = get(environmentCatalog.catalogValueAtom).entries.get(environmentId);
    if (!entry) return Effect.succeed(null);
    const relay = Option.getOrNull(
      get(relayEnvironmentDiscovery.stateValueAtom).environments.get(environmentId)?.status ??
        Option.none(),
    )?.descriptor;
    const urls = [
      ...new Set(connectionRoutes(entry).flatMap((route) => routeHttpBaseUrl(route) ?? [])),
    ];
    const reads = urls.map((httpBaseUrl) =>
      fetchRemoteEnvironmentDescriptor({ httpBaseUrl }).pipe(
        Effect.filterOrFail(
          (descriptor) => descriptor.environmentId === environmentId,
          () =>
            new WorkbenchDescriptorMismatch({
              message: "The saved route belongs to another environment.",
            }),
        ),
      ),
    );
    if (relay?.environmentId === environmentId) reads.push(Effect.succeed(relay));
    return reads.length === 0 ? Effect.succeed(null) : Effect.firstSuccessOf(reads);
  }),
);
