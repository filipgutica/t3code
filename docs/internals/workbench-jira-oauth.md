# Jira OAuth credential custody

Workbench authorizes Jira for a selected T3 environment. That environment keeps the durable grant and calls the Jira API. The Workbench client does not store Jira access or refresh tokens. OAuth has two modes; web and desktop change the callback route for direct mode, not the owner of the grant.

## Trust boundaries

| Material | Direct OAuth | Broker OAuth |
| --- | --- | --- |
| Atlassian client secret | The T3 server reads `T3_WORKBENCH_JIRA_CLIENT_SECRET` from its process environment. | The broker Worker reads `ATLASSIAN_CLIENT_SECRET` from its environment. T3 does not receive it. |
| Authorization code | Web receives it at `/workbench` and sends it to T3 through an authorized RPC. Desktop receives it at the selected T3 server's `/oauth/workbench/jira/callback`. | The broker receives it at `/oauth/jira/callback` and exchanges it with Atlassian. |
| Access and refresh tokens | T3 exchanges the code and stores the grant. | The broker holds the exchange result briefly; T3 claims and stores the grant. |
| Refresh | T3 sends its refresh token and client credentials to Atlassian. | T3 sends its refresh token to the broker; the broker uses its client credentials with Atlassian and returns replacement tokens. |
| Routine Jira API calls | T3 calls Jira directly. | T3 calls Jira directly; the broker is outside this path. |

[Explicit direct credentials take precedence](../../packages/workbench/src/jira/JiraAuthService.ts) when both modes are configured for a new authorization. A stored grant records its `authMode`, so an existing broker grant still uses the broker for refresh. The server's configuration supplies the current broker URL; the grant does not pin the URL that created it.

## Pending authorization

T3 creates a random local state and stores a pending record in its secret store. Direct mode stores the redirect URI and a ten-minute expiry. Completion checks the state, exact redirect URI, mode, and expiry. It removes the pending record before exchanging the code. Web then removes the callback parameters from the Workbench URL; desktop completes at the server's HTTP callback.

Broker mode adds a session ID and claim verifier to T3's pending record. T3 sends only the SHA-256 challenge of that verifier to the broker. The broker creates a separate OAuth state in the form `sessionId.nonce` for Atlassian and keeps its session for at most five minutes. On callback, it checks the nonce, exchanges the code, and waits for a claim. T3 presents the verifier when it claims the result. This verifier protects the broker-to-T3 handoff; it is not an OAuth PKCE challenge sent to Atlassian.

The web client keeps the selected environment and workspace in `sessionStorage` during the redirect. For broker mode, it also keeps T3's local state and expiry so it can resume polling after a reload. It receives neither the claim verifier nor Jira tokens. The desktop client opens the system browser and uses the same selected environment for completion. [Client flow](../../apps/web/src/workbench/useWorkbenchJiraAuthorization.ts) and [broker session](../../infra/workbench-auth/src/session.ts) define these boundaries.

## Tokens at rest

T3 stores a grant as JSON containing the access token, nullable refresh token, scope, expiry, and optional `authMode`. The server adapter writes it to `<stateDir>/secrets/workbench-jira-credential-<credentialId>.bin`. Pending records use `workbench-jira-oauth-state-<state>.bin` in the same directory. `ServerSecretStore` sets the directory mode to `0700` and each file to `0600`. It writes the JSON bytes without application encryption or an OS keychain. The `.bin` suffix does not imply encryption. The environment's SQLite database stores Jira site metadata and the credential ID reference, not the token values. One grant can back several accessible-site connections. [Credential adapter](../../apps/server/src/workbench/jira/JiraCredentialStore.ts), [file store](../../apps/server/src/auth/ServerSecretStore.ts), and [connection schema](../../packages/workbench/src/WorkbenchSchema.ts) own these details.

The broker stores a completed authorization only in its short-lived session. It encrypts the token values with AES-GCM using `SESSION_ENCRYPTION_KEY`, a fresh IV, and the session ID as authenticated additional data. Session ID, challenge, nonce, expiry, and status are session metadata rather than part of that encrypted token value. A successful claim decrypts the tokens, clears the broker session, and returns them to T3. Expiry is checked on requests, and an alarm removes expired sessions. The broker can read plaintext during exchange, claim, and refresh; this encryption protects its stored handoff, not tokens from the broker itself. [Broker encryption](../../infra/workbench-auth/src/protocol.ts) and [claim lifecycle](../../infra/workbench-auth/src/session.ts) implement this behavior.

## Refresh and replacement

T3 refreshes on demand when an access token has at most 60 seconds remaining. Refresh is serialized per credential because several Jira sites may share one rotating refresh token. T3 overwrites the credential file with the replacement grant. Broker refresh sends the refresh token to the Worker for a stateless exchange; it does not create a broker session. [Refresh path](../../packages/workbench/src/jira/JiraAuthService.ts) selects the backend from the stored auth mode.

Reconnecting an accessible site preserves its connection ID and updates its credential reference. After repointing the returned sites, T3 removes an old credential file only when no connection still references it. If a direct exchange or later persistence step fails after state consumption, the user must begin again. A broker claim clears its session before T3 persists the returned tokens, so an interrupted handoff can also require reconnection. Current Jira RPCs have no disconnect or Atlassian revocation operation. Local pending files are checked for expiry when used, but this flow does not schedule cleanup for abandoned files. [Connection replacement](../../packages/workbench/src/jira/JiraAuthService.ts) and [RPC methods](../../packages/contracts/src/workbenchRpc.ts) show these limits.
