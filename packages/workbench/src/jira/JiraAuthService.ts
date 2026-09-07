import {
  WorkbenchJiraConnectionId,
  WorkbenchJiraOperationError,
  type WorkbenchJiraBeginAuthInput,
  type WorkbenchJiraBeginAuthResult,
  type WorkbenchJiraCompleteAuthInput,
  type WorkbenchJiraCompleteAuthResult,
  type WorkbenchJiraConnection,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import { JiraCredentialStore } from "./JiraCredentialStore.ts";
import { JiraConfig } from "./JiraConfig.ts";
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
  "@t3tools/workbench/jira/JiraAuthService",
) {}

export const make = Effect.gen(function* () {
  const configService = yield* JiraConfig;
  const clock = yield* Clock.Clock;
  const crypto = yield* Crypto.Crypto;
  const credentials = yield* JiraCredentialStore;
  const oauth = yield* JiraOAuthClient;
  const repository = yield* WorkbenchJiraRepository;
  const credentialLocks = yield* Ref.make<ReadonlyMap<string, Semaphore.Semaphore>>(new Map());
  const completeSemaphore = yield* Semaphore.make(1);
  const connectionMutationSemaphore = yield* Semaphore.make(1);

  const getCredentialLock = (credentialId: string) =>
    Effect.gen(function* () {
      const existing = (yield* Ref.get(credentialLocks)).get(credentialId);
      if (existing !== undefined) return existing;

      const lock = yield* Semaphore.make(1);
      return yield* Ref.modify(credentialLocks, (locks) => {
        const current = locks.get(credentialId);
        if (current !== undefined) return [current, locks] as const;
        const next = new Map(locks);
        next.set(credentialId, lock);
        return [lock, next] as const;
      });
    });

  const removeCredentialIfUnreferenced = (credentialId: string) =>
    Effect.gen(function* () {
      const connections = yield* repository
        .listConnections()
        .pipe(Effect.mapError(repositoryError));
      const currentCredentialIds = yield* Effect.forEach(connections, (connection) =>
        repository.getCredentialId(connection.id).pipe(Effect.mapError(repositoryError)),
      );
      if (
        currentCredentialIds.some(
          (currentCredentialId) =>
            Option.isSome(currentCredentialId) && currentCredentialId.value === credentialId,
        )
      ) {
        return;
      }
      yield* credentials.removeCredential(credentialId);
    });

  const readConfig = configService.get.pipe(
    Effect.flatMap((config) =>
      config === null
        ? Effect.fail(
            operationError(
              "not_configured",
              "Configure the Atlassian OAuth app, set T3_WORKBENCH_JIRA_CLIENT_ID and T3_WORKBENCH_JIRA_CLIENT_SECRET, register the exact callback URL, then restart the T3 server.",
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
    completeSemaphore.withPermit(
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

        yield* credentials.removePendingAuthorization(input.state);

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
        const connections: Array<WorkbenchJiraConnection> = [];
        const previousCredentialIds = new Set<string>();
        for (const site of sites) {
          const previous = yield* repository
            .findConnectionByCloudId(site.cloudId)
            .pipe(Effect.mapError(repositoryError));
          if (Option.isSome(previous)) {
            const previousCredentialId = yield* repository
              .getCredentialId(previous.value.id)
              .pipe(Effect.mapError(repositoryError));
            if (Option.isSome(previousCredentialId)) {
              previousCredentialIds.add(previousCredentialId.value);
            }
          }
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
          connections.push(connection);
        }

        yield* credentials.setCredential(credentialId, token);
        yield* connectionMutationSemaphore.withPermit(
          repository.upsertConnections(connections, credentialId).pipe(
            Effect.mapError(repositoryError),
            Effect.catch((cause) =>
              removeCredentialIfUnreferenced(credentialId).pipe(Effect.andThen(Effect.fail(cause))),
            ),
          ),
        );
        for (const previousCredentialId of previousCredentialIds) {
          if (previousCredentialId === credentialId) continue;
          const lock = yield* getCredentialLock(previousCredentialId);
          yield* lock.withPermit(removeCredentialIfUnreferenced(previousCredentialId)).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Failed to remove a superseded Jira credential.", {
                credentialId: previousCredentialId,
                cause,
              }),
            ),
          );
        }

        return { connections };
      }),
    );

  const loadCredentialId = (connectionId: WorkbenchJiraConnectionId) =>
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
      return credentialId.value;
    });

  const loadAccessToken = (
    connectionId: WorkbenchJiraConnectionId,
    initialCredentialId: string,
  ): Effect.Effect<string, WorkbenchJiraOperationError> =>
    Effect.gen(function* () {
      const lock = yield* getCredentialLock(initialCredentialId);
      const result = yield* lock.withPermit(
        Effect.gen(function* () {
          const credentialId = yield* loadCredentialId(connectionId);
          if (credentialId !== initialCredentialId) {
            return { _tag: "retry", credentialId } as const;
          }

          const stored = yield* credentials.getCredential(credentialId);
          if (Option.isNone(stored)) {
            return yield* operationError(
              "credential_missing",
              "The Jira connection no longer has credentials. Reconnect Jira.",
            );
          }

          const now = yield* clock.currentTimeMillis;
          if (stored.value.expiresAtEpochMs > now + REFRESH_EARLY_MS) {
            return { _tag: "ready", accessToken: stored.value.accessToken } as const;
          }

          return yield* connectionMutationSemaphore.withPermit(
            Effect.gen(function* () {
              const currentCredentialId = yield* loadCredentialId(connectionId);
              if (currentCredentialId !== credentialId) {
                return { _tag: "retry", credentialId: currentCredentialId } as const;
              }

              const currentStored = yield* credentials.getCredential(credentialId);
              if (Option.isNone(currentStored)) {
                return yield* operationError(
                  "credential_missing",
                  "The Jira connection no longer has credentials. Reconnect Jira.",
                );
              }
              const refreshNow = yield* clock.currentTimeMillis;
              if (currentStored.value.expiresAtEpochMs > refreshNow + REFRESH_EARLY_MS) {
                return {
                  _tag: "ready",
                  accessToken: currentStored.value.accessToken,
                } as const;
              }
              if (currentStored.value.refreshToken === null) {
                return yield* operationError(
                  "credential_missing",
                  "The Jira connection cannot be refreshed. Reconnect Jira.",
                );
              }

              const config = yield* readConfig;
              const refreshed = yield* oauth
                .refresh({
                  ...config,
                  refreshToken: currentStored.value.refreshToken,
                  previousScope: currentStored.value.scope,
                  nowEpochMs: refreshNow,
                })
                .pipe(
                  Effect.mapError(() =>
                    operationError(
                      "oauth_exchange_failed",
                      "Jira access could not be refreshed. Try again; if the problem persists, reconnect Jira.",
                    ),
                  ),
                );
              yield* credentials.setCredential(credentialId, refreshed);
              return { _tag: "ready", accessToken: refreshed.accessToken } as const;
            }),
          );
        }),
      );
      return result._tag === "ready"
        ? result.accessToken
        : yield* loadAccessToken(connectionId, result.credentialId);
    });

  const getAccessToken: JiraAuthServiceShape["getAccessToken"] = (connectionId) =>
    Effect.gen(function* () {
      const initialCredentialId = yield* loadCredentialId(connectionId);
      return yield* loadAccessToken(connectionId, initialCredentialId);
    });

  return JiraAuthService.of({ begin, complete, getAccessToken });
});

export const layer = Layer.effect(JiraAuthService, make);
