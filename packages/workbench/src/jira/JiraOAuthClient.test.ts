import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as JiraOAuthClient from "./JiraOAuthClient.ts";

const startBroker = (authorizationUrl: string) =>
  Effect.gen(function* () {
    const client = yield* JiraOAuthClient.JiraOAuthClient;
    assert.ok(client.startBroker);
    return yield* client.startBroker({
      brokerUrl: "https://broker.example",
      claimChallenge: "challenge",
    });
  }).pipe(
    Effect.provide(JiraOAuthClient.layer),
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({
              sessionId: "session",
              authorizationUrl,
              expiresAt: "2026-10-17T00:00:00Z",
            }),
          ),
        ),
      ),
    ),
  );

describe("Jira OAuth broker authorization URL", () => {
  it.effect("accepts Atlassian authorization queries", () =>
    Effect.gen(function* () {
      const url = "https://auth.atlassian.com/authorize?client_id=id&state=broker-state";
      assert.strictEqual((yield* startBroker(url)).authorizationUrl, url);
    }),
  );
  it.effect("rejects other schemes, origins, paths and embedded credentials", () =>
    Effect.gen(function* () {
      for (const url of [
        "javascript:alert(1)",
        "http://auth.atlassian.com/authorize",
        "https://auth.atlassian.com.evil.example/authorize",
        "https://auth.atlassian.com/other",
        "https://auth.atlassian.com/authorize/",
        "https://user:pass@auth.atlassian.com/authorize",
        "https://auth.atlassian.com:444/authorize",
        "not a URL",
      ]) {
        const error = yield* Effect.flip(startBroker(url));
        assert.strictEqual(error.code, "oauth_exchange_failed");
        assert.isFalse(error.message.includes(url));
      }
    }),
  );
});

describe("Jira OAuth deadlines", () => {
  it.effect("bounds direct and broker requests including response body consumption", () =>
    Effect.gen(function* () {
      for (const broker of [false, true]) {
        for (const body of [false, true]) {
          const started = yield* Deferred.make<void>();
          const completed = yield* Deferred.make<void>();
          const client = yield* JiraOAuthClient.JiraOAuthClient.pipe(
            Effect.provide(JiraOAuthClient.layer),
            Effect.provideService(
              HttpClient.HttpClient,
              HttpClient.make((request) =>
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(
                    body
                      ? Effect.succeed(
                          HttpClientResponse.fromWeb(
                            request,
                            new Response(new ReadableStream({ pull() {} })),
                          ),
                        )
                      : Effect.never,
                  ),
                ),
              ),
            ),
          );
          assert.ok(client.startBroker);
          const operation = broker
            ? client
                .startBroker({ brokerUrl: "https://broker.example", claimChallenge: "challenge" })
                .pipe(Effect.asVoid)
            : client
                .refresh({
                  clientId: "id",
                  clientSecret: "secret",
                  refreshToken: "refresh",
                  previousScope: "",
                  nowEpochMs: 0,
                })
                .pipe(Effect.asVoid);
          const fiber = yield* operation.pipe(
            Effect.flip,
            Effect.tap((error) =>
              Effect.sync(() => assert.strictEqual(error.code, "oauth_exchange_failed")),
            ),
            Effect.andThen(Deferred.succeed(completed, undefined)),
            Effect.forkChild,
          );
          yield* Deferred.await(started);
          yield* TestClock.adjust("30 seconds");
          assert.isTrue(
            yield* Deferred.isDone(completed),
            `${broker ? "broker" : "direct"} ${body ? "body" : "request"} deadline`,
          );
          yield* Fiber.join(fiber);
        }
      }
    }),
  );
});
