# Workbench authentication service

This Worker brokers Jira authorization for Workbench installations. The Atlassian
app secret stays in Cloudflare. Each T3 environment keeps its own Jira credentials
and makes its own Jira API requests.

The Worker is separate from T3 Connect. Each Workbench environment must connect
Jira once through its client. Ordinary local development can use the deployed
worker; see [demo configuration](../../scripts/workbench-demo/README.md#broker-configuration-outside-the-wizard).

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

The Worker requests these 11 scopes. Keep this list in sync with `JIRA_SCOPES` in
`infra/workbench-auth/src/protocol.ts` and `JIRA_OAUTH_SCOPES` in
`packages/workbench/src/jira/JiraOAuthClient.ts`.

| Scope                                  | Used for                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `read:project:jira`                    | List projects and read the project data needed to choose a board.                |
| `read:jira-work`                       | Read Jira project and issue data, including issue searches.                      |
| `write:jira-work`                      | Create issues, edit descriptions, and apply issue transitions.                   |
| `read:board-scope:jira-software`       | List boards that the connected user can view.                                    |
| `read:board-scope.admin:jira-software` | Read board configuration and its columns.                                        |
| `read:sprint:jira-software`            | List selected sprints and read issues in those sprints.                          |
| `read:issue-details:jira`              | Read issue fields and Epic details returned by Jira Software.                    |
| `read:jql:jira`                        | Run the assigned-user JQL used to mirror sprint issues.                          |
| `read:jira-user`                       | Read the connected account ID from `/rest/api/3/myself` for new issue assignees. |
| `write:sprint:jira-software`           | Move a newly created issue into the selected sprint.                             |
| `offline_access`                       | Refresh access tokens without asking the user to sign in again.                  |

The scope names control what the integration may request. They do not grant the
connected Jira user access to projects or issues. The user still needs the Jira
project permissions required by each operation, such as Browse projects and
Create issues for creation, Assign Issues when assigning, Edit issues for
description changes, and Transition issues for status changes. Atlassian's
[Jira product scope reference](https://developer.atlassian.com/platform/forge/manifest-reference/scopes-product-jira/)
and [Jira Software scope reference](https://developer.atlassian.com/platform/forge/manifest-reference/scopes-product-jsw/)
describe the OAuth scopes separately from Jira permissions.

## Configure Cloudflare

When developing the broker itself, use a separate Worker deployment and Atlassian
app. Ordinary Workbench development and the live regression suite use the deployed
broker with disposable Jira accounts. The Atlassian client secret stays in the
worker; local environments and CI receive only their own OAuth grants.

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
- [Jira product OAuth scopes](https://developer.atlassian.com/platform/forge/manifest-reference/scopes-product-jira/)
- [Jira Software OAuth scopes](https://developer.atlassian.com/platform/forge/manifest-reference/scopes-product-jsw/)
- [Jira Cloud REST API: projects](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/)
- [Jira Software Cloud REST API: boards and sprints](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/)
- [Jira Cloud REST API: issues](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/)
- [Jira Cloud REST API: current user](https://developer.atlassian.com/cloud/jira/platform/rest/v2/api-group-myself/)
- [Atlassian OAuth refresh token flow](https://developer.atlassian.com/cloud/oauth/getting-started/refresh-tokens/)
- [Jira project permission reference](https://support.atlassian.com/jira-cloud-administration/docs/permissions-for-company-managed-projects/)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
