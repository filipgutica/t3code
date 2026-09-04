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

Starting work prepares a deterministic Workbench branch and Git worktree for every repository in the Ticket's ordered repository scope. All repositories are validated before creation, each successful worktree is recorded immediately, and partial failures roll back already-created worktrees when Git permits it. A ready Ticket Workspace is reused on retry. Repository scope cannot change while its worktrees exist, and normal release never forces removal of user work. The server serializes preparation and release per Ticket and uses server time for recovery. A preparation left incomplete for five minutes after a server interruption is reconciled on retry; only its partial, unassigned worktrees are force-removed before a new attempt. Release atomically claims a `releasing` state before filesystem changes, Assignment creation rejects preparing or releasing Workspaces, and release tolerates a worktree already removed before persistence completed.

The native T3 Thread is created in the primary repository worktree and records that branch and path. Secondary repository worktrees are durable Ticket context and can be opened through T3's preferred-editor action. They are not added as provider writable roots, which keeps provider contracts and native Thread semantics unchanged.

For rolling web/server updates, newly added snapshot fields decode with compatibility defaults. Older create/update payloads default a new Ticket to `story`, derive its repository scope from the primary Project, preserve omitted scope fields during updates, and may omit a replacement Assignment ID for the server to generate. A newer client connected to an older server degrades to a Story Ticket with its primary Project as the visible repository scope until both sides are updated.

When Start work runs, native Thread creation must succeed before the Assignment is inserted. If Assignment persistence fails, the UI asks T3 to delete the newly created orphan Thread. Once the Assignment exists, its Thread is durable history: a failed first turn does not delete either record. The server also rejects Assignments whose Thread is missing, deleted, or does not belong to the Ticket's primary T3 Project.

Each Ticket has at most one active Assignment. An archived active Thread is restored through T3's native unarchive command before navigation. If the active Thread was deleted, Start replacement atomically supersedes that Assignment and inserts a new one after checking that no other client changed it. Superseded Assignments and their native Thread IDs remain available for Ticket history and backlinks; archived historical Threads can also be restored from the Ticket.

## Jira sprint mirrors

The Jira integration is a pull-only adapter under `apps/server/src/workbench/jira`. It uses Atlassian OAuth 2.0 authorization code grants and stores refresh credentials through T3's secret store. Configure the server with `T3_WORKBENCH_JIRA_CLIENT_ID` and `T3_WORKBENCH_JIRA_CLIENT_SECRET`; the browser callback returns to `/workbench`.

One Jira binding connects a Workbench Workspace to one Jira project, Board, and sprint. The binding also owns explicit Jira-status-to-Workbench-status mappings and a default primary/non-empty repository scope for newly imported Tickets. Manual sync and a five-minute background refresh request only issues assigned to the authenticated Jira user. Pausing disables those syncs without discarding the binding, imported issue links, or Jira field ownership.

Jira owns imported summary, issue type, Epic, flagged state, sprint membership, rank, and mapped Board status. Workbench owns Markdown instructions, repository scope after import, Ticket Workspaces, Assignments, and Threads. Both the importer and general Ticket update path enforce that ownership at the SQL boundary, so a stale client cannot write older Jira fields back while saving local instructions. Reconciliation preserves stable local Ticket IDs and marks issues inactive when they leave the selected sprint; it never deletes local delivery history. No Jira write APIs are used in this slice.

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
