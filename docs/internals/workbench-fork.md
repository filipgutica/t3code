# Maintaining the Agent Workbench fork

The fork keeps T3 Code as the owner of execution and adds Workbench planning in an isolated overlay. Upstream changes enter the product branch through verified merge pull requests. Start with [Workbench architecture](workbench-architecture.md) for module boundaries and request flow, or [Workbench data model](workbench-data-model.md) for storage ownership.

## Isolation boundary

| Source                                    | Ownership rule                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/workbench`                      | Own Workbench domain rules, schema, persistence, Ticket Workspace lifecycle, and Jira logic. Do not import applications, including through test helpers. |
| `apps/server/src/workbench`               | Adapt Workbench to native Project and Thread projections, Git, configuration, credentials, authorization, and server composition.                        |
| `apps/web/src/workbench`                  | Compose the React Workbench UI. Keep native T3 Threads as the conversation experience.                                                                   |
| Workbench modules in `packages/contracts` | Own wire schemas and RPC contracts. Keep shared T3 integrations thin.                                                                                    |
| `apps/desktop/src/workbench`              | Own fork distribution policy; do not point Workbench at the upstream updater.                                                                            |

Workbench stores references to native `ProjectId` and `ThreadId` values rather than copying T3 records. Its package shares the server process and database with T3, but owns a separate `workbench_schema_migrations` ledger. Server adapters supply native reads and host effects through typed services. Native reads that participate in Workbench writes must use the caller's SQL client and transaction; a separate connection or preloaded snapshot can break writer-lock ordering and ownership checks. [Architecture](workbench-architecture.md) and [data model](workbench-data-model.md) explain the boundary.

Before changing an upstream-owned file, check whether a Workbench adapter or extension point can own the behavior. Keep any remaining integration small and preserve behavior outside Workbench. [Ticket lifecycle](workbench-ticket-lifecycle.md), [Jira mirrors](workbench-jira-mirror.md), and [Jira OAuth custody](workbench-jira-oauth.md) describe the fork-owned behavior that crosses native or external boundaries.

## Package checks

Run the focused checks from the repository root when their scope applies:

```sh
vp run --filter @t3tools/workbench typecheck
vp run --filter @t3tools/workbench test
vp run workbench:quality
```

The typecheck includes the [package boundary check](../../packages/workbench/check-boundary.mjs). The [quality workflow](../../.github/workflows/workbench-quality.yml) runs the package checks and production quality gates. Tests for native migration integration stay in the server; independent package tests use package-owned fixtures. Read the current scripts and workflow for their exact gates rather than treating this page as a second configuration source.

## CI ownership

Keep `.github/workflows/ci.yml` and `thread-transfer-report.yml` identical to the upstream versions integrated into the product. [The generator](../../scripts/workbench-ci.ts) derives `workbench-ci.yml` with GitHub runners and fork execution limits while retaining upstream jobs and their checks. It derives the report workflow with a `Workbench CI` subscription, retaining the trusted publisher. Regenerate both after merging upstream; the sync workflow does this before committing its candidate. Unsupported upstream runner or workflow structures stop generation for review.

For the initial cutover, finish local verification, then disable the upstream **CI** workflow through GitHub's repository settings **before publishing the branch that restores its upstream runner configuration**. Confirm **Workbench CI** passes on the PR's current head before merging, and replace any required `Check` rule with `Workbench Check` without weakening branch protection. If verification fails, the existing main-branch CI can be re-enabled while it still uses GitHub runners. The generated report workflow starts receiving runs once it is on the default branch; its first main run establishes a new baseline.

The disabled CI setting lives outside Git and must remain disabled: retaining the file preserves upstream ownership, but enabling it after cutover would queue Blacksmith jobs in this fork. Generated job names have a `Workbench` prefix to avoid ambiguous checks. Keep Workbench quality, regression, preview, and release workflows separate.

## Upstream sync

The fork's `main` in `filipgutica/t3code` is the long-lived product branch. In this clone, `origin` points to the fork and `upstream` to `pingdotgg/t3code`. Preview a sync before merging:

```sh
git fetch upstream main
node scripts/workbench-upstream-sync.ts --product main --upstream upstream/main
```

The preview is read-only. It reports ancestry, files changed on both sides, and merge-tree conflicts. The [sync workflow](../../.github/workflows/workbench-upstream-sync.yml) builds and checks a candidate merge, then opens or updates a PR against the fork's current base. Its write step publishes only the verified two-parent merge commit after checking the exact base and head. A PR created by `GITHUB_TOKEN` does not start another workflow run, so the sync workflow's focused gates are its verification boundary.

```mermaid
flowchart LR
    A[Fetch upstream] --> B[Preview and resolve]
    B --> C[Verify candidate merge]
    C --> D[Open sync PR]
    D --> E[Merge commit]
    E --> F[Check upstream ancestry]
```

Merge an upstream-sync PR with **Create a merge commit** or `gh pr merge --merge`. Squash and rebase discard upstream ancestry and make later syncs revisit already-integrated changes. After merging, use the exact upstream SHA recorded by that sync:

```sh
git fetch origin main
git merge-base --is-ancestor "$SYNCED_UPSTREAM_SHA" origin/main
```

Exit code zero confirms that the recorded upstream commit is an ancestor of the product branch. Do not substitute the latest `upstream/main`, which may have advanced. Accept a sync only after resolving every non-generated conflict and checking Workbench contracts, store, authorization, relevant UI behavior, application typechecks, and the desktop smoke test. The [sync workflow](../../.github/workflows/workbench-upstream-sync.yml) owns the current gate list. Treat any new edit outside Workbench-owned directories as an ongoing upstream maintenance cost.

Release the fork from its `main` through a separate fork-owned distribution channel. Upstream releases do not contain the Workbench overlay.
