# Maintaining the Agent Workbench fork

The fork is an upstream-first T3 Code product with an isolated Workbench overlay. Upstream changes enter the product branch through verified merge pull requests.

## Ownership

- T3 Code owns Projects, Threads, provider sessions, workspaces, Git, terminals, diffs, checkpoints, permissions, and updates.
- Workbench owns Workbench Workspaces, Epics, Ticket types and repository scope, statuses, blocked state, Ticket Workspaces, and Assignment history.
- Workbench records reference native `ProjectId` and `ThreadId` values. They do not duplicate T3 records.
- Workbench storage is per server environment. Cross-environment Workspace boards are intentionally deferred.

The product UI calls the planning container a **Workbench Workspace** so it is distinct from a native T3 Project. Existing `WorkbenchProject` contract names, RPC methods, database tables, and stored IDs remain unchanged for compatibility.

Workbench core, persistence, schema initialization, workspace lifecycle rules, and Jira logic live in the private `packages/workbench` package. Server adapters and composition stay in `apps/server/src/workbench`; React UI stays in `apps/web/src/workbench`, and wire schemas stay in `packages/contracts/src`. The schema initializer and `workbench_schema_migrations` ledger remain fork-owned and do not consume numbers from T3's migration ledger.

The package must not depend on either application, including through test helpers. Its typecheck checks the compiler's resolved source graph and the reachable workspace dependency graph. Server adapters supply native Project/Thread reads, Git operations, configuration, and credential storage through typed Effect services. Native persistence reads must use the same SQL client and caller transaction as Workbench writes. Do not replace these reads with a separate runtime, connection, or preloaded snapshot: writer-lock ordering and ownership checks depend on that transaction.

The package shares the server process, database, and release. Native migration integration tests stay in the server; independent package tests use package-owned fixtures.

The small upstream integration surface is:

- `packages/contracts/src/index.ts` and `packages/contracts/src/rpc.ts`;
- `apps/server/src/auth/RpcAuthorization.ts`, `apps/server/src/server.ts`, and `apps/server/src/ws.ts`;
- `apps/web/src/components/AppSidebarLayout.tsx` and `apps/web/src/components/sidebar/SidebarChrome.tsx`;
- `apps/web/src/components/chat/ChatHeader.tsx`;
- the generated `apps/web/src/routeTree.gen.ts`.

Each Ticket stores a non-empty ordered set of native T3 Project references and one primary Project. The primary Project must belong to the parent Workbench Workspace and must also appear in the Ticket repository set. Existing Tickets migrate to `story` and retain their previous primary Project as their initial repository scope.

Epics are Workspace-owned planning records. A Ticket can reference at most one Epic in the same Workspace. Archived Epics remain visible on existing Tickets but cannot receive new Tickets. Board grouping is a UI projection over the same Ticket status columns; it does not introduce a separate workflow state.

## Package quality checks

Run the isolated workspace checks from the repository root:

```sh
vp run --filter @t3tools/workbench typecheck
vp run --filter @t3tools/workbench test
vp run workbench:quality
```

The quality command runs package lint, Knip checks for unused files, dependencies, and exports, and Fallow dead-code analysis. The package also exposes `lint`, `knip`, and `fallow` scripts individually. Knip and Fallow run from the repository root with a Workbench workspace filter so they can resolve server consumers. Fallow checks entry-point exports; unused types are excluded to match the existing Knip policy for exported contract types.

Vite+ lint enforces the ESLint-compatible `eslint/complexity` rule with a maximum of 20 across Workbench source files, without file-specific exceptions.

Fallow health and duplication reports are advisory:

```sh
vp run --filter @t3tools/workbench fallow:health --output-file /tmp/workbench-health.json
vp run --filter @t3tools/workbench fallow:dupes --output-file /tmp/workbench-dupes.json
```

Health uses report-only mode and duplication has no failure threshold. Tool execution errors still fail. Reports focus on Workbench, but duplicate groups can include matching code outside the package. Some aggregate statistics describe the repository graph and must not be presented as package-only metrics. The workspace omits Fallow's optional TypeScript companion because these scripts use native analysis only; this also preserves the existing tools' TypeScript peer resolution.

`.github/workflows/workbench-quality.yml` runs typecheck, package tests, and quality gates for relevant pull requests and pushes to `main`, or manually. A separate job uploads both advisory reports even when a quality gate fails. The upstream-sync workflow also runs the package gates before verifying the application overlay.

## Ticket Workspaces

Creating a Ticket Thread prepares a Workbench branch and one Git worktree per selected repository. Preparation reuses intact worktrees and creates only newly selected repositories. Ownership is checked against the source repository and exact worktree path; the initial branch is not a branch constraint. Preparation reconciles each repository’s current branch before creating a native Thread. Missing, unregistered, or detached worktrees stop preparation without automatic cleanup. Repository selection can change after Threads exist; removed repositories retain their worktrees, and changing the primary repository does not move existing Threads. Each repository records the preparation attempt that created it, so rollback and interrupted-attempt recovery can distinguish new worktrees from retained ones. Normal release never forces removal of user work.

The server serializes preparation and release per Ticket and uses server time for recovery. Repository edits are rejected during preparation or release. A preparation left incomplete for five minutes after a server interruption is reconciled on retry. Recovery preserves retained worktrees and checks whether live Threads use the current attempt before removing its partial worktrees. Release atomically claims a `releasing` state before filesystem changes. Assignment creation and replacement reject preparing or releasing Workspaces, and release tolerates a worktree already removed before persistence completed.

The native T3 Thread is created in the primary repository worktree and records that branch and path. Secondary repository worktrees are durable Ticket context and can be opened through T3's preferred-editor action. They are not added as provider writable roots, which keeps provider contracts and native Thread semantics unchanged.

Snapshot fields retain decoding defaults for older servers. Ticket edits, archive actions, and deletion require a server-controlled revision; revisionless writes from older clients are rejected. Update the client and server together before editing Tickets. Drafts retain the revision they started from so a background refresh cannot conceal a conflicting edit.

Native Thread creation must succeed before the Assignment is inserted. Creating an Assignment does not change Ticket progress. The client attaches Ticket context to the composer draft and waits for the user to send. If Assignment persistence fails, the UI asks T3 to delete the newly created orphan Thread. Once the Assignment exists, its Thread is durable history: a failed first turn does not delete either record. The server also rejects Assignments whose Thread is missing, deleted, or does not belong to the Ticket's primary T3 Project.

Each Ticket can have several active Assignments; each native Thread belongs to one Workbench Assignment. An archived active Thread is restored through T3's native unarchive command before navigation. If an active Thread was deleted, Start replacement atomically supersedes only that Assignment and inserts a new one after checking that no other client changed it. Superseded Assignments and their native Thread IDs remain available for Ticket history and backlinks; archived historical Threads can also be restored from the Ticket.

## Jira sprint mirrors

Jira domain and synchronization logic live under `packages/workbench/src/jira`; HTTP, configuration, credential storage, and composition adapters stay under `apps/server/src/workbench/jira`. It uses Atlassian OAuth 2.0 authorization code grants and stores refresh credentials through T3's secret store. Configure the server with `T3_WORKBENCH_JIRA_CLIENT_ID` and `T3_WORKBENCH_JIRA_CLIENT_SECRET`. The callback URL depends on the client surface.

Create the OAuth app in the [Atlassian developer console](https://developer.atlassian.com/console/myapps/), enable the scopes listed in `JiraOAuthClient.ts`, and register the exact callback URL. Web uses its browser origin plus `/workbench`, such as `http://localhost:5733/workbench`. Desktop uses its server origin plus `/oauth/workbench/jira/callback`, such as `http://127.0.0.1:13773/oauth/workbench/jira/callback`. Read the current port from the running environment; these ports are examples. Restart the server after configuring its credentials. The client secret belongs only on the server. Atlassian requires an exact callback match; see its [OAuth setup documentation](https://developer.atlassian.com/cloud/jira/software/oauth-2-3lo-apps/).

Web authorization returns to `/workbench` in the same paired browser session. Desktop opens Atlassian in an external browser and returns to the server at `/oauth/workbench/jira/callback`; register that exact server origin and path, including its port. The callback completes authorization on the server and asks the user to return to the desktop app. The desktop client refreshes connection state while authorization is pending. Both launch modes need the OAuth client ID and secret in the server process environment.

Authorization state is consumed before exchanging the code. If exchange or persistence fails afterward, start a new connection attempt rather than retrying the callback. Reconnecting the same site preserves its connection ID and existing bindings.

One Jira binding connects a Workbench Workspace to one Jira board and one or more selected sprints; the board can span Jira projects. The binding also owns explicit Jira-status-to-Workbench-status mappings and a default primary/non-empty repository scope for newly imported Tickets. Manual sync and a five-minute background refresh use Jira's enhanced token-paginated sprint endpoint and request only issues assigned to the authenticated Jira user. Binding edits and syncs are serialized per binding so pausing or reconfiguration cannot be overwritten by an in-flight refresh. Pausing disables those syncs without discarding the binding, imported issue links, or Jira field ownership.

Jira owns imported summary, description, issue type, Epic, flagged state, sprint membership, rank, and mapped Board status. The mirrored description is stored as Ticket Markdown and supplies the Agent prompt. Workbench owns repository scope, Ticket Workspaces, Assignments, and native Threads. The general Ticket update path preserves Jira-owned fields. Description and progress edits use the dedicated Jira write command, which writes remotely before projecting the result locally. Assignment creation does not advance a Jira status. A sync validates the full incoming status set before applying all Ticket, Epic, issue-link, and binding-metadata changes in one transaction. Reconciliation preserves stable local Ticket IDs and marks issues inactive when they leave the selected sprints; it never deletes local delivery history. OAuth refresh is single-flight for connections sharing a rotating credential, and a reconnect repoints all returned sites atomically before superseded secrets are removed. Jira writes use the same per-binding lock as refresh, verify current sprint assignment and the expected remote update time, and use available workflow transitions for progress changes. OAuth requests include `write:jira-work`; existing read-only grants need reconnection.

## Branch and remotes

The fork's `main` branch is the long-lived Workbench product branch in `filipgutica/t3code`. In this clone, `origin` points to `filipgutica/t3code` and `upstream` points to `pingdotgg/t3code`. Scheduled workflows use the fork's default branch as the product branch.

Before merging upstream locally:

```sh
git fetch upstream main
node scripts/workbench-upstream-sync.ts --product main --upstream upstream/main
```

The command is read-only. It reports ahead/behind counts, files changed by both sides since their merge base, and whether Git can synthesize a clean merge tree.

`.github/workflows/workbench-upstream-sync.yml` runs the same preview hourly, at minute 17. When upstream has new commits, a read-only job merges `upstream/main` and regenerates the lockfile. It installs with the lockfile frozen, runs the focused Workbench suite, builds the desktop app, and runs its smoke test. A Git bundle transfers the verified commit, including any lockfile correction, to a separate write-capable job. That job opens or updates one PR against the fork's default branch. A merge conflict or failed check leaves the product branch untouched.

Release the fork from `main` using a separate fork-owned distribution channel. Do not point Workbench builds at T3 Code's upstream updater: upstream releases do not contain the overlay.

## Sync acceptance

An upstream sync is acceptable when:

1. the merge preview is clean or every conflict has an explicit Workbench-vs-upstream resolution;
2. Workbench contracts, store tests, authorization tests, and UI logic tests pass;
3. contracts, server, and web typechecks pass;
4. the desktop smoke test passes;
5. a manual desktop pass can create a Workspace and Ticket, start its native Thread, and return through the ticket breadcrumb.

Treat new edits outside Workbench-owned directories as maintenance cost. Prefer an adapter or Workbench-owned module before adding another upstream integration file.

## Ticket progress and agent activity

Ticket progress uses `todo`, `in_progress`, and `done`. The fork-owned schema migration converts legacy `ready_for_review` Ticket rows and Jira status mappings to `in_progress`. Agent activity is derived in the Workbench UI from the native Thread shell; it is not a second persisted agent lifecycle. Pending approvals/input, actionable plans, and failed/interrupted work surface a needs-input label; running/background work surfaces Working; a completed turn surfaces Ready for review. Jira flagged state remains an independent decoration.

Jira bindings default to following their selected sprints. Each five-minute sync retains selected sprints that are active and replaces closed selections only when the newly active candidate set is unambiguous. The binding's persisted `observedActiveSprintIds` exclude already-running parallel sprints. Older bindings with no observation history require a selection when a configured sprint disappears. Missing or ambiguous replacements preserve the entire last successful snapshot and expose a sync message. A pinned binding retains its configured selection. Successful rollover updates sprint metadata, projections, and issue links atomically, preserving local Ticket IDs and native Thread history.

Bindings can map Jira states to the canonical progress values or mirror Jira board columns. Mirrored columns are server-owned snapshots of Jira configuration; canonical progress remains available for Epic completion and local Tickets. Local Tickets appear in the matching progress column, with a fallback column when Jira has no corresponding one. Mirror mode refreshes configuration during sync; mapped mode requires explicit mapping for new Jira statuses.

Jira bindings store `selectedSprints` as the sprint selection. Older bindings fall back to `sprintId` and `sprintName`; those fields remain the first selected sprint for compatibility. Sync reads assigned issues for every selected board sprint, deduplicates by Jira issue ID, and commits selection metadata, projections, and issue links in one transaction. The Jira project used to discover the board does not filter its imported issues.

The primary Board action prefers live Threads, then archived Threads, then missing Threads, choosing the newest Assignment within each group; Ticket detail lists all active Threads and retains unavailable and historical links. New Thread creation carries an explicit provider instance, model, and options. Every new Thread opens with Ticket context attached to its composer and waits for the user to send. Workbench uses native Thread deletion with worktree preservation because the Ticket Workspace owns the shared repository worktrees.
