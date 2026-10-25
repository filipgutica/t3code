---
name: workbench-demo
description: Run disposable T3 Code Workbench demos for screenshots, videos, PR evidence, or checks requiring seeded Tickets, native Threads, GitHub PRs, and connected Jira.
---

# Workbench demo

Read the [demo quickstart](../../../scripts/workbench-demo/README.md). The default
saved profile is `~/.t3-workbench-demos/guide`; use `DEMO_HOME` or `--home` for
another profile. Keep it separate from the developer's live `~/.t3/userdata`.

## Run and clean up

1. Run `bash scripts/workbench-demo/run.sh` from the checkout under test. Startup
   creates disposable state, seeds fixtures, and checks Jira before reporting ready.
2. Open the printed pairing URL in the Workbench browser with `preview_open`.
   Give the human their own unconsumed pairing URL when they need to connect.
   Track the launcher for this run. The server reloads on file changes in the
   checkout, so do not run tests or builds there until you stop the demo.
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

## Browser

Verify, capture screenshots and record videos of the local demo in the Browser panel
of the T3 Code Workbench app running this thread, through its preview tools (`preview_open`,
`preview_snapshot`, `preview_upload`). The Vercel demo linked from a PR is for
human reviewers; agents do not use it. That browser carries the user's sign-ins,
GitHub included, so upload PR evidence from it as well:

1. Open a fresh tab on the PR (`reuseExistingTab: false`) and scroll to the bottom;
   GitHub loads the comment form lazily.
2. Upload the images into `#fc-new_comment_field` and wait until the field holds
   every `user-attachments` URL.
3. Clear the field without posting, then put those URLs in the PR body.

Judge GitHub sign-in from a screenshot of the header avatar. If a tab looks signed
out, open another fresh tab: GitHub's PR page shows an empty `user-login` meta tag
and hidden login links even while signed in.
