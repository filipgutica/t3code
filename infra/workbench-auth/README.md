# Workbench authentication service

This Worker brokers Jira authorization for Workbench installations. The Atlassian
app secret stays in Cloudflare. Each T3 environment keeps its own Jira credentials
and makes its own Jira API requests.

The Worker is separate from T3 Connect. Deploying it does not connect the current
Workbench client; that client integration is a separate change.

## Configure the Atlassian app

Create an OAuth 2.0 integration in the [Atlassian developer console](https://developer.atlassian.com/console/myapps/).
Use resource-level access and configure the Jira scopes declared in the Worker.
Register this exact callback, replacing the origin with your deployed Worker:

```text
https://workbench-auth.<subdomain>.workers.dev/oauth/jira/callback
```

The fork's configured production callback is
`https://workbench-auth.fgutica.workers.dev/oauth/jira/callback`.

Enable sharing before testing with users other than the app owner. Atlassian can
display an unapproved-integration warning until the app has been reviewed.

## Configure Cloudflare

Use separate Worker deployments and Atlassian applications for development and
production. Do not copy production credentials into tests.

In the Worker's **Settings → Variables and Secrets**, configure:

| Name                      | Type     | Value                                                   |
| ------------------------- | -------- | ------------------------------------------------------- |
| `PUBLIC_BASE_URL`         | Variable | The Worker's HTTPS origin, without a trailing path.     |
| `ATLASSIAN_CLIENT_ID`     | Variable | The OAuth application's client ID.                      |
| `ATLASSIAN_CLIENT_SECRET` | Secret   | The OAuth application's client secret.                  |
| `SESSION_ENCRYPTION_KEY`  | Secret   | A base64-encoded, cryptographically random 32-byte key. |

Keep secrets out of source control, command arguments, screenshots, and logs.
Configure them through the Cloudflare dashboard or Wrangler's interactive secret
commands. Local `.dev.vars` files are ignored by Git.

Run these commands from the repository root:

```sh
pnpm --filter t3code-workbench-auth test
pnpm --filter t3code-workbench-auth typecheck
pnpm --filter t3code-workbench-auth deploy
```

The deployment command changes the live Worker. Wrangler must be logged into the
intended account with Worker script permissions. Its device login works from a
phone:

```sh
pnpm dlx wrangler@4.131.0 login --device --browser=false --scopes account:read user:read workers:write workers_scripts:write
```

After deployment, request `/health` to check whether configuration is complete.
A healthy process does not prove that Atlassian accepts the configured client
credentials; verify a real consent and token refresh separately.

## Operational boundaries

Authorization results are temporary. The originating T3 server must claim them
before the session expires. A completed claim removes the stored result; if its
network response is lost, the user must reconnect.

Changing the session encryption key invalidates outstanding encrypted handoffs.
Existing credentials in T3 environments are not encrypted with that key.

Do not enable request logging that captures OAuth callback query strings or token
request bodies. Use safe status codes and aggregate metrics for diagnostics.

## References

- [Atlassian OAuth and distribution](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
