import type { ProviderAdapterV2RuntimePolicy } from "@t3tools/provider-core/server/ProviderAdapter";
import type * as CodexClient from "effect-codex-app-server/client";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const isReadOnlySandbox = Schema.is(Schema.Struct({ type: Schema.Literal("readOnly") }));
const decodeServers = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Json));

/** Called after native initialization, using the policy of this request rather than the session. */
export const prepareCodexThreadRuntimeParams = Effect.fn(
  "CodexSandboxPolicy.prepareCodexThreadRuntimeParams",
)(
  <Params extends { readonly config: Readonly<Record<string, Schema.Json>> }>({
    client,
    runtimePolicy,
    params,
  }: {
    readonly client: Pick<CodexClient.CodexAppServerClient["Service"], "request">;
    readonly runtimePolicy: ProviderAdapterV2RuntimePolicy | undefined;
    readonly params: Params;
  }) =>
    Effect.gen(function* () {
      if (!isReadOnlySandbox(runtimePolicy?.sandboxPolicy)) return params;
      const lifecycleRestrictions = {
        "features.hooks": false,
        "features.codex_hooks": false,
        "features.plugin_hooks": false,
        "features.multi_agent": false,
      };
      if (runtimePolicy?.toolAccess === "research") {
        return { ...params, config: { ...params.config, ...lifecycleRestrictions } };
      }
      // MCP tools and lifecycle hooks execute outside the filesystem sandbox.
      // Inventory failures must stop the operation, not fall back to inherited tools.
      const response = yield* client.request("config/read", {
        includeLayers: false,
        ...(runtimePolicy?.cwd == null ? {} : { cwd: runtimePolicy.cwd }),
      });
      const inherited = yield* decodeServers(response.config.mcp_servers ?? {});
      const native = yield* decodeServers(params.config.mcp_servers ?? {});
      // Native Codex now emits its owned server as a dotted override. Fold only
      // that entry into this branch's isolated map so inherited settings cannot conflict.
      const { "mcp_servers.t3-code": ownedT3Server, ...config } = params.config;
      return {
        ...params,
        config: {
          ...config,
          ...lifecycleRestrictions,
          "features.plugins": false,
          "features.apps": false,
          "features.connectors": false,
          mcp_servers: {
            ...Object.fromEntries(Object.keys(inherited).map((name) => [name, { enabled: false }])),
            ...native,
            ...(ownedT3Server === undefined ? {} : { "t3-code": ownedT3Server }),
          },
        },
      };
    }),
);
