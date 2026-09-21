---
name: workbench-demo
description: Run disposable T3 Code Workbench demos for screenshots, videos, or checks requiring seeded Tickets, native Threads, GitHub PRs, and connected Jira.
---

# Workbench demo

Read the [demo quickstart](../../../scripts/workbench-demo/README.md). The default
saved profile is `~/.t3-workbench-demos/guide`; use `DEMO_HOME` or `--home` for
another profile. Keep it separate from the developer's live `~/.t3/userdata`.

## Run and clean up

1. Run `bash scripts/workbench-demo/run.sh` from the checkout under test. Startup
   creates disposable state, seeds fixtures, and checks Jira before reporting ready.
2. Use the printed pairing URL. Give the human their own unconsumed pairing URL
   when they need to connect. Track the launcher for this run.
3. Stop with Ctrl-C when finished. Confirm cleanup succeeds: the run is removed
   and refreshed Jira authorization is saved to the profile.

If setup or authorization is missing, use `bash scripts/workbench-demo/setup.sh`
and let the human complete browser consent. Follow the quickstart rather than
manually assembling start, seed, and sync commands.

On failure, report the command, profile, and failing check. Use the reported
recovery command before another run; retain locks and credentials until recovery
succeeds. Read [maintenance](../../../scripts/workbench-demo/maintenance.md) only
for explicit remote provisioning or regression-fixture repair.

## Demo fidelity

The checkout supplies the code; the profile supplies configuration and OAuth.
Normal runs leave remote GitHub and Jira data unchanged. Jira must use the real
connection and the authorized user's assigned sprint issues. Available statuses
and Epic relationships depend on that sprint.

Local Orbit and Beacon records are fixtures. Use actual rendered UI for product
screenshots and videos. Provider execution requires authorization; seeded Threads
and synthetic history do not prove that an agent ran.
