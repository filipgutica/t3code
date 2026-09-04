import {
  WorkbenchJiraConnectionId,
  WorkbenchJiraOperationError,
  type WorkbenchJiraBeginAuthInput,
  type WorkbenchJiraBeginAuthResult,
  type WorkbenchJiraCompleteAuthInput,
  type WorkbenchJiraCompleteAuthResult,
  type WorkbenchJiraConnection,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { JiraCredentialStore } from "./JiraCredentialStore.ts";
import { buildJiraAuthorizationUrl, JiraOAuthClient } from "./JiraOAuthClient.ts";
import {
  WorkbenchJiraRepository,
  type WorkbenchJiraRepositoryError,
} from "./WorkbenchJiraRepository.ts";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1_000;
const REFRESH_EARLY_MS = 60 * 1_000;

const operationError = (code: WorkbenchJiraOperationError["code"], message: string) =>
  new WorkbenchJiraOperationError({ code, message });

const repositoryError = (_cause: WorkbenchJiraRepositoryError) =>
  operationError("persistence_failed", "Jira connection metadata could not be saved or loaded.");

const isoDate = (epochMs: number) => DateTime.formatIso(DateTime.makeUnsafe(epochMs));

export interface JiraAuthServiceShape {
  readonly begin: (
    input: WorkbenchJiraBeginAuthInput,
  ) => Effect.Effect<WorkbenchJiraBeginAuthResult, WorkbenchJiraOperationError>;
  readonly complete: (
    input: WorkbenchJiraCompleteAuthInput,
  ) => Effect.Effect<WorkbenchJiraCompleteAuthResult, WorkbenchJiraOperationError>;
  readonly getAccessToken: (
    connectionId: WorkbenchJiraConnectionId,
  ) => Effect.Effect<string, WorkbenchJiraOperationError>;
}

export class JiraAuthService extends Context.Service<JiraAuthService, JiraAuthServiceShape>()(
  "t3/workbench/jira/JiraAuthService",
) {}

export const make = Effect.gen(function* () {
  const environment = yield* HostProcessEnvironment;
  const clock = yield* Clock.Clock;
  const crypto = yield* Crypto.Crypto;
  const credentials = yield* JiraCredentialStore;
  const oauth = yield* JiraOAuthClient;
  const repository = yield* WorkbenchJiraRepository;

  const readConfig = Effect.sync(() => {
    const clientId = environment.T3_WORKBENCH_JIRA_CLIENT_ID?.trim() ?? "";
    const clientSecret = environment.T3_WORKBENCH_JIRA_CLIENT_SECRET?.trim() ?? "";
    return clientId.length > 0 && clientSecret.length > 0 ? { clientId, clientSecret } : null;
  }).pipe(
    Effect.flatMap((config) =>
      config === null
        ? Effect.fail(
            operationError(
              "not_configured",
              "Set T3_WORKBENCH_JIRA_CLIENT_ID and T3_WORKBENCH_JIRA_CLIENT_SECRET.",
            ),
          )
        : Effect.succeed(config),
    ),
  );

  const begin: JiraAuthServiceShape["begin"] = (input) =>
    Effect.gen(function* () {
      const config = yield* readConfig;
      const now = yield* clock.currentTimeMillis;
      const state = Encoding.encodeBase64Url(
        yield* crypto
          .randomBytes(24)
          .pipe(
            Effect.mapError(() =>
              operationError(
                "authorization_failed",
                "A Jira authorization state could not be created.",
              ),
            ),
          ),
      );
      const expiresAtEpochMs = now + OAUTH_STATE_TTL_MS;
      yield* credentials.setPendingAuthorization(state, {
        redirectUri: input.redirectUri,
        expiresAtEpochMs,
      });
      return {
        authorizationUrl: buildJiraAuthorizationUrl({
          clientId: config.clientId,
          redirectUri: input.redirectUri,
          state,
        }),
        state,
        expiresAt: isoDate(expiresAtEpochMs),
      };
    });

  const complete: JiraAuthServiceShape["complete"] = (input) =>
    Effect.gen(function* () {
      const config = yield* readConfig;
      const pending = yield* credentials.getPendingAuthorization(input.state);
      if (Option.isNone(pending) || pending.value.redirectUri !== input.redirectUri) {
        return yield* operationError(
          "invalid_oauth_state",
          "The Jira authorization request is invalid or has already been used.",
        );
      }

      const now = yield* clock.currentTimeMillis;
      if (pending.value.expiresAtEpochMs <= now) {
        yield* credentials.removePendingAuthorization(input.state);
        return yield* operationError(
          "oauth_state_expired",
          "The Jira authorization request expired. Start the connection again.",
        );
      }

      const token = yield* oauth.exchangeCode({
        ...config,
        code: input.code,
        redirectUri: input.redirectUri,
        nowEpochMs: now,
      });
      const sites = yield* oauth.listAccessibleSites(token.accessToken);
      if (sites.length === 0) {
        return yield* operationError(
          "authorization_failed",
          "The Atlassian account does not expose an accessible Jira site.",
        );
      }

      const credentialId = yield* crypto.randomUUIDv4.pipe(
        Effect.mapError(() =>
          operationError(
            "persistence_failed",
            "A Jira credential identifier could not be created.",
          ),
        ),
      );
      yield* credentials.setCredential(credentialId, token);
      const connections: Array<WorkbenchJiraConnection> = [];
      for (const site of sites) {
        const previous = yield* repository
          .findConnectionByCloudId(site.cloudId)
          .pipe(Effect.mapError(repositoryError));
        const id = Option.isSome(previous)
          ? previous.value.id
          : WorkbenchJiraConnectionId.make(
              yield* crypto.randomUUIDv4.pipe(
                Effect.mapError(() =>
                  operationError(
                    "persistence_failed",
                    "A Jira connection identifier could not be created.",
                  ),
                ),
              ),
            );
        const connection = {
          id,
          cloudId: site.cloudId,
          siteName: site.name,
          siteUrl: site.url,
          avatarUrl: site.avatarUrl,
          scopes: site.scopes,
          createdAt: Option.isSome(previous) ? previous.value.createdAt : isoDate(now),
          updatedAt: isoDate(now),
        } satisfies WorkbenchJiraConnection;
        yield* repository
          .upsertConnection(connection, credentialId)
          .pipe(Effect.mapError(repositoryError));
        connections.push(connection);
      }

      yield* credentials.removePendingAuthorization(input.state);
      return { connections };
    });

  const getAccessToken: JiraAuthServiceShape["getAccessToken"] = (connectionId) =>
    Effect.gen(function* () {
      const connection = yield* repository
        .getConnection(connectionId)
        .pipe(Effect.mapError(repositoryError));
      if (Option.isNone(connection)) {
        return yield* operationError("connection_not_found", "The Jira connection was not found.");
      }
      const credentialId = yield* repository
        .getCredentialId(connectionId)
        .pipe(Effect.mapError(repositoryError));
      if (Option.isNone(credentialId)) {
        return yield* operationError(
          "credential_missing",
          "The Jira connection no longer has credentials. Reconnect Jira.",
        );
      }
      const stored = yield* credentials.getCredential(credentialId.value);
      if (Option.isNone(stored)) {
        return yield* operationError(
          "credential_missing",
          "The Jira connection no longer has credentials. Reconnect Jira.",
        );
      }

      const now = yield* clock.currentTimeMillis;
      if (stored.value.expiresAtEpochMs > now + REFRESH_EARLY_MS) {
        return stored.value.accessToken;
      }
      if (stored.value.refreshToken === null) {
        return yield* operationError(
          "credential_missing",
          "The Jira connection cannot be refreshed. Reconnect Jira.",
        );
      }

      const config = yield* readConfig;
      const refreshed = yield* oauth.refresh({
        ...config,
        refreshToken: stored.value.refreshToken,
        previousScope: stored.value.scope,
        nowEpochMs: now,
      });
      yield* credentials.setCredential(credentialId.value, refreshed);
      return refreshed.accessToken;
    });

  return JiraAuthService.of({ begin, complete, getAccessToken });
});

export const layer = Layer.effect(JiraAuthService, make);
