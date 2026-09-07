import { WorkbenchJiraOperationError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const JiraOAuthCredential = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.NullOr(Schema.String),
  scope: Schema.String,
  expiresAtEpochMs: Schema.Number,
});
export type JiraOAuthCredential = typeof JiraOAuthCredential.Type;

export const PendingJiraAuthorization = Schema.Struct({
  redirectUri: Schema.String,
  expiresAtEpochMs: Schema.Number,
});
export type PendingJiraAuthorization = typeof PendingJiraAuthorization.Type;

export interface JiraCredentialStoreShape {
  readonly getCredential: (
    credentialId: string,
  ) => Effect.Effect<Option.Option<JiraOAuthCredential>, WorkbenchJiraOperationError>;
  readonly setCredential: (
    credentialId: string,
    credential: JiraOAuthCredential,
  ) => Effect.Effect<void, WorkbenchJiraOperationError>;
  readonly removeCredential: (
    credentialId: string,
  ) => Effect.Effect<void, WorkbenchJiraOperationError>;
  readonly getPendingAuthorization: (
    state: string,
  ) => Effect.Effect<Option.Option<PendingJiraAuthorization>, WorkbenchJiraOperationError>;
  readonly setPendingAuthorization: (
    state: string,
    pending: PendingJiraAuthorization,
  ) => Effect.Effect<void, WorkbenchJiraOperationError>;
  readonly removePendingAuthorization: (
    state: string,
  ) => Effect.Effect<void, WorkbenchJiraOperationError>;
}

/**
 * The package owns this interface and its wire-safe schemas. The server owns
 * the implementation because credentials are persisted through its secret
 * store.
 */
export class JiraCredentialStore extends Context.Service<
  JiraCredentialStore,
  JiraCredentialStoreShape
>()("@t3tools/workbench/jira/JiraCredentialStore") {}
