import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as JiraCredentialStore from "./JiraCredentialStore.ts";

const makeHarness = () => {
  const values = new Map<string, Uint8Array>();
  const store = ServerSecretStore.ServerSecretStore.of({
    get: (name) => Effect.succeed(Option.fromNullishOr(values.get(name))),
    set: (name, value) =>
      Effect.sync(() => {
        values.set(name, value);
      }),
    create: (name, value) =>
      Effect.sync(() => {
        values.set(name, value);
      }),
    getOrCreateRandom: () => Effect.die("unexpected random secret"),
    remove: (name) =>
      Effect.sync(() => {
        values.delete(name);
      }),
  });
  return { values, store };
};

describe("JiraCredentialStore server adapter", () => {
  it.effect("round-trips credentials and pending authorization using stable secret keys", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const store = yield* JiraCredentialStore.JiraCredentialStore;
      const credential = {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        scope: "read:jira-work",
        expiresAtEpochMs: 1_234,
      } satisfies JiraCredentialStore.JiraOAuthCredential;
      const pending = {
        redirectUri: "http://localhost/oauth/workbench/jira/callback",
        expiresAtEpochMs: 5_678,
      } satisfies JiraCredentialStore.PendingJiraAuthorization;

      yield* store.setCredential("credential-1", credential);
      yield* store.setPendingAuthorization("oauth-state", pending);
      assert.deepStrictEqual(
        [...harness.values.keys()].sort(),
        ["workbench-jira-credential-credential-1", "workbench-jira-oauth-state-oauth-state"].sort(),
      );
      assert.deepStrictEqual(yield* store.getCredential("credential-1"), Option.some(credential));
      assert.deepStrictEqual(
        yield* store.getPendingAuthorization("oauth-state"),
        Option.some(pending),
      );

      yield* store.removeCredential("credential-1");
      yield* store.removePendingAuthorization("oauth-state");
      assert.isTrue(Option.isNone(yield* store.getCredential("credential-1")));
      assert.isTrue(Option.isNone(yield* store.getPendingAuthorization("oauth-state")));
    }).pipe(
      Effect.provide(JiraCredentialStore.layer),
      Effect.provideService(ServerSecretStore.ServerSecretStore, harness.store),
    );
  });

  it.effect("sanitizes malformed stored JSON", () => {
    const harness = makeHarness();
    harness.values.set(
      "workbench-jira-credential-credential-1",
      new TextEncoder().encode("not-json"),
    );
    return Effect.gen(function* () {
      const store = yield* JiraCredentialStore.JiraCredentialStore;
      const error = yield* Effect.flip(store.getCredential("credential-1"));
      assert.strictEqual(error.code, "persistence_failed");
      assert.strictEqual(error.message, "Stored Jira credentials are invalid.");
    }).pipe(
      Effect.provide(JiraCredentialStore.layer),
      Effect.provideService(ServerSecretStore.ServerSecretStore, harness.store),
    );
  });
});
