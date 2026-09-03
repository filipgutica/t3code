# Maintaining the Agent Workbench fork

The fork is an upstream-first T3 Code product with an isolated Workbench overlay. The current integration base is `pingdotgg/t3code@f6c04c552c203350705f9ab1e47773ea736af245`.

## Ownership

- T3 Code owns Projects, Threads, provider sessions, workspaces, Git, terminals, diffs, checkpoints, permissions, and updates.
- Workbench owns Workbench Workspaces, Tickets, statuses, blocked state, and Assignments.
- Workbench records reference native `ProjectId` and `ThreadId` values. They do not duplicate T3 records.
- Workbench storage is per server environment. Cross-environment Workspace boards are intentionally deferred.

The product UI calls the planning container a **Workbench Workspace** so it is distinct from a native T3 Project. Existing `WorkbenchProject` contract names, RPC methods, database tables, and stored IDs remain unchanged for compatibility.

Workbench-specific code lives under `apps/server/src/workbench`, `apps/web/src/workbench`, and `packages/contracts/src/workbench.ts`. Its schema initializer and `workbench_schema_migrations` ledger are fork-owned and do not consume numbers from T3's migration ledger.

The small upstream integration surface is:

- `packages/contracts/src/index.ts` and `packages/contracts/src/rpc.ts`;
- `apps/server/src/auth/RpcAuthorization.ts`, `apps/server/src/server.ts`, and `apps/server/src/ws.ts`;
- `apps/web/src/components/AppSidebarLayout.tsx` and `apps/web/src/components/sidebar/SidebarChrome.tsx`;
- `apps/web/src/components/chat/ChatHeader.tsx`;
- the generated `apps/web/src/routeTree.gen.ts`.

When Start work runs, native Thread creation must succeed before the Assignment is inserted. If Assignment persistence fails, the UI asks T3 to delete the newly created orphan Thread. The server also rejects Assignments whose Thread is missing, deleted, or belongs to the wrong T3 Project.
Each Ticket has at most one Assignment. If its assigned Thread is archived or deleted, Start replacement creates a new native Thread and atomically repoints the Assignment after checking that no other client changed it.

## Branch and remotes

Keep a long-lived `workbench/main` product branch in `filipgutica/t3code`. In the existing clone, `origin` points to `pingdotgg/t3code` and `fork` points to `filipgutica/t3code`; keeping those names is fine. Set the fork's default branch to `workbench/main` so scheduled workflows are loaded from the product branch.

Before merging upstream locally:

```sh
git fetch origin main
node scripts/workbench-upstream-sync.ts --product workbench/main --upstream origin/main
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
