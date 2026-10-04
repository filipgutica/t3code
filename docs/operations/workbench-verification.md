# Verifying Agent Workbench

Use this guide to understand which Workbench checks CI runs and what their
results establish. The linked workflow files own CI triggers and commands; the
script guides own local setup and fixture maintenance. On PRs, most Workbench
workflows start only when changed paths match their filters. The live lane
also runs daily and supports manual dispatch. The PR preview uses PR lifecycle
events for eligible owner PRs, including docs-only updates.

## CI coverage and triggers

[Workbench CI](../../.github/workflows/workbench-ci.yml) checks every PR and `main` push, including the native server, web, desktop build, shared packages, and release smoke checks. Its generated `Workbench Check` result retains the upstream gates. The package boundary/typecheck, desktop smoke for upstream syncs, browser regressions, and private preview checks below remain separate.

Upstream-only mobile delivery and fingerprint checks, relay deployment, release trains, macOS preview publication, and Cursor hygiene are archived outside GitHub's workflow directory. They do not queue runs in this fork. [CI ownership](../internals/workbench-fork.md#ci-ownership) explains the retained sources and upstream-sync review requirement.

| Check                                                                        | When it starts                                                                                                                 | What a pass establishes                                                                                    | Boundary                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [Workbench quality](../../.github/workflows/workbench-quality.yml)           | PR or `main` push with Workbench, package, or quality-tool changes; manual dispatch                                            | Package typecheck and boundary, tests, and quality gates pass. Upstream-sync PRs also get a desktop smoke. | No Workbench browser journey or hosted preview                    |
| [Demo kit](../../.github/workflows/workbench-demo.yml)                       | PR or `main` push with demo scripts, demo skill, or contract changes                                                           | Demo CLI, types, lint, tests, and shell syntax pass                                                        | No rendered Board or deployed environment                         |
| [Local browser regression](../../.github/workflows/workbench-regression.yml) | PR with web, server, package, demo, or regression changes; manual dispatch                                                     | Three Playwright shards and SQL-backed Jira lifecycle tests pass against the checkout                      | Provider responses are scripted; Jira UI responses are controlled |
| [Live regression](../../.github/workflows/workbench-regression-live.yml)     | Eligible owner PR with Workbench changes; daily schedule; manual dispatch                                                      | Selected browser flows pass against a dedicated Jira baseline and public GitHub repositories               | Provider responses remain scripted; the lane does not test Vercel |
| [Preview checks](../../.github/workflows/workbench-preview-check.yml)        | PR with preview scripts, launcher, local seed, or preview-workflow changes                                                     | Launcher tests, Linux build, native pairing, seeded state, and crash recovery pass locally                 | No Vercel routing or browser interaction                          |
| [PR preview](../../.github/workflows/workbench-preview.yml)                  | When previews are enabled: eligible owner PR opened, reopened, or updated; manual dispatch. Closing the PR retires its bundle. | Exact PR build and native smoke pass before protected publication from `main`                              | A published link alone does not prove the hosted Board works      |

These are trigger summaries; each linked workflow has the exact path filters and
job conditions. A PR's Checks tab shows the runs that started for that revision.
CI does not run every row for every PR. For example, a change
confined to `scripts/workbench-preview/` triggers preview checks and an eligible
owner's PR preview, but not browser regression.

The separate [hosted web preview](../../.github/workflows/web-preview.yml) runs
for same-repository PRs labelled `preview:web`. It deploys only the web client:
open the exact URL from its PR comment and pair a reachable T3 server. The
private Workbench PR demo instead launches a temporary Sandbox with seeded state.

[Workbench Pages](../../.github/workflows/workbench-pages.yml) checks the static showcase when its inputs change and deploys it after a matching `main` push. [Workbench desktop release](../../.github/workflows/workbench-release.yml) remains manual, with build-only and draft-release modes. Issue labels, PR size, contributor vouching, and Workbench thread-transfer reports remain active repository tooling.

The [hosted browser smoke](../../scripts/workbench-preview/README.md#hosted-browser-smoke)
is a separate manual check. It covers protected launch, automatic pairing, a
rendered seed, and one persisted Board write after reload. It does not cover
Sandbox expiry, separate-launch isolation, Jira, or provider execution. CI has
no reviewer Vercel login session, and the publisher rejects protection bypasses.

The PR preview workflow accepts only repository-owner PRs from this repository.
Its build runs PR code without integration credentials. Its separate publication
job uses a selected `main` controller commit and deployment credentials.

## Follow the state

The default browser fixture creates a temporary T3 home, seeds repositories and
Workbench records through native RPCs, starts the current checkout's server,
and pairs Chromium. Web, server, WebSocket, SQLite, and Git are real. The scripted
provider and controlled Jira responses make the default lane repeatable. Each
test gets a fresh browser page and context, but the server, database, and paired
storage are worker-scoped. Tests on one shard can observe earlier writes; CI
shards run in separate jobs. The [regression guide](../../scripts/workbench-regression/README.md)
explains the fixture and failure traces.

The live lane uses one dedicated Jira baseline and rotates its OAuth grant.
Its workflow serializes runs against that shared remote state and restores the
baseline after tests. Use the [demo guide](../../scripts/workbench-demo/README.md)
to update synthetic records or prepare a human demo. Keep existing fixture IDs
when editing titles or moving rows, because tests and prepared worktrees refer
to those IDs.

For one complete path, read the [Board search test](../../scripts/workbench-regression/board-search.spec.ts)
and its [worker fixture](../../scripts/workbench-regression/fixtures.ts). The
fixture calls the [baseline seed](../../scripts/workbench-demo/local.mts), which
creates `orbit-001` through Workbench RPC. The [Board filter](../../apps/web/src/workbench/WorkbenchTicketBoard.tsx)
uses the search query. The test checks the rendered card count, empty state,
and unchanged Ticket statuses.

Each fresh hosted demo has its own temporary Sandbox filesystem. Jira starts
disconnected. Local state expires with the Sandbox; writes to a service that a
reviewer later connects can persist outside it. The [preview guide](../../scripts/workbench-preview/README.md)
owns deployment setup, protection, and the hosted check.

## Track the revision and evidence

The `pull_request_target` preview workflow runs its controller from `main`. It
selects the PR head and one `main` controller commit. The
application, startup, fixtures, and native smoke come from the PR. The Docker
configuration, bundle export, publisher, and protected launcher come from that
controller commit. The build job has no integration credentials. Check both
revisions in the preview comment before attributing a result to a change.

For a failing browser regression, open the shard's `.test-results/` artifact for
screenshots and traces. The live workflow uploads the same evidence on failure.
Temporary Actions build artifacts expire after one day. The workflow keeps one
published bundle per open PR and retires it when the PR closes. A successful run
proves its named checks at its recorded revision. It does not establish a flake
rate. Investigate repeat failures on the same revision before measuring reliability.
