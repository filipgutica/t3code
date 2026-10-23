import {
  connectionRoutes,
  routeHttpBaseUrl,
  type ConnectionRoute,
} from "@t3tools/client-runtime/connection";
import { fetchRemoteEnvironmentDescriptor } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import type * as HttpClient from "effect/http/HttpClient";
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

class WorkbenchSshDescriptorError extends Data.TaggedError("WorkbenchSshDescriptorError")<{
  readonly message: string;
}> {}

class DescriptorLookup extends Data.Class<{
  readonly environmentId: EnvironmentId;
  readonly includeSsh: boolean;
}> {}

const readSshDescriptor = Effect.fn("WorkbenchOutdatedServerDescriptor.readSshDescriptor")(
  function* (route: ConnectionRoute) {
    const profile = Option.getOrNull(route.profile);
    const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
    if (profile?._tag !== "SshConnectionProfile" || !bridge) {
      return yield* new WorkbenchSshDescriptorError({
        message: "This SSH route requires the desktop app and a saved connection profile.",
      });
    }
    if (profile.environmentId !== route.target.environmentId) {
      return yield* new WorkbenchDescriptorMismatch({
        message: "The SSH profile belongs to another environment.",
      });
    }
    return yield* Effect.tryPromise({
      try: async () => {
        const bootstrap = await bridge.ensureSshEnvironment(profile.target, {
          issuePairingToken: false,
        });
        return bridge.fetchSshEnvironmentDescriptor(bootstrap.httpBaseUrl);
      },
      catch: (cause) =>
        new WorkbenchSshDescriptorError({
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    });
  },
);

/** Incompatible hosts do not deliver a server config. Read their public descriptor instead. */
const descriptors = Atom.family(({ environmentId, includeSsh }: DescriptorLookup) =>
  connectionAtomRuntime.atom((get) => {
    // SSH checks are explicit snapshots: unrelated state changes must not reopen authentication.
    const catalog = includeSsh
      ? get.once(environmentCatalog.catalogValueAtom)
      : get(environmentCatalog.catalogValueAtom);
    const discovery = includeSsh
      ? get.once(relayEnvironmentDiscovery.stateValueAtom)
      : get(relayEnvironmentDiscovery.stateValueAtom);
    const entry = catalog.entries.get(environmentId);
    if (!entry) return Effect.succeed(null);
    const relay = Option.getOrNull(
      discovery.environments.get(environmentId)?.status ?? Option.none(),
    )?.descriptor;
    const routes = connectionRoutes(entry);
    const urls = [...new Set(routes.flatMap((route) => routeHttpBaseUrl(route) ?? []))];
    const reads: Array<
      Effect.Effect<
        ExecutionEnvironmentDescriptor,
        | Effect.Error<ReturnType<typeof fetchRemoteEnvironmentDescriptor>>
        | WorkbenchDescriptorMismatch
        | WorkbenchSshDescriptorError,
        HttpClient.HttpClient
      >
    > = [
      ...urls.map((httpBaseUrl) => fetchRemoteEnvironmentDescriptor({ httpBaseUrl })),
      ...(relay?.environmentId === environmentId ? [Effect.succeed(relay)] : []),
      ...(includeSsh
        ? routes
            .filter((route) => route.target._tag === "SshConnectionTarget")
            .map(readSshDescriptor)
        : []),
    ];
    return reads.length === 0
      ? Effect.succeed(null)
      : Effect.firstSuccessOf(
          reads.map((read) =>
            read.pipe(
              Effect.filterOrFail(
                (descriptor) => descriptor.environmentId === environmentId,
                () =>
                  new WorkbenchDescriptorMismatch({
                    message: "The saved route belongs to another environment.",
                  }),
              ),
            ),
          ),
        );
  }),
);

export const workbenchOutdatedServerDescriptor = (
  environmentId: EnvironmentId,
  includeSsh = false,
) => descriptors(new DescriptorLookup({ environmentId, includeSsh }));
