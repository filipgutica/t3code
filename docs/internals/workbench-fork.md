# Maintaining the Agent Workbench fork

The fork is an upstream-first T3 Code product with an isolated Workbench overlay. The current integration base is `pingdotgg/t3code@f6c04c552c203350705f9ab1e47773ea736af245`.

## Ownership

- T3 Code owns Projects, Threads, provider sessions, workspaces, Git, terminals, diffs, checkpoints, permissions, and updates.
- Workbench owns Workbench Workspaces, Epics, Ticket types and repository scope, statuses, blocked state, Ticket Workspaces, and Assignment history.
- Workbench records reference native `ProjectId` and `ThreadId` values. They do not duplicate T3 records.
- Workbench storage is per server environment. Cross-environment Workspace boards are intentionally deferred.

The product UI calls the planning container a **Workbench Workspace** so it is distinct from a native T3 Project. Existing `WorkbenchProject` contract names, RPC methods, database tables, and stored IDs remain unchanged for compatibility.

Workbench-specific code lives under `apps/server/src/workbench`, `apps/web/src/workbench`, and the Workbench contract modules in `packages/contracts/src`. Its schema initializer and `workbench_schema_migrations` ledger are fork-owned and do not consume numbers from T3's migration ledger.

The small upstream integration surface is:

- `packages/contracts/src/index.ts` and `packages/contracts/src/rpc.ts`;
- `apps/server/src/auth/RpcAuthorization.ts`, `apps/server/src/server.ts`, and `apps/server/src/ws.ts`;
- `apps/web/src/components/AppSidebarLayout.tsx` and `apps/web/src/components/sidebar/SidebarChrome.tsx`;
- `apps/web/src/components/chat/ChatHeader.tsx`;
- the generated `apps/web/src/routeTree.gen.ts`.

Each Ticket stores a non-empty ordered set of native T3 Project references and one primary Project. The primary Project must belong to the parent Workbench Workspace and must also appear in the Ticket repository set. Existing Tickets migrate to `story` and retain their previous primary Project as their initial repository scope.

Epics are Workspace-owned planning records. A Ticket can reference at most one Epic in the same Workspace. Archived Epics remain visible on existing Tickets but cannot receive new Tickets. Board grouping is a UI projection over the same Ticket status columns; it does not introduce a separate workflow state.

## Ticket Workspaces

Starting work prepares a deterministic Workbench branch and Git worktree for every repository in the Ticket's ordered repository scope. All repositories are validated before creation, each successful worktree is recorded immediately, and partial failures roll back already-created worktrees when Git permits it. A ready Ticket Workspace is reused on retry only while every recorded worktree remains registered with Git and present on disk. If native Thread cleanup removed a worktree, the next replacement attempt releases the stale records and prepares a fresh Workspace; a live assigned Thread still prevents that recovery. Repository scope cannot change while its worktrees exist, and normal release never forces removal of user work. The server serializes preparation and release per Ticket and uses server time for recovery. A preparation left incomplete for five minutes after a server interruption is reconciled on retry; only its partial, unassigned worktrees are force-removed before a new attempt. Release atomically claims a `releasing` state before filesystem changes, Assignment creation rejects preparing or releasing Workspaces, and release tolerates a worktree already removed before persistence completed.

The native T3 Thread is created in the primary repository worktree and records that branch and path. Secondary repository worktrees are durable Ticket context and can be opened through T3's preferred-editor action. They are not added as provider writable roots, which keeps provider contracts and native Thread semantics unchanged.

For rolling web/server updates, newly added snapshot fields decode with compatibility defaults. Older create/update payloads default a new Ticket to `story`, derive its repository scope from the primary Project, preserve omitted scope fields during updates, and may omit a replacement Assignment ID for the server to generate. A newer client connected to an older server degrades to a Story Ticket with its primary Project as the visible repository scope until both sides are updated.

When Start work runs, native Thread creation must succeed before the Assignment is inserted. If Assignment persistence fails, the UI asks T3 to delete the newly created orphan Thread. Once the Assignment exists, its Thread is durable history: a failed first turn does not delete either record. The server also rejects Assignments whose Thread is missing, deleted, or does not belong to the Ticket's primary T3 Project.

Each Ticket can have several active Assignments; each native Thread belongs to one Workbench Assignment. An archived active Thread is restored through T3's native unarchive command before navigation. If an active Thread was deleted, Start replacement atomically supersedes only that Assignment and inserts a new one after checking that no other client changed it. Superseded Assignments and their native Thread IDs remain available for Ticket history and backlinks; archived historical Threads can also be restored from the Ticket.

## Jira sprint mirrors

The Jira integration is an adapter under `apps/server/src/workbench/jira`. It uses Atlassian OAuth 2.0 authorization code grants and stores refresh credentials through T3's secret store. Configure the server with `T3_WORKBENCH_JIRA_CLIENT_ID` and `T3_WORKBENCH_JIRA_CLIENT_SECRET`; the browser callback returns to `/workbench`.

Create the OAuth app in the [Atlassian developer console](https://developer.atlassian.com/console/myapps/), enable the scopes listed in `JiraOAuthClient.ts`, and register the exact client origin plus `/workbench` as its callback URL (for example, `http://localhost:5733/workbench` for this checkout's local web environment). Restart the server after configuring its credentials. The client secret belongs only on the server. Atlassian requires an exact callback match; see its [OAuth setup documentation](https://developer.atlassian.com/cloud/jira/software/oauth-2-3lo-apps/).

The current authorization return path requires the same paired browser session. Desktop opens Atlassian in an external browser, whose session and storage are separate; desktop authorization and arbitrary remote origins still need a server callback and return handoff before they can be considered supported. Local web authorization also remains subject to live validation with a configured OAuth app.

Authorization state is consumed before exchanging the code. If exchange or persistence fails afterward, start a new connection attempt rather than retrying the callback. Reconnecting the same site preserves its connection ID and existing bindings.

One Jira binding connects a Workbench Workspace to one Jira board and one or more selected sprints; the board can span Jira projects. The binding also owns explicit Jira-status-to-Workbench-status mappings and a default primary/non-empty repository scope for newly imported Tickets. Manual sync and a five-minute background refresh use Jira's enhanced token-paginated sprint endpoint and request only issues assigned to the authenticated Jira user. Binding edits and syncs are serialized per binding so pausing or reconfiguration cannot be overwritten by an in-flight refresh. Pausing disables those syncs without discarding the binding, imported issue links, or Jira field ownership.

Jira owns imported summary, description, issue type, Epic, flagged state, sprint membership, rank, and mapped Board status. The mirrored description is stored as Ticket Markdown and supplies the Agent prompt. Workbench owns repository scope, Ticket Workspaces, Assignments, and native Threads. The general Ticket update path preserves Jira-owned fields. Description and progress edits use the dedicated Jira write command, which writes remotely before projecting the result locally. Assignment creation does not advance a Jira status. A sync validates the full incoming status set before applying all Ticket, Epic, issue-link, and binding-metadata changes in one transaction. Reconciliation preserves stable local Ticket IDs and marks issues inactive when they leave the selected sprints; it never deletes local delivery history. OAuth refresh is single-flight for connections sharing a rotating credential, and a reconnect repoints all returned sites atomically before superseded secrets are removed. Jira writes use the same per-binding lock as refresh, verify current sprint assignment and the expected remote update time, and use available workflow transitions for progress changes. OAuth requests include `write:jira-work`; existing read-only grants need reconnection.

## Branch and remotes

Keep a long-lived `workbench/main` product branch in `filipgutica/t3code`. In this clone, `origin` points to `filipgutica/t3code` and `upstream` points to `pingdotgg/t3code`. Set the fork's default branch to `workbench/main` so scheduled workflows are loaded from the product branch.

Before merging upstream locally:

```sh
git fetch upstream main
node scripts/workbench-upstream-sync.ts --product workbench/main --upstream upstream/main
```

The command is read-only. It reports ahead/behind counts, files changed by both sides since their merge base, and whether Git can synthesize a clean merge tree.

`.github/workflows/workbench-upstream-sync.yml` runs the same preview every day. When upstream moved, a read-only job merges `upstream/main`, runs the focused Workbench suite, builds the desktop app, and runs its smoke test. Only then does a separate write-capable job recreate that exact verified merge and open or update one PR against `workbench/main`. A conflict or failed check leaves the product branch untouched.

Release the fork from `workbench/main` using a separate fork-owned distribution channel. Do not point Workbench builds at T3 Code's upstream updater: upstream releases do not contain the overlay.

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

The primary Board action prefers the newest available Thread; Ticket detail lists all active Threads and retains unavailable and historical links. New Thread creation carries an explicit provider instance, model, and options. Additional Threads open without a prompt or initial turn. Workbench uses native Thread deletion with worktree preservation because the Ticket Workspace owns the shared repository worktrees.
