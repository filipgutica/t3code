---
name: workbench-demo
description: Operate the reusable T3 Code Workbench demo environment when a task needs a seeded local Workbench, GitHub and Jira setup, a guide-style browser check, or demo reset and verification.
---

# Workbench demo

Use this skill when a task needs the full Workbench demonstration path: local
repositories and worktrees, Workbench Workspaces and Tickets, native Threads,
GitHub pull request links, Jira sprint mirrors, or the browser-ready guide
scenario.

The kit is per operator. Its default home is
`~/.t3-workbench-demos/guide`; set `DEMO_HOME` to an absolute path when a task
needs another isolated environment. Read
[`scripts/workbench-demo/README.md`](../../../scripts/workbench-demo/README.md)
before operating the kit.

## Run the lifecycle

1. Establish the demo home and confirm that it is a dedicated T3 data directory.
   Keep it separate from `~/.t3/userdata` and from any other active server.
2. If `config.env` is absent, ask the human to run
   `bash scripts/workbench-demo/setup.sh`. The wizard captures their GitHub
   owner, Jira site, classic API token for project/board/sprint menus, and Workbench
   OAuth credentials. It does not create remote resources for them.
3. Create local state with:

   ```sh
   node scripts/workbench-demo/cli.mts setup --home "$DEMO_HOME"
   ```

4. For remote resources, inspect both plans first:

   ```sh
   node scripts/workbench-demo/cli.mts github --home "$DEMO_HOME" --preview
   # Optional when a classic Jira API token is configured.
   node scripts/workbench-demo/cli.mts jira --home "$DEMO_HOME" --preview
   ```

   Use `--apply` only after the human has reviewed the plan. `reuse` mode must
   resolve the operator's existing repository, project, and board resources;
   `provision` mode creates dedicated resources under their accounts. Jira
   reuse inspection needs the optional classic API token; when the operator has
   authorized Workbench OAuth only, skip that inspection and verify the binding
   with `verify --jira` after browser authorization.

5. Launch the current checkout and keep it running, then seed from a second
   terminal so the fixture can create Workbench records through the live server:

   ```sh
   node scripts/workbench-demo/cli.mts start --home "$DEMO_HOME"
   node scripts/workbench-demo/cli.mts seed --home "$DEMO_HOME"
   ```

   Keep `start` in the foreground. Give the human the full pairing URL printed
   by the process. Track only the process started for this home; stop it with
   Ctrl-C or `node scripts/workbench-demo/cli.mts stop --home "$DEMO_HOME"`.

6. After the human authorizes Jira in the browser, create and sync the Jira
   binding, then verify both local and remote state:

   ```sh
   node scripts/workbench-demo/cli.mts sync-jira --home "$DEMO_HOME"
   node scripts/workbench-demo/cli.mts verify --home "$DEMO_HOME" --jira
   ```

   Treat a failed remote lookup or Jira binding check as evidence of drift or
   missing authorization. Repair the account or configuration and rerun the
   relevant preview instead of rewriting remote resources silently.

## Safety and isolation

- Use the explicit `--home` path for every command. Never point this kit at the
  developer's live `~/.t3/userdata`.
- A reset is local and recoverable: preview it, then use `reset --apply`. It
  preserves `config.env` and the remote manifest and does not delete GitHub or
  Jira resources.
- Do not send provider messages merely to prove that a seeded Thread renders.
  Seeded history is fixture data; provider execution needs an explicit user
  action.
- Do not infer remote identity from names alone. Use the IDs recorded in the
  demo manifest and verify them through GitHub and Jira before a browser check.
- Keep the current checkout's code under test. The demo home supplies data and
  repositories; it is not a second application install.

## Expected scenario

Verification should leave the browser with synthetic local Orbit and Beacon
work and an Orbit Jira Workspace containing mirrored sprint issues, Epics,
ungrouped work, open and in-progress items, review and done items, and closed
or archived history. Ticket details should expose
their repository scope, linked pull requests, native Thread history, and Jira
issue link when configured. A Jira sync must use the real OAuth connection and
the authorized user's assigned sprint issues.

When a check fails, report the exact command, demo home, and failing remote or
local identity. Keep the failure separate from upstream-sync and release
workflows; this kit belongs to the fork and should remain in fork-owned files.
