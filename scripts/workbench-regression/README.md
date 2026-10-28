# Workbench regression suite

See [Workbench verification](../../docs/operations/workbench-verification.md)
to see when CI runs each lane and what each result proves.

Run browser regressions against an isolated Orbit/Beacon demo. The suite runs the
built server and its bundled web client, as users do, so build first and rebuild
after changing app code:

```sh
T3CODE_WORKBENCH_BUILD=1 vp run --filter t3 build
cd scripts
vp exec playwright install chromium
vp exec playwright test --config workbench-regression/playwright.config.ts
```

The fixture uses the same reset implementation as the demo wizard. It creates a
separate home, starts the built server, pairs the browser, seeds repositories
and Workbench data, and stops its server after the tests. It does not use your
installed T3 home. Failed runs retain screenshots and traces in `.test-results/`.

## Two lanes

The default lane needs no external credentials. A scripted Codex executable
exercises the real provider adapter, Thread lifecycle, and summary generation
with fixed responses and controlled failures.

The live lane uses the public repositories pinned in
`../workbench-demo/repositories.mts` and reads their pull requests through the
real GitHub CLI. Provider responses remain scripted.

| Area        | Current browser coverage                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Planning    | Workspace creation/rename, Ticket editing/status/archive/restore/delete, Epic membership/progress, routes and narrow layout    |
| Provider    | Ticket instruction with brief and worktrees sent to a native Thread, completed turn, summary failure/retry, retained worktrees |
| Live GitHub | Existing public PR linking/unlinking and detail tabs                                                                           |

The [manual checklist](../../.agents/skills/workbench-regression-checklist/SKILL.md)
remains the broader acceptance guide. Gaps include draft/cancel races, drag and drop,
Thread archive/delete/attach, complete workspace reset, multi-repository branch
assertions, reconnect/permission failures, provider approval states, full PR
lifecycle, and desktop.

Browser tests share one server per serial run. Each run starts from the baseline.
GitHub branches and PRs are read, not reset. The public Orbit revisions are pinned;
Beacon repositories are synthetic. Temporary homes remain available for diagnosis.
Snapshot checks reuse one short-lived RPC credential per worker, while each check
still reads current server state. The credential is revoked before server shutdown.
Each CI workflow builds the server once and its regression jobs download that
build. The upstream-sync workflow reuses the build from its desktop verification.

## GitHub Actions setup

The default workflow runs on relevant pull requests. The live workflow runs for
repository-owner pull requests from this repository, manual dispatches, and the
daily schedule. Fork pull requests cannot run the live job. Live runs share one
concurrency group because they read the same demo repositories.

Configure `DEMO_CREDENTIALS_TOKEN` as a repository or `workbench-demo` environment
secret. It is a GitHub token with read access to the demo repositories. Native PR discovery needs
a signed-in user, and the Actions token has no `/user` login.

## Local demo and live runs

Use the [demo wizard](../workbench-demo/README.md) for interactive testing. It uses
the same `reset-baseline` path as this suite and can retain a real provider.
The regression fixture substitutes scripted provider responses when it starts.

The default command above is suitable for everyday local checks. To run the live
lane locally, sign in with `gh auth login` and set `WORKBENCH_REGRESSION_LIVE=1`.
