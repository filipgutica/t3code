import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { WorkbenchJiraConnectionId, type WorkbenchJiraConnection } from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as JiraAuthService from "./JiraAuthService.ts";
import {
  JiraCredentialStore,
  type JiraOAuthCredential,
  type PendingJiraAuthorization,
} from "./JiraCredentialStore.ts";
import { JiraOAuthClient, JIRA_OAUTH_SCOPES } from "./JiraOAuthClient.ts";
import {
  WorkbenchJiraRepository,
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
    getBinding: () => Effect.succeed(Option.none()),
    listBindings: () => Effect.succeed([]),
    upsertBinding: () => Effect.void,
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
  });
});
