import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  WorkbenchJiraConnectionId,
  WorkbenchJiraOperationError,
  type WorkbenchJiraConnection,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as JiraAuthService from "./JiraAuthService.ts";
import {
  JiraCredentialStore,
  type JiraOAuthCredential,
  type PendingJiraAuthorization,
} from "./JiraCredentialStore.ts";
import { JiraOAuthClient, JIRA_OAUTH_SCOPES } from "./JiraOAuthClient.ts";
import {
  WorkbenchJiraRepository,
  WorkbenchJiraRepositoryError,
  type WorkbenchJiraRepositoryShape,
} from "./WorkbenchJiraRepository.ts";

const repositoryHarness = () => {
  const connections = new Map<string, WorkbenchJiraConnection>();
  const credentialIds = new Map<string, string>();
  const service = WorkbenchJiraRepository.of({
    findConnectionByCloudId: (cloudId) =>
      Effect.succeed(
        Option.fromNullishOr(
          Array.from(connections.values()).find((connection) => connection.cloudId === cloudId),
        ),
      ),
    getConnection: (id) => Effect.succeed(Option.fromNullishOr(connections.get(id))),
    listConnections: () => Effect.succeed(Array.from(connections.values())),
    getCredentialId: (id) => Effect.succeed(Option.fromNullishOr(credentialIds.get(id))),
    upsertConnection: (connection, credentialId) =>
      Effect.sync(() => {
        connections.set(connection.id, connection);
        credentialIds.set(connection.id, credentialId);
      }),
    upsertConnections: (nextConnections, credentialId) =>
      Effect.sync(() => {
        for (const connection of nextConnections) {
          connections.set(connection.id, connection);
          credentialIds.set(connection.id, credentialId);
        }
      }),
    getBinding: () => Effect.succeed(Option.none()),
    listBindings: () => Effect.succeed([]),
    upsertBinding: () => Effect.void,
    updateBindingSyncMetadata: () => Effect.succeed(true),
    listIssueLinks: () => Effect.succeed([]),
    replaceIssueLinks: () => Effect.void,
  } satisfies WorkbenchJiraRepositoryShape);
  return { connections, credentialIds, service };
};

const credentialHarness = () => {
  const pending = new Map<string, PendingJiraAuthorization>();
  const credentials = new Map<string, JiraOAuthCredential>();
  const service = JiraCredentialStore.of({
    getCredential: (id) => Effect.succeed(Option.fromNullishOr(credentials.get(id))),
    setCredential: (id, credential) =>
      Effect.sync(() => {
        credentials.set(id, credential);
      }),
    removeCredential: (id) =>
      Effect.sync(() => {
        credentials.delete(id);
      }),
    getPendingAuthorization: (state) => Effect.succeed(Option.fromNullishOr(pending.get(state))),
    setPendingAuthorization: (state, authorization) =>
      Effect.sync(() => {
        pending.set(state, authorization);
      }),
    removePendingAuthorization: (state) =>
      Effect.sync(() => {
        pending.delete(state);
      }),
  });
  return { pending, credentials, service };
};

describe("JiraAuthService", () => {
  it.layer(NodeServices.layer)("begins and completes a one-time Jira 3LO authorization", (it) => {
    it.effect("explains how to configure the Atlassian OAuth app", () =>
      Effect.gen(function* () {
        const repository = repositoryHarness();
        const credentialStore = credentialHarness();
        const oauth = JiraOAuthClient.of({
          exchangeCode: () => Effect.die("unexpected exchange"),
          refresh: () => Effect.die("unexpected refresh"),
          listAccessibleSites: () => Effect.die("unexpected site lookup"),
        });
        const service = yield* JiraAuthService.make.pipe(
          Effect.provideService(WorkbenchJiraRepository, repository.service),
          Effect.provideService(JiraCredentialStore, credentialStore.service),
          Effect.provideService(JiraOAuthClient, oauth),
          Effect.provideService(HostProcessEnvironment, {}),
        );

        const error = yield* service
          .begin({ redirectUri: "http://localhost/oauth/jira" })
          .pipe(Effect.flip);
        assert.strictEqual(error.code, "not_configured");
        assert.isTrue(error.message.includes("Atlassian OAuth app"));
        assert.isTrue(error.message.includes("callback URL"));
        assert.isTrue(error.message.includes("restart the T3 server"));
      }),
    );

    it.effect("stores the token outside public connection metadata", () =>
      Effect.gen(function* () {
        const repository = repositoryHarness();
        const credentialStore = credentialHarness();
        const oauth = JiraOAuthClient.of({
          exchangeCode: () =>
            Effect.succeed({
              accessToken: "access-token",
              refreshToken: "refresh-token",
              scope: JIRA_OAUTH_SCOPES.join(" "),
              expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
            }),
          refresh: () => Effect.die("unexpected refresh"),
          listAccessibleSites: () =>
            Effect.succeed([
              {
                cloudId: "cloud-1",
                name: "Example Jira",
                url: "https://example.atlassian.net",
                avatarUrl: null,
                scopes: [...JIRA_OAUTH_SCOPES],
              },
            ]),
        });
        const service = yield* JiraAuthService.make.pipe(
          Effect.provideService(WorkbenchJiraRepository, repository.service),
          Effect.provideService(JiraCredentialStore, credentialStore.service),
          Effect.provideService(JiraOAuthClient, oauth),
          Effect.provideService(HostProcessEnvironment, {
            T3_WORKBENCH_JIRA_CLIENT_ID: "client-id",
            T3_WORKBENCH_JIRA_CLIENT_SECRET: "client-secret",
          }),
        );

        const started = yield* service.begin({ redirectUri: "http://localhost/oauth/jira" });
        const authorizationUrl = new URL(started.authorizationUrl);
        assert.strictEqual(authorizationUrl.searchParams.get("state"), started.state);
        assert.deepStrictEqual(authorizationUrl.searchParams.get("scope")?.split(" "), [
          ...JIRA_OAUTH_SCOPES,
        ]);
        assert.isTrue(
          authorizationUrl.searchParams.get("scope")?.split(" ").includes("read:jira-work") ??
            false,
        );
        assert.isTrue(credentialStore.pending.has(started.state));

        const completed = yield* service.complete({
          code: "authorization-code",
          state: started.state,
          redirectUri: "http://localhost/oauth/jira",
        });
        const connection = completed.connections[0];
        assert.ok(connection);
        assert.strictEqual(connection.cloudId, "cloud-1");
        assert.isFalse("accessToken" in connection);
        assert.strictEqual(repository.connections.get(connection.id)?.siteName, "Example Jira");
        const credentialId = repository.credentialIds.get(connection.id);
        assert.ok(credentialId);
        assert.strictEqual(
          credentialStore.credentials.get(credentialId)?.accessToken,
          "access-token",
        );
        assert.isFalse(credentialStore.pending.has(started.state));
      }),
    );

    it.effect("refreshes an expired credential and keeps a rotated refresh token", () =>
      Effect.gen(function* () {
        const repository = repositoryHarness();
        const credentialStore = credentialHarness();
        const connectionId = WorkbenchJiraConnectionId.make("connection-1");
        yield* repository.service.upsertConnection(
          {
            id: connectionId,
            cloudId: "cloud-1",
            siteName: "Example Jira",
            siteUrl: "https://example.atlassian.net",
            avatarUrl: null,
            scopes: [...JIRA_OAUTH_SCOPES],
            createdAt: "1970-01-01T00:00:00.000Z",
            updatedAt: "1970-01-01T00:00:00.000Z",
          },
          "credential-1",
        );
        yield* credentialStore.service.setCredential("credential-1", {
          accessToken: "expired",
          refreshToken: "old-refresh",
          scope: JIRA_OAUTH_SCOPES.join(" "),
          expiresAtEpochMs: 0,
        });
        const oauth = JiraOAuthClient.of({
          exchangeCode: () => Effect.die("unexpected exchange"),
          refresh: () =>
            Effect.succeed({
              accessToken: "fresh-access",
              refreshToken: "rotated-refresh",
              scope: JIRA_OAUTH_SCOPES.join(" "),
              expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
            }),
          listAccessibleSites: () => Effect.die("unexpected site lookup"),
        });
        const service = yield* JiraAuthService.make.pipe(
          Effect.provideService(WorkbenchJiraRepository, repository.service),
          Effect.provideService(JiraCredentialStore, credentialStore.service),
          Effect.provideService(JiraOAuthClient, oauth),
          Effect.provideService(HostProcessEnvironment, {
            T3_WORKBENCH_JIRA_CLIENT_ID: "client-id",
            T3_WORKBENCH_JIRA_CLIENT_SECRET: "client-secret",
          }),
        );

        assert.strictEqual(yield* service.getAccessToken(connectionId), "fresh-access");
        assert.strictEqual(
          credentialStore.credentials.get("credential-1")?.refreshToken,
          "rotated-refresh",
        );
      }),
    );

    it.effect("offers retry and reconnect recovery when token refresh fails", () =>
      Effect.gen(function* () {
        const repository = repositoryHarness();
        const credentialStore = credentialHarness();
        const connectionId = WorkbenchJiraConnectionId.make("connection-1");
        yield* repository.service.upsertConnection(
          {
            id: connectionId,
            cloudId: "cloud-1",
            siteName: "Example Jira",
            siteUrl: "https://example.atlassian.net",
            avatarUrl: null,
            scopes: [...JIRA_OAUTH_SCOPES],
            createdAt: "1970-01-01T00:00:00.000Z",
            updatedAt: "1970-01-01T00:00:00.000Z",
          },
          "credential-1",
        );
        yield* credentialStore.service.setCredential("credential-1", {
          accessToken: "expired",
          refreshToken: "old-refresh",
          scope: JIRA_OAUTH_SCOPES.join(" "),
          expiresAtEpochMs: 0,
        });
        const oauth = JiraOAuthClient.of({
          exchangeCode: () => Effect.die("unexpected exchange"),
          refresh: () =>
            Effect.fail(
              new WorkbenchJiraOperationError({
                code: "oauth_exchange_failed",
                message: "token endpoint rejected the refresh",
              }),
            ),
          listAccessibleSites: () => Effect.die("unexpected site lookup"),
        });
        const service = yield* JiraAuthService.make.pipe(
          Effect.provideService(WorkbenchJiraRepository, repository.service),
          Effect.provideService(JiraCredentialStore, credentialStore.service),
          Effect.provideService(JiraOAuthClient, oauth),
          Effect.provideService(HostProcessEnvironment, {
            T3_WORKBENCH_JIRA_CLIENT_ID: "client-id",
            T3_WORKBENCH_JIRA_CLIENT_SECRET: "client-secret",
          }),
        );

        const error = yield* service.getAccessToken(connectionId).pipe(Effect.flip);
        assert.strictEqual(error.code, "oauth_exchange_failed");
        assert.isTrue(error.message.includes("Try again"));
        assert.isTrue(error.message.includes("reconnect Jira"));
      }),
    );

    it.effect("refreshes a shared expired credential only once for concurrent callers", () =>
      Effect.gen(function* () {
        const repository = repositoryHarness();
        const credentialStore = credentialHarness();
        const firstConnectionId = WorkbenchJiraConnectionId.make("connection-1");
        const secondConnectionId = WorkbenchJiraConnectionId.make("connection-2");
        for (const [id, cloudId] of [
          [firstConnectionId, "cloud-1"],
          [secondConnectionId, "cloud-2"],
        ] as const) {
          yield* repository.service.upsertConnection(
            {
              id,
              cloudId,
              siteName: "Example Jira",
              siteUrl: "https://example.atlassian.net",
              avatarUrl: null,
              scopes: [...JIRA_OAUTH_SCOPES],
              createdAt: "1970-01-01T00:00:00.000Z",
              updatedAt: "1970-01-01T00:00:00.000Z",
            },
            "credential-1",
          );
        }
        yield* credentialStore.service.setCredential("credential-1", {
          accessToken: "expired",
          refreshToken: "old-refresh",
          scope: JIRA_OAUTH_SCOPES.join(" "),
          expiresAtEpochMs: 0,
        });

        const refreshCalls = yield* Ref.make(0);
        const firstRefreshStarted = yield* Deferred.make<void>();
        const releaseRefresh = yield* Deferred.make<void>();
        const oauth = JiraOAuthClient.of({
          exchangeCode: () => Effect.die("unexpected exchange"),
          refresh: () =>
            Effect.gen(function* () {
              yield* Ref.update(refreshCalls, (count) => count + 1);
              yield* Deferred.succeed(firstRefreshStarted, undefined);
              yield* Deferred.await(releaseRefresh);
              return {
                accessToken: "fresh-access",
                refreshToken: "rotated-refresh",
                scope: JIRA_OAUTH_SCOPES.join(" "),
                expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
              };
            }),
          listAccessibleSites: () => Effect.die("unexpected site lookup"),
        });
        const service = yield* JiraAuthService.make.pipe(
          Effect.provideService(WorkbenchJiraRepository, repository.service),
          Effect.provideService(JiraCredentialStore, credentialStore.service),
          Effect.provideService(JiraOAuthClient, oauth),
          Effect.provideService(HostProcessEnvironment, {
            T3_WORKBENCH_JIRA_CLIENT_ID: "client-id",
            T3_WORKBENCH_JIRA_CLIENT_SECRET: "client-secret",
          }),
        );

        const first = yield* service.getAccessToken(firstConnectionId).pipe(Effect.forkChild);
        yield* Deferred.await(firstRefreshStarted);
        const second = yield* service.getAccessToken(secondConnectionId).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        assert.strictEqual(yield* Ref.get(refreshCalls), 1);
        yield* Deferred.succeed(releaseRefresh, undefined);

        assert.deepStrictEqual(yield* Effect.all([Fiber.join(first), Fiber.join(second)]), [
          "fresh-access",
          "fresh-access",
        ]);
        assert.strictEqual(yield* Ref.get(refreshCalls), 1);
      }),
    );

    it.effect("removes an unreferenced superseded credential after reconnecting", () =>
      Effect.gen(function* () {
        const repository = repositoryHarness();
        const credentialStore = credentialHarness();
        const connectionId = WorkbenchJiraConnectionId.make("connection-1");
        yield* repository.service.upsertConnection(
          {
            id: connectionId,
            cloudId: "cloud-1",
            siteName: "Old Jira name",
            siteUrl: "https://example.atlassian.net",
            avatarUrl: null,
            scopes: [...JIRA_OAUTH_SCOPES],
            createdAt: "1970-01-01T00:00:00.000Z",
            updatedAt: "1970-01-01T00:00:00.000Z",
          },
          "old-credential",
        );
        yield* credentialStore.service.setCredential("old-credential", {
          accessToken: "old-access",
          refreshToken: "old-refresh",
          scope: JIRA_OAUTH_SCOPES.join(" "),
          expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
        });
        yield* credentialStore.service.setPendingAuthorization("oauth-state", {
          redirectUri: "http://localhost/oauth/jira",
          expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
        });
        const oauth = JiraOAuthClient.of({
          exchangeCode: () =>
            Effect.succeed({
              accessToken: "new-access",
              refreshToken: "new-refresh",
              scope: JIRA_OAUTH_SCOPES.join(" "),
              expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
            }),
          refresh: () => Effect.die("unexpected refresh"),
          listAccessibleSites: () =>
            Effect.succeed([
              {
                cloudId: "cloud-1",
                name: "Updated Jira name",
                url: "https://example.atlassian.net",
                avatarUrl: null,
                scopes: [...JIRA_OAUTH_SCOPES],
              },
            ]),
        });
        const service = yield* JiraAuthService.make.pipe(
          Effect.provideService(WorkbenchJiraRepository, repository.service),
          Effect.provideService(JiraCredentialStore, credentialStore.service),
          Effect.provideService(JiraOAuthClient, oauth),
          Effect.provideService(HostProcessEnvironment, {
            T3_WORKBENCH_JIRA_CLIENT_ID: "client-id",
            T3_WORKBENCH_JIRA_CLIENT_SECRET: "client-secret",
          }),
        );

        yield* service.complete({
          code: "authorization-code",
          state: "oauth-state",
          redirectUri: "http://localhost/oauth/jira",
        });

        assert.isFalse(credentialStore.credentials.has("old-credential"));
        assert.notStrictEqual(repository.credentialIds.get(connectionId), "old-credential");
      }),
    );

    it.effect("removes a new credential when reconnect persistence fails before using it", () =>
      Effect.gen(function* () {
        const repository = repositoryHarness();
        const credentialStore = credentialHarness();
        const connectionId = WorkbenchJiraConnectionId.make("connection-1");
        const originalConnection = {
          id: connectionId,
          cloudId: "cloud-1",
          siteName: "Original Jira name",
          siteUrl: "https://example.atlassian.net",
          avatarUrl: null,
          scopes: [...JIRA_OAUTH_SCOPES],
          createdAt: "1970-01-01T00:00:00.000Z",
          updatedAt: "1970-01-01T00:00:00.000Z",
        } satisfies WorkbenchJiraConnection;
        yield* repository.service.upsertConnection(originalConnection, "old-credential");
        yield* credentialStore.service.setCredential("old-credential", {
          accessToken: "old-access",
          refreshToken: "old-refresh",
          scope: JIRA_OAUTH_SCOPES.join(" "),
          expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
        });
        yield* credentialStore.service.setPendingAuthorization("oauth-state", {
          redirectUri: "http://localhost/oauth/jira",
          expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
        });
        const oauth = JiraOAuthClient.of({
          exchangeCode: () =>
            Effect.succeed({
              accessToken: "new-access",
              refreshToken: "new-refresh",
              scope: JIRA_OAUTH_SCOPES.join(" "),
              expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
            }),
          refresh: () => Effect.die("unexpected refresh"),
          listAccessibleSites: () =>
            Effect.succeed([
              {
                cloudId: "cloud-1",
                name: "Example Jira",
                url: "https://example.atlassian.net",
                avatarUrl: null,
                scopes: [...JIRA_OAUTH_SCOPES],
              },
            ]),
        });
        const failingRepository = WorkbenchJiraRepository.of({
          ...repository.service,
          upsertConnections: () =>
            Effect.fail(new WorkbenchJiraRepositoryError({ cause: new Error("write failed") })),
        });
        const service = yield* JiraAuthService.make.pipe(
          Effect.provideService(WorkbenchJiraRepository, failingRepository),
          Effect.provideService(JiraCredentialStore, credentialStore.service),
          Effect.provideService(JiraOAuthClient, oauth),
          Effect.provideService(HostProcessEnvironment, {
            T3_WORKBENCH_JIRA_CLIENT_ID: "client-id",
            T3_WORKBENCH_JIRA_CLIENT_SECRET: "client-secret",
          }),
        );

        const error = yield* service
          .complete({
            code: "authorization-code",
            state: "oauth-state",
            redirectUri: "http://localhost/oauth/jira",
          })
          .pipe(Effect.flip);

        assert.strictEqual(error.code, "persistence_failed");
        assert.strictEqual(credentialStore.credentials.size, 1);
        assert.isTrue(credentialStore.credentials.has("old-credential"));
        assert.deepStrictEqual(repository.connections.get(connectionId), originalConnection);
        assert.strictEqual(repository.credentialIds.get(connectionId), "old-credential");
        assert.isFalse(credentialStore.pending.has("oauth-state"));
      }),
    );

    it.effect("consumes a pending authorization only once across concurrent callbacks", () =>
      Effect.gen(function* () {
        const repository = repositoryHarness();
        const credentialStore = credentialHarness();
        yield* credentialStore.service.setPendingAuthorization("oauth-state", {
          redirectUri: "http://localhost/oauth/jira",
          expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
        });
        const exchangeCalls = yield* Ref.make(0);
        const firstExchangeStarted = yield* Deferred.make<void>();
        const releaseExchange = yield* Deferred.make<void>();
        const oauth = JiraOAuthClient.of({
          exchangeCode: () =>
            Effect.gen(function* () {
              yield* Ref.update(exchangeCalls, (count) => count + 1);
              yield* Deferred.succeed(firstExchangeStarted, undefined);
              yield* Deferred.await(releaseExchange);
              return {
                accessToken: "new-access",
                refreshToken: "new-refresh",
                scope: JIRA_OAUTH_SCOPES.join(" "),
                expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
              };
            }),
          refresh: () => Effect.die("unexpected refresh"),
          listAccessibleSites: () =>
            Effect.succeed([
              {
                cloudId: "cloud-1",
                name: "Example Jira",
                url: "https://example.atlassian.net",
                avatarUrl: null,
                scopes: [...JIRA_OAUTH_SCOPES],
              },
            ]),
        });
        const service = yield* JiraAuthService.make.pipe(
          Effect.provideService(WorkbenchJiraRepository, repository.service),
          Effect.provideService(JiraCredentialStore, credentialStore.service),
          Effect.provideService(JiraOAuthClient, oauth),
          Effect.provideService(HostProcessEnvironment, {
            T3_WORKBENCH_JIRA_CLIENT_ID: "client-id",
            T3_WORKBENCH_JIRA_CLIENT_SECRET: "client-secret",
          }),
        );
        const complete = service.complete({
          code: "authorization-code",
          state: "oauth-state",
          redirectUri: "http://localhost/oauth/jira",
        });

        const first = yield* complete.pipe(Effect.forkChild);
        yield* Deferred.await(firstExchangeStarted);
        const second = yield* complete.pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        assert.strictEqual(yield* Ref.get(exchangeCalls), 1);
        yield* Deferred.succeed(releaseExchange, undefined);

        assert.strictEqual((yield* Fiber.join(first)).connections.length, 1);
        const secondError = yield* Fiber.join(second).pipe(Effect.flip);
        assert.strictEqual(secondError.code, "invalid_oauth_state");
        assert.strictEqual(yield* Ref.get(exchangeCalls), 1);
        assert.strictEqual(credentialStore.credentials.size, 1);
      }),
    );

    it.effect("does not repoint a connection while its old credential is refreshing", () =>
      Effect.gen(function* () {
        const repository = repositoryHarness();
        const credentialStore = credentialHarness();
        const connectionId = WorkbenchJiraConnectionId.make("connection-1");
        yield* repository.service.upsertConnection(
          {
            id: connectionId,
            cloudId: "cloud-1",
            siteName: "Old Jira name",
            siteUrl: "https://example.atlassian.net",
            avatarUrl: null,
            scopes: [...JIRA_OAUTH_SCOPES],
            createdAt: "1970-01-01T00:00:00.000Z",
            updatedAt: "1970-01-01T00:00:00.000Z",
          },
          "old-credential",
        );
        yield* credentialStore.service.setCredential("old-credential", {
          accessToken: "expired-access",
          refreshToken: "old-refresh",
          scope: JIRA_OAUTH_SCOPES.join(" "),
          expiresAtEpochMs: 0,
        });
        yield* credentialStore.service.setPendingAuthorization("oauth-state", {
          redirectUri: "http://localhost/oauth/jira",
          expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
        });

        const refreshStarted = yield* Deferred.make<void>();
        const releaseRefresh = yield* Deferred.make<void>();
        const reconnectCredentialStored = yield* Deferred.make<void>();
        const oauth = JiraOAuthClient.of({
          exchangeCode: () =>
            Effect.succeed({
              accessToken: "reconnected-access",
              refreshToken: "reconnected-refresh",
              scope: JIRA_OAUTH_SCOPES.join(" "),
              expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
            }),
          refresh: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(refreshStarted, undefined);
              yield* Deferred.await(releaseRefresh);
              return {
                accessToken: "refreshed-old-access",
                refreshToken: "rotated-old-refresh",
                scope: JIRA_OAUTH_SCOPES.join(" "),
                expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
              };
            }),
          listAccessibleSites: () =>
            Effect.succeed([
              {
                cloudId: "cloud-1",
                name: "Reconnected Jira",
                url: "https://example.atlassian.net",
                avatarUrl: null,
                scopes: [...JIRA_OAUTH_SCOPES],
              },
            ]),
        });
        const signalingCredentialStore = JiraCredentialStore.of({
          ...credentialStore.service,
          setCredential: (id, credential) =>
            credentialStore.service
              .setCredential(id, credential)
              .pipe(
                Effect.andThen(
                  credential.accessToken === "reconnected-access"
                    ? Deferred.succeed(reconnectCredentialStored, undefined)
                    : Effect.void,
                ),
              ),
        });
        const service = yield* JiraAuthService.make.pipe(
          Effect.provideService(WorkbenchJiraRepository, repository.service),
          Effect.provideService(JiraCredentialStore, signalingCredentialStore),
          Effect.provideService(JiraOAuthClient, oauth),
          Effect.provideService(HostProcessEnvironment, {
            T3_WORKBENCH_JIRA_CLIENT_ID: "client-id",
            T3_WORKBENCH_JIRA_CLIENT_SECRET: "client-secret",
          }),
        );

        const refresh = yield* service.getAccessToken(connectionId).pipe(Effect.forkChild);
        yield* Deferred.await(refreshStarted);
        const reconnect = yield* service
          .complete({
            code: "authorization-code",
            state: "oauth-state",
            redirectUri: "http://localhost/oauth/jira",
          })
          .pipe(Effect.forkChild);
        yield* Deferred.await(reconnectCredentialStored);
        yield* Effect.yieldNow;

        assert.strictEqual(repository.credentialIds.get(connectionId), "old-credential");
        yield* Deferred.succeed(releaseRefresh, undefined);
        assert.strictEqual(yield* Fiber.join(refresh), "refreshed-old-access");
        yield* Fiber.join(reconnect);
        assert.notStrictEqual(repository.credentialIds.get(connectionId), "old-credential");
      }),
    );

    it.effect("fails before exchange when OAuth state consumption fails", () =>
      Effect.gen(function* () {
        const repository = repositoryHarness();
        const credentialStore = credentialHarness();
        const connectionId = WorkbenchJiraConnectionId.make("connection-1");
        yield* repository.service.upsertConnection(
          {
            id: connectionId,
            cloudId: "cloud-1",
            siteName: "Old Jira name",
            siteUrl: "https://example.atlassian.net",
            avatarUrl: null,
            scopes: [...JIRA_OAUTH_SCOPES],
            createdAt: "1970-01-01T00:00:00.000Z",
            updatedAt: "1970-01-01T00:00:00.000Z",
          },
          "old-credential",
        );
        yield* credentialStore.service.setCredential("old-credential", {
          accessToken: "old-access",
          refreshToken: "old-refresh",
          scope: JIRA_OAUTH_SCOPES.join(" "),
          expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
        });
        yield* credentialStore.service.setPendingAuthorization("oauth-state", {
          redirectUri: "http://localhost/oauth/jira",
          expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
        });
        const cleanupError = new WorkbenchJiraOperationError({
          code: "persistence_failed",
          message: "cleanup failed",
        });
        const failingCleanupStore = JiraCredentialStore.of({
          ...credentialStore.service,
          removeCredential: (id) =>
            id === "old-credential"
              ? Effect.fail(cleanupError)
              : credentialStore.service.removeCredential(id),
          removePendingAuthorization: () => Effect.fail(cleanupError),
        });
        const oauth = JiraOAuthClient.of({
          exchangeCode: () => Effect.die("unexpected exchange"),
          refresh: () => Effect.die("unexpected refresh"),
          listAccessibleSites: () => Effect.die("unexpected site lookup"),
        });
        const service = yield* JiraAuthService.make.pipe(
          Effect.provideService(WorkbenchJiraRepository, repository.service),
          Effect.provideService(JiraCredentialStore, failingCleanupStore),
          Effect.provideService(JiraOAuthClient, oauth),
          Effect.provideService(HostProcessEnvironment, {
            T3_WORKBENCH_JIRA_CLIENT_ID: "client-id",
            T3_WORKBENCH_JIRA_CLIENT_SECRET: "client-secret",
          }),
        );

        const error = yield* service
          .complete({
            code: "authorization-code",
            state: "oauth-state",
            redirectUri: "http://localhost/oauth/jira",
          })
          .pipe(Effect.flip);

        assert.strictEqual(error.code, "persistence_failed");
        assert.strictEqual(repository.credentialIds.get(connectionId), "old-credential");
        assert.isTrue(credentialStore.credentials.has("old-credential"));
        assert.isTrue(credentialStore.pending.has("oauth-state"));
      }),
    );
  });
});
