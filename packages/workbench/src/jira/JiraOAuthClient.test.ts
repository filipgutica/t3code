import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
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
