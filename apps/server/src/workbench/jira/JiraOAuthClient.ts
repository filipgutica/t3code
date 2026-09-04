import { WorkbenchJiraOperationError, type WorkbenchJiraSite } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import type { JiraOAuthCredential } from "./JiraCredentialStore.ts";

const ATLASSIAN_AUTHORIZE_URL = "https://auth.atlassian.com/authorize";
const ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const ATLASSIAN_ACCESSIBLE_RESOURCES_URL =
  "https://api.atlassian.com/oauth/token/accessible-resources";

export const JIRA_OAUTH_SCOPES = [
  "read:project:jira",
  "read:jira-work",
  "read:board-scope:jira-software",
  "read:board-scope.admin:jira-software",
  "read:sprint:jira-software",
  "read:issue-details:jira",
  "read:jql:jira",
  "offline_access",
] as const;

const OAuthTokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optionalKey(Schema.String),
  expires_in: Schema.Number,
  scope: Schema.optionalKey(Schema.String),
});

const AccessibleResource = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  scopes: Schema.Array(Schema.String),
  avatarUrl: Schema.optionalKey(Schema.String),
});
const AccessibleResources = Schema.Array(AccessibleResource);

export interface JiraOAuthClientShape {
  readonly exchangeCode: (input: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly code: string;
    readonly redirectUri: string;
    readonly nowEpochMs: number;
  }) => Effect.Effect<JiraOAuthCredential, WorkbenchJiraOperationError>;
  readonly refresh: (input: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly refreshToken: string;
    readonly previousScope: string;
    readonly nowEpochMs: number;
  }) => Effect.Effect<JiraOAuthCredential, WorkbenchJiraOperationError>;
  readonly listAccessibleSites: (
    accessToken: string,
  ) => Effect.Effect<ReadonlyArray<WorkbenchJiraSite>, WorkbenchJiraOperationError>;
}

export class JiraOAuthClient extends Context.Service<JiraOAuthClient, JiraOAuthClientShape>()(
  "t3/workbench/jira/JiraOAuthClient",
) {}

export function buildJiraAuthorizationUrl(input: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
}): string {
  const url = new URL(ATLASSIAN_AUTHORIZE_URL);
  url.searchParams.set("audience", "api.atlassian.com");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", JIRA_OAUTH_SCOPES.join(" "));
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

const requestError = (code: "oauth_exchange_failed" | "authorization_failed", message: string) =>
  new WorkbenchJiraOperationError({ code, message });

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;

  const execute = <S extends Schema.Top>(input: {
    readonly request: HttpClientRequest.HttpClientRequest;
    readonly schema: S;
    readonly code: "oauth_exchange_failed" | "authorization_failed";
    readonly message: string;
  }): Effect.Effect<S["Type"], WorkbenchJiraOperationError, S["DecodingServices"]> =>
    httpClient.execute(input.request.pipe(HttpClientRequest.acceptJson)).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(input.schema)),
      Effect.mapError(() => requestError(input.code, input.message)),
    );

  const exchangeToken = (input: {
    readonly body: Record<string, string>;
    readonly previousScope?: string;
    readonly nowEpochMs: number;
  }) =>
    execute({
      request: HttpClientRequest.post(ATLASSIAN_TOKEN_URL).pipe(
        HttpClientRequest.bodyJsonUnsafe(input.body),
      ),
      schema: OAuthTokenResponse,
      code: "oauth_exchange_failed",
      message: "Jira authorization could not be completed.",
    }).pipe(
      Effect.map(
        (response) =>
          ({
            accessToken: response.access_token,
            refreshToken: response.refresh_token ?? input.body.refresh_token ?? null,
            scope: response.scope ?? input.previousScope ?? "",
            expiresAtEpochMs: input.nowEpochMs + response.expires_in * 1_000,
          }) satisfies JiraOAuthCredential,
      ),
    );

  return JiraOAuthClient.of({
    exchangeCode: (input) =>
      exchangeToken({
        body: {
          grant_type: "authorization_code",
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
        },
        nowEpochMs: input.nowEpochMs,
      }),
    refresh: (input) =>
      exchangeToken({
        body: {
          grant_type: "refresh_token",
          client_id: input.clientId,
          client_secret: input.clientSecret,
          refresh_token: input.refreshToken,
        },
        previousScope: input.previousScope,
        nowEpochMs: input.nowEpochMs,
      }),
    listAccessibleSites: (accessToken) =>
      execute({
        request: HttpClientRequest.get(ATLASSIAN_ACCESSIBLE_RESOURCES_URL).pipe(
          HttpClientRequest.bearerToken(accessToken),
        ),
        schema: AccessibleResources,
        code: "authorization_failed",
        message: "Accessible Jira sites could not be loaded.",
      }).pipe(
        Effect.map((resources) =>
          resources.map(
            (resource) =>
              ({
                cloudId: resource.id,
                name: resource.name,
                url: resource.url,
                avatarUrl: resource.avatarUrl ?? null,
                scopes: resource.scopes,
              }) satisfies WorkbenchJiraSite,
          ),
        ),
      ),
  });
});

export const layer = Layer.effect(JiraOAuthClient, make);
