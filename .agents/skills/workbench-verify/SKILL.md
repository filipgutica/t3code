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
this run creates carries it as its label, and every resource is recorded in
`<run home>/run.json` (pairing ids, session ids, PIDs, tab id) as it is
created, so teardown removes exactly what this run made.

## Set up

1. **Seed** into a new run-owned home, such as `<worktree>/.t3-<run id>`:
   `vp run migrate-dev-db --base-dir <run home> --projects <n>`. Pick `n`
   large enough to keep every Project the check needs; the output lists what
   it kept. The live database is only read.
2. **Start** `vp run dev --share --home-dir <run home>` in the background,
   outside the sandbox, and record the runner's PID from launch. Read the
   shared origin from the `[dev-runner]` line.
3. **Issue the setup credential.** From the repository root, run
   `node apps/server/src/bin.ts auth pairing create --base-dir <run home> --ttl 30m --label <run id>-setup --base-url <shared origin> --json`.
   Do not use the startup `pairingUrl`, which can be a reusable dev
   credential.
4. **Connect other machines**, only when the developer asked for them; name
   which ones. `t3_environment_links` lists them. For each machine:
   - `delegate_task` with `target.environmentId`, a project there
     (`t3_project_list`; "No project" works), the balanced-tier model, and
     `mode: "wait"`. Ask it to find the running server's CLI and its T3 home
     (`<T3 home>/bin/t3` or `<T3 home>/runtime/versions/<version>/t3`),
     then run `t3 auth pairing create --ttl 30m --label <run id> --base-url <its https tailnet URL> --scope orchestration:read --scope orchestration:operate --json`.
     Add more scopes only when the check exercises files, terminals, source
     control, or previews there. The CLI is the product's own way to pair
     with a running server. It writes that machine's auth tables, and
     nothing else.
   - After the machine connects (step 5), delegate again to run
     `t3 auth session list --json` and record the one session whose
     `client.label` is the run id. If there is not exactly one, stop and
     tear down.
5. **Open the tab** in the Incognito profile (`preview_open`,
   `profileId: "incognito"`, `reuseExistingTab: false`) with the setup link
   in the form `/pair?token=<token>`. For each machine, go to Settings →
   Connections → Add environment, paste its pairing URL into Host, and wait
   until it shows Connected.
6. **Prepare** the state the check needs in the copy, such as a Board that
   links the Projects under test, named so it reads as a test.
7. **Hand over.** Issue a separate handover credential as in step 3, with
   `--label <run id>-handover` and a 2h TTL. Check with
   `auth pairing list --json` that its id is active. Give the developer:
   - its link in the `/pair?token=<token>` form;
   - which machines are connected, noting they appear only in the Browser
     panel tab, which you show with `preview_open` and `open: true`;
   - what you created and what to check;
   - that a Thread they create on another machine stays on that machine
     after teardown.

If any step fails, run teardown for what the run created so far.

## Tear down

When the developer is done, or setup failed:

1. In the tab, remove each machine under Settings → Connections, then close
   the tab with `t3_preview_close`.
2. On each other machine, delegate `t3 auth session revoke <recorded id>`,
   then `t3 auth pairing revoke <id>` for any pairing never used. List both
   again and confirm neither id remains.
3. Stop the dev runner by its recorded PID. Never kill by pattern. Confirm
   its ports and its tailnet share are gone.
4. Delete `<run home>` unless the developer wants the copy kept.

Report each check's result. A machine you could not reach still holds a
live session; name it in the handoff.
