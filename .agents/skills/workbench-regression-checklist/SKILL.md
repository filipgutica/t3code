---
name: workbench-regression-checklist
description: Run a visual regression pass of the Workbench addon in its isolated demo environment before merging Workbench changes or preparing a release. Covers planning, repository worktrees, native Thread handoff, PR tracking, and Jira integration with explicit coverage results.
---

# Workbench regression checklist

Use this checklist to exercise Workbench through a real web or desktop client.
Creating the checklist does not itself authorize running provider turns, changing
remote Jira/GitHub data, or publishing evidence. Use the current task's authority;
ask only for missing authorization, and continue independent checks.

## Prepare the pass

1. Record the checkout, branch, commit, client, demo home, and actual URL. Use
   [workbench-demo](../workbench-demo/SKILL.md) to inspect or start the existing
   demo, and [test-t3-app](../test-t3-app/SKILL.md) for pairing and lifecycle.
   Keep the server running for human verification. Never use the live T3 home.
2. Compare the [user guide](../../../docs/user/agent-workbench.md) and current
   `apps/web/src/workbench` controls with the coverage below. Add missing actions
   when functionality changes; do not treat an old checklist as exhaustive proof.
3. Back up local state consistently. Record the IDs and original values of remote
   demo issues before changing them. Prefer a labelled regression Workspace and
   synthetic Tickets; retain existing examples. A local backup cannot undo Jira.
4. Read [the full checklist](references/checklist.md). Run every available normal
   and reverse flow. Set up conditional cases only in disposable fixtures with
   suitable authorization; mark missing prerequisites as blocked, never passed.

## Execute and record

- Use actual controls and inspect rendered results. API/database evidence can
  supplement a visual check, but cannot replace clicking through the behavior.
- In a temporary report outside the checkout, record each checklist ID as
  **pass**, **fail**, **blocked**, or **not applicable**, with observed result and
  screenshot, URL, test, or log evidence. State why a case is not applicable.
- A Thread-opening check is incomplete until an authorized test message is sent
  and the turn finishes. Use: `Do not edit files or run commands. Reply exactly:
Workbench regression passed.` Verify progress and retained context afterward.
- Append text normally in the composer. Replacing its entire editable value can
  remove the hidden Ticket context token and invalidate the attachment check.
- Exercise both entry points when a behavior exists on Board and Ticket detail.
  Check the reverse operation, reload persistence, and error recovery where listed.
- Web and desktop share UI but differ in native navigation, editor opening, and
  OAuth return. Record the tested surfaces. Workbench has no dedicated mobile UI;
  a narrow web viewport is not proof of native mobile support.
- On a failure, preserve evidence and determine whether it is a product regression,
  fixture problem, or unavailable service. Fix authorized regressions on the test
  branch with focused deterministic coverage, then repeat the failed visual path
  and affected neighbors. Keep Workbench logic in its owned modules.

## Finish

Restore modified remote examples and configuration; report any retained test
resources. Do not erase existing Threads or worktrees to make cleanup easier.
Summarize coverage and unresolved failures in the PR, with the exact tested commit
and client. Upload evidence only when authorized and reviewed for its destination.
Keep run-specific results out of this reusable skill. A partial pass must name its
blocked cases; it is not an all-functionality or release certification.
