---
name: workbench-verify
description: Give the developer a ready-to-use, throwaway T3 Code environment for verifying a change against a copy of their own data, connected to their other machines. Use when the developer asks to verify or try a change with their own data or machines. Synthetic demos and PR evidence use workbench-demo instead.
---

# Verify with the developer's data

The developer gets one Browser panel tab that is already signed in, connected
to their other machines, and showing a test Board. They do not run commands
or pair anything. Everything you create is torn down afterwards.

This is the one exception to synthetic-only testing. The developer drives
verification. You set up, hand over, and tear down; you do not create
Tickets or Threads or send messages in this environment.

## Set up

1. **Seed.** With no dev server running in this worktree, run
   `vp run migrate-dev-db --projects <n>`. Pick `n` large enough to keep
   every Project the check needs; the output lists what it kept. The live
   database is only read.
2. **Start.** Run `vp run dev --share` in the background, outside the
   sandbox. Record the web and server PIDs from `ss -H -ltnp` for the ports
   on the `[dev-runner]` line, and the startup `pairingUrl`.
3. **Issue a pairing on each other machine.** `t3_environment_links` lists
   them. For each, `delegate_task` with `target.environmentId`, a project
   there (`t3_project_list`; "No project" works), the balanced-tier model,
   and `mode: "wait"`. The brief asks it to:
   - find the CLI of the T3 server running there (`<T3 home>/bin/t3` or
     `<T3 home>/runtime/versions/<version>/t3`);
   - run `t3 auth pairing create --ttl 2h --label verify-<run id> --base-url <its https tailnet URL> --json`
     with `--scope` for orchestration:read, orchestration:operate,
     filesystem:read, source-control:write, terminal:read and preview:operate;
   - return the pairing id and URL, and change nothing else.
4. **Connect.** In a new Browser panel tab (`preview_open`,
   `reuseExistingTab: false`), open the startup URL in its query form,
   `/pair?token=<token>`, which carries the admin scopes Settings needs.
   Then go to Settings → Connections → Add environment, paste each
   machine's pairing URL into Host, and add it. Wait until each machine shows
   Connected.
5. **Prepare.** Create the state the check needs in the copy, such as a
   Board that links the Projects under test. Name it so it reads as a test.
6. **Hand over.** Show the tab (`preview_open` with its `tabId` and
   `open: true`). Tell the developer what is connected, what you created,
   and what to check.

## Tear down

When the developer is done:

1. On each other machine, delegate again:
   - run `t3 auth session list --json`;
   - identify this run's session, which was issued when its pairing was used during setup. Use the issue time and client details to tell it from the developer's own sessions, and report the evidence;
   - run `t3 auth session revoke <id>` for it, and `t3 auth pairing revoke <pairing id>` if the pairing was never used;
   - list again and confirm the session is gone.
2. Close the tab with `t3_preview_close`. Its saved connections hold
   revoked credentials and no longer work.
3. Stop the dev server by the PIDs you recorded. Never kill by pattern.
4. Delete the worktree's `.t3` copy if the developer does not want it kept.

Report each machine's revocation result. A machine that could not be
reached still holds a live session; name it in the handoff.
