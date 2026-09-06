import { WorkbenchJiraOperationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import {
  JiraCredentialStore,
  JiraOAuthCredential,
  PendingJiraAuthorization,
} from "@t3tools/workbench/jira/JiraCredentialStore";

export {
  JiraCredentialStore,
  JiraOAuthCredential,
  PendingJiraAuthorization,
} from "@t3tools/workbench/jira/JiraCredentialStore";

const credentialCodec = Schema.fromJsonString(JiraOAuthCredential);
const pendingAuthorizationCodec = Schema.fromJsonString(PendingJiraAuthorization);
const encodeCredential = Schema.encodeEffect(credentialCodec);
const decodeCredential = Schema.decodeUnknownEffect(credentialCodec);
const encodePendingAuthorization = Schema.encodeEffect(pendingAuthorizationCodec);
const decodePendingAuthorization = Schema.decodeUnknownEffect(pendingAuthorizationCodec);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const credentialSecretName = (credentialId: string) => `workbench-jira-credential-${credentialId}`;
const authorizationSecretName = (state: string) => `workbench-jira-oauth-state-${state}`;

const persistenceError = (message: string) =>
  new WorkbenchJiraOperationError({ code: "persistence_failed", message });

export const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;

  const read = <A>(
    name: string,
    decode: (input: string) => Effect.Effect<A, Schema.SchemaError>,
  ): Effect.Effect<Option.Option<A>, WorkbenchJiraOperationError> =>
    secrets.get(name).pipe(
      Effect.mapError(() => persistenceError("Jira credentials could not be read.")),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(Option.none()),
          onSome: (bytes) =>
            decode(decoder.decode(bytes)).pipe(
              Effect.map(Option.some),
              Effect.mapError(() => persistenceError("Stored Jira credentials are invalid.")),
            ),
        }),
      ),
    );

  const write = <A>(
    name: string,
    value: A,
    encode: (input: A) => Effect.Effect<string, Schema.SchemaError>,
  ): Effect.Effect<void, WorkbenchJiraOperationError> =>
    encode(value).pipe(
      Effect.mapError(() => persistenceError("Jira credentials could not be encoded.")),
      Effect.flatMap((serialized) => secrets.set(name, encoder.encode(serialized))),
      Effect.mapError(() => persistenceError("Jira credentials could not be saved.")),
    );

  const remove = (name: string) =>
    secrets
      .remove(name)
      .pipe(Effect.mapError(() => persistenceError("Jira credentials could not be removed.")));

  return JiraCredentialStore.of({
    getCredential: (credentialId) => read(credentialSecretName(credentialId), decodeCredential),
    setCredential: (credentialId, credential) =>
      write(credentialSecretName(credentialId), credential, encodeCredential),
    removeCredential: (credentialId) => remove(credentialSecretName(credentialId)),
    getPendingAuthorization: (state) =>
      read(authorizationSecretName(state), decodePendingAuthorization),
    setPendingAuthorization: (state, pending) =>
      write(authorizationSecretName(state), pending, encodePendingAuthorization),
    removePendingAuthorization: (state) => remove(authorizationSecretName(state)),
  });
});

export const layer = Layer.effect(JiraCredentialStore, make);
