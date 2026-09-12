import {
  WorkbenchJiraConnectionId,
  WorkbenchJiraOperationError,
  type WorkbenchJiraBeginAuthInput,
  type WorkbenchJiraBeginAuthResult,
  type WorkbenchJiraClaimAuthInput,
  type WorkbenchJiraClaimAuthResult,
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

import { JiraCredentialStore, type JiraOAuthCredential } from "./JiraCredentialStore.ts";
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
  readonly claim?: (
    input: WorkbenchJiraClaimAuthInput,
  ) => Effect.Effect<WorkbenchJiraClaimAuthResult, WorkbenchJiraOperationError>;
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
              "Configure the Atlassian OAuth app or Jira OAuth broker, set T3_WORKBENCH_JIRA_CLIENT_ID and T3_WORKBENCH_JIRA_CLIENT_SECRET when using direct OAuth, register the exact callback URL, then restart the T3 server.",
            ),
          )
        : Effect.succeed(config),
    ),
  );

  const randomState = crypto.randomBytes(24).pipe(
    Effect.map(Encoding.encodeBase64Url),
    Effect.mapError(() =>
      operationError("authorization_failed", "A Jira authorization state could not be created."),
    ),
  );

  const persistToken = ({
    token,
    now,
    authMode,
  }: {
    readonly token: JiraOAuthCredential;
    readonly now: number;
    readonly authMode?: "direct" | "broker";
  }): Effect.Effect<WorkbenchJiraCompleteAuthResult, WorkbenchJiraOperationError> =>
    Effect.gen(function* () {
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
        connections.push({
          id,
          cloudId: site.cloudId,
          siteName: site.name,
          siteUrl: site.url,
          avatarUrl: site.avatarUrl,
          scopes: site.scopes,
          createdAt: Option.isSome(previous) ? previous.value.createdAt : isoDate(now),
          updatedAt: isoDate(now),
        });
      }

      const storedToken = authMode === undefined ? token : { ...token, authMode };
      yield* credentials.setCredential(credentialId, storedToken);
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
    });

  const begin: JiraAuthServiceShape["begin"] = (input) =>
    Effect.gen(function* () {
      const config = yield* readConfig;
      const now = yield* clock.currentTimeMillis;
      const state = yield* randomState;
      // Explicit direct credentials take precedence for local development. Keep
      // the broker URL in the config as well so existing broker credentials can
      // still refresh when both modes are configured.
      if (config.brokerUrl !== undefined && (!config.clientId || !config.clientSecret)) {
        if (oauth.startBroker === undefined) {
          return yield* operationError(
            "not_configured",
            "The Jira authorization broker is unavailable in this server build.",
          );
        }
        const verifier = Encoding.encodeBase64Url(
          yield* crypto
            .randomBytes(32)
            .pipe(
              Effect.mapError(() =>
                operationError(
                  "authorization_failed",
                  "A Jira authorization state could not be created.",
                ),
              ),
            ),
        );
        const challenge = Encoding.encodeBase64Url(
          yield* crypto
            .digest("SHA-256", new TextEncoder().encode(verifier))
            .pipe(
              Effect.mapError(() =>
                operationError(
                  "authorization_failed",
                  "A Jira authorization state could not be created.",
                ),
              ),
            ),
        );
        const started = yield* oauth.startBroker({
          brokerUrl: config.brokerUrl,
          claimChallenge: challenge,
        });
        const expiresAtEpochMs = Date.parse(started.expiresAt);
        if (!Number.isFinite(expiresAtEpochMs) || expiresAtEpochMs <= now) {
          return yield* operationError(
            "authorization_failed",
            "The Jira authorization service returned an invalid expiration time.",
          );
        }
        yield* credentials.setPendingAuthorization(state, {
          redirectUri: input.redirectUri,
          expiresAtEpochMs,
          brokerSessionId: started.sessionId,
          verifier,
        });
        return {
          authorizationUrl: started.authorizationUrl,
          state,
          expiresAt: isoDate(expiresAtEpochMs),
          mode: "broker" as const,
        };
      }
      if (!config.clientId || !config.clientSecret) {
        return yield* operationError(
          "not_configured",
          "Configure the Jira OAuth broker or direct Atlassian OAuth credentials.",
        );
      }
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
        mode: "direct" as const,
      };
    });

  const complete: JiraAuthServiceShape["complete"] = (input) =>
    completeSemaphore.withPermit(
      Effect.gen(function* () {
        const config = yield* readConfig;
        const pending = yield* credentials.getPendingAuthorization(input.state);
        if (
          Option.isNone(pending) ||
          pending.value.redirectUri !== input.redirectUri ||
          pending.value.brokerSessionId !== undefined ||
          pending.value.verifier !== undefined ||
          config.clientId === undefined ||
          config.clientSecret === undefined
        ) {
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
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          code: input.code,
          redirectUri: input.redirectUri,
          nowEpochMs: now,
        });
        return yield* persistToken({ token, now, authMode: "direct" });
      }),
    );

  const claim: JiraAuthServiceShape["claim"] = (input) =>
    completeSemaphore.withPermit(
      Effect.gen(function* () {
        const config = yield* readConfig;
        if (config.brokerUrl === undefined || oauth.claimBroker === undefined) {
          return yield* operationError(
            "not_configured",
            "The Jira authorization broker is not configured for this server.",
          );
        }
        const pending = yield* credentials.getPendingAuthorization(input.state);
        if (
          Option.isNone(pending) ||
          pending.value.brokerSessionId === undefined ||
          pending.value.verifier === undefined
        ) {
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
        const result = yield* oauth.claimBroker({
          brokerUrl: config.brokerUrl,
          sessionId: pending.value.brokerSessionId,
          verifier: pending.value.verifier,
        });
        if (result.status === "pending") return result;

        yield* credentials.removePendingAuthorization(input.state);
        if (result.status === "failed") {
          return {
            status: "failed",
            error:
              result.error === "access_denied"
                ? "Jira authorization was cancelled or denied. Connect again when you are ready to grant access."
                : "Atlassian could not authorize Jira. Try connecting again.",
          };
        }
        const completed = yield* persistToken({
          token: result.credential,
          now,
          authMode: "broker",
        });
        return { status: "complete", connections: completed.connections };
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
              const refreshed =
                currentStored.value.authMode === "broker"
                  ? config.brokerUrl !== undefined && oauth.refreshBroker !== undefined
                    ? yield* oauth.refreshBroker({
                        brokerUrl: config.brokerUrl,
                        refreshToken: currentStored.value.refreshToken,
                        previousScope: currentStored.value.scope,
                        nowEpochMs: refreshNow,
                      })
                    : yield* operationError(
                        "oauth_exchange_failed",
                        "The Jira authorization broker is unavailable. Reconnect Jira.",
                      )
                  : config.clientId !== undefined && config.clientSecret !== undefined
                    ? yield* oauth
                        .refresh({
                          clientId: config.clientId,
                          clientSecret: config.clientSecret,
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
                        )
                    : yield* operationError(
                        "oauth_exchange_failed",
                        "Jira access could not be refreshed. Reconnect Jira.",
                      );
              yield* credentials.setCredential(
                credentialId,
                currentStored.value.authMode === undefined
                  ? refreshed
                  : { ...refreshed, authMode: currentStored.value.authMode },
              );
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

  return JiraAuthService.of({ begin, complete, claim, getAccessToken });
});

export const layer = Layer.effect(JiraAuthService, make);
