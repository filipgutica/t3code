---
name: workbench-verify
description: Give the developer a ready-to-use, throwaway T3 Code environment for verifying a change against a copy of their own data, optionally connected to their other machines. Use when the developer asks to verify or try a change with their own data or machines. Synthetic demos and PR evidence use workbench-demo instead.
---

# Verify with the developer's data

The developer gets one signed-in link to an environment that already holds
what they need to check. They do not run commands or pair anything.

This is the one exception to synthetic-only testing. The developer drives
verification. You set up, hand over, and tear down; you do not create
Tickets or Threads or send messages in this environment.

Pick a run id such as `verify-<yyyymmdd>-<4 random chars>`. Every credential
this run creates carries it in its label. Record each resource in
`<run home>/run.json` as you create it: pairing ids, session ids, the runner
PID, the tab id, and remote Thread links. Teardown works from that record and
from the run label.

## What stays real

- Copied Projects keep their original paths. Creating or removing a Ticket
  Workspace or worktree, or any Git action, changes the developer's real
  checkout. For checks that write to a repository, add a disposable clone as
  a new Project in the copy and use that.
- On other machines, the delegated agents and any Thread the developer
  creates leave Threads there after teardown.

Tell the developer both before handover.

## Set up

1. **Seed** into a new owner-only home outside the checkout, such as
   `~/.t3-verify/<run id>` (mode 700). Pass its absolute path everywhere below:
   `vp run migrate-dev-db --base-dir <run home> --projects <n>`. Pick `n`
   large enough to keep every Project the check needs; the output lists
   what it kept. The live database is only read. Before first launch, turn
   off startup auto-pull, which would pull the real checkouts. From
   `apps/server`:
   `node -e 'new (require("node:sqlite").DatabaseSync)(process.argv[1]).exec("UPDATE projection_projects SET auto_pull = 0")' <run home>/userdata/statev2.sqlite`.
2. **Start** `vp run dev --share --home-dir <run home>` in the background,
   outside the sandbox, and record the runner's PID from launch. Read the
   shared origin from the `[dev-runner]` line.
3. **Issue the setup credential.** From the repository root, run
   `node apps/server/src/bin.ts auth pairing create --base-dir <run home> --ttl 30m --label <run id>-setup --base-url <shared origin> --json`.
   Do not use the startup `pairingUrl`, which can be a reusable dev
   credential.
4. **Connect other machines**, only when the developer asked for them; name
   which ones. `t3_environment_links` lists them. Each delegation below
   creates a Thread on that machine; record its link. For each machine:
   - `delegate_task` with `target.environmentId`, a project there
     (`t3_project_list`; "No project" works), the balanced-tier model, and
     `mode: "wait"`. Record the task id. Ask it to:
     - find the running server's CLI and the T3 home that server uses;
     - confirm the server keeps its state in `<home>/userdata`, not
       `<home>/dev`, and that `<home>/userdata/environment-id` equals the
       machine's environment id. If either check fails, stop and report;
     - then run
       `t3 auth pairing create --base-dir <that home> --ttl 30m --label <run id> --base-url <its https tailnet URL> --scope orchestration:read --scope orchestration:operate --json`.
       Add scopes only when the check exercises files, terminals, source
       control, or previews there.
   - Every `t3 auth` command on that machine passes the same
     `--base-dir`. The CLI opens that server's live database, the same way
     `t3 pair` does. This skill allows it for `auth pairing` and
     `auth session` commands only.
5. **Open the tab** in the Incognito profile (`preview_open`,
   `profileId: "incognito"`, `reuseExistingTab: false`) with the setup link
   in the form `/pair?token=<token>`. For each machine, go to Settings →
   Connections → Add environment, paste its pairing URL into Host, and wait
   until it shows Connected. Then delegate
   `t3 auth session list --base-dir <that home> --json` and record the
   session whose `client.label` is the run id.
6. **Prepare** the state the check needs in the copy, such as a Board that
   links the Projects under test, named so it reads as a test.
7. **Hand over.** Issue a separate handover credential as in step 3, with
   `--label <run id>-handover` and a 2h TTL. Check with
   `auth pairing list --base-dir <run home> --json` that its id is active.
   Give the developer:
   - its link in the `/pair?token=<token>` form;
   - which machines are connected, noting they appear only in the Browser
     panel tab, which you show with `preview_open` and `open: true`;
   - what you created, what to check, and the points in "What stays real".

If any step fails, run teardown for every machine you attempted.

## Tear down

When the developer is done, or setup failed:

1. In the tab, remove each machine under Settings → Connections, then close
   the tab with `t3_preview_close`.
2. Confirm that every setup delegate has finished, or cancel it with
   `task_cancel` and wait until it is terminal; a running one can still
   issue a credential. Then, on each machine you attempted, delegate with
   that machine's verified `--base-dir`:
   - `auth session list --json`, then revoke every session whose
     `client.label` contains the run id, whether or not you recorded it;
   - `auth pairing list --json`, then revoke every pairing labeled with the run id;
   - list both again and confirm nothing with the run id remains.
3. Stop the dev runner by its recorded PID. Never kill by pattern. Confirm
   its ports and its tailnet share are gone.
4. Delete `<run home>`. If the developer wants the copy kept, first clear
   every credential in it, including the unlabeled startup pairing: with
   the runner stopped, from `apps/server`, run
   `node -e 'new (require("node:sqlite").DatabaseSync)(process.argv[1]).exec("DELETE FROM auth_pairing_links; DELETE FROM auth_sessions")' <run home>/userdata/statev2.sqlite`.

Keep `run.json` until every check passes. Report each check's result and the
remote Thread links. Name any machine you could not reach: it may still hold
a live session.
