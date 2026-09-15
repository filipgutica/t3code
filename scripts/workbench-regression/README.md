# Workbench regression suite

Run browser regressions against an isolated Orbit/Beacon demo:

```sh
cd scripts
vp exec playwright install chromium
vp exec playwright test --config workbench-regression/playwright.config.ts
```

The fixture uses the same reset implementation as the demo wizard. It creates a
separate home, starts the current checkout, pairs the browser, seeds repositories
and Workbench data, and stops its server after the tests. It does not use your
installed T3 home. Failed runs retain screenshots and traces in `.test-results/`.

## Two lanes

The default lane needs no external credentials. A scripted Codex executable
exercises the real provider adapter, Thread lifecycle, and summary generation
with fixed responses and controlled failures. Jira UI tests replace Jira RPC
responses while retaining the real Workbench UI and local data. These tests do
not establish live Jira connectivity.

The live lane uses the public repositories pinned in
`../workbench-demo/repositories.mts`, the saved ORBIT sprint baseline, real Jira
REST calls, and a preconnected Workbench OAuth grant. The API token resets and
checks fixtures; Workbench uses OAuth for its own Jira operations. Provider
responses remain scripted. Interactive Atlassian login is outside this suite.

| Area            | Current browser coverage                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Planning        | Workspace creation/rename, Ticket editing/status/archive/restore/delete, Epic membership/progress, routes and narrow layout               |
| Provider        | Full Ticket context sent to a native Thread, completed turn, summary failure/retry, retained worktrees                                    |
| Jira connection | First import, progress, failure/retry, empty results, local-data choice/cancel, publish retry, imported-only Board                        |
| Live Jira       | Sprint imports, mapped/mirrored columns, pause/resume, issue creation, description/status writes, start-work transition, refresh identity |
| Live GitHub     | Existing public PR linking/unlinking and detail tabs                                                                                      |

This is not complete automation of the manual checklist. Sprint rollover,
multi-sprint changes, all provider approval states, and the full PR lifecycle
still need additional browser scenarios.

## GitHub Actions setup

The default workflow runs on relevant pull requests. The live workflow runs for
repository-owner pull requests from this repository, manual dispatches, and the
daily schedule. Fork pull requests cannot run the live job. Live runs share one
concurrency group because they modify the same ORBIT sprint.

Configure these repository Actions secrets:

- `DEMO_JIRA_EMAIL` and `DEMO_JIRA_API_TOKEN`: classic API-token credentials for
  the disposable Jira account.
- `DEMO_JIRA_BASELINE`: the JSON captured by `capture-baseline` in the demo CLI.
- `DEMO_CREDENTIALS_TOKEN`: a fine-grained GitHub PAT restricted to this repository
  with **Environments: read and write** so CI can preserve refreshed credentials.

Set `DEMO_JIRA_SITE_URL`, `DEMO_JIRA_PROJECT_KEY`, and `DEMO_JIRA_BOARD_ID` as
repository Actions variables or secrets. The workflow accepts either.

Create the `workbench-demo` GitHub environment and save
`DEMO_JIRA_OAUTH_BUNDLE` as an **environment secret**. Environment secrets are read
when a job starts, allowing a queued live run to receive credentials refreshed by
the preceding run. Repository secrets are read earlier, when a run is queued.
Do not keep a separate actively used copy of this OAuth grant in a local demo;
concurrent refreshes can invalidate one another.

Export a bundle from a stopped, connected demo:

```sh
node scripts/workbench-demo/cli.mts export-jira-auth --home "$DEMO_HOME" --output /tmp/demo-jira-oauth
gh secret set DEMO_JIRA_OAUTH_BUNDLE --repo filipgutica/t3code --env workbench-demo < /tmp/demo-jira-oauth
```

The workflow uses the hosted Workbench OAuth broker. It does not need the
Atlassian client ID or client secret in Actions. It checks secret-write access
before refreshing credentials and saves the rotated bundle after stopping the
server, including after a test failure. A killed runner can still lose the latest
refresh token; reconnect and export a new bundle if that occurs.
