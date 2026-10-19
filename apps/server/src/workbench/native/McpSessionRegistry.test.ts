import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as McpSessionRegistry from "../../mcp/McpSessionRegistry.ts";

const fakeHttpServer = HttpServer.HttpServer.of({
  address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 43123),
  serve: (() => Effect.void) as HttpServer.HttpServer["Service"]["serve"],
});
const fakeEnvironment = ServerEnvironment.ServerEnvironment.of({
  getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-1")),
  getDescriptor: Effect.die("unused"),
});

const makeRegistry = (now: () => number) =>
  McpSessionRegistry.__testing
    .make({ now, livenessWindowMs: 100 })
    .pipe(
      Effect.provideService(HttpServer.HttpServer, fakeHttpServer),
      Effect.provideService(ServerEnvironment.ServerEnvironment, fakeEnvironment),
      Effect.provide(NodeServices.layer),
    );

it.effect("retains the read-only ceiling on a provider credential until revocation", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(() => 1_000);
    const threadId = ThreadId.make("readonly-planning");
    const issued = yield* registry.issue({
      threadId,
      providerInstanceId: ProviderInstanceId.make("codex"),
      readOnly: true,
    });
    const token = issued.config.authorizationHeader.replace(/^Bearer\s+/, "");
    expect((yield* registry.resolve(token))?.thread.readOnly).toBe(true);
    yield* registry.touch(threadId);
    expect((yield* registry.resolve(token))?.thread.readOnly).toBe(true);
    yield* registry.revokeThread(threadId);
    expect(yield* registry.resolve(token)).toBeUndefined();
  }),
);
