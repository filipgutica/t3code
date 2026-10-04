---
name: workbench-visual-spot-check
description: Run bounded visual regression spot checks in an isolated Workbench demo after larger UI or orchestration changes and upstream syncs. Supports a computer-use subagent during authorized browser verification.
---

# Workbench visual spot check

Check the changed UI and its shared native T3 boundaries through a real client.
Use the baseline plus relevant modules in [the checklist](references/checklist.md).
This is a spot check, not the full opt-in
[Workbench regression pass](../workbench-regression-checklist/SKILL.md).
It complements focused tests and CI; a screenshot alone does not prove a flow works.

## Primary-agent handoff

The primary agent owns the checkout, fixture setup, server lifecycle, fixes and final acceptance.
For delegated work, use the registered `computer_use` profile when available.
Creating or invoking this skill does not grant browser or external-write authorization.
Reuse the current task's permission; clarify only what is missing.

Supply:

- Checkout path, tested commit, comparison base, changed areas and intended behavior changes.
- Actual demo URL, isolated home, client and a separate agent pairing link if needed.
- Representative Workspace, Ticket and linked/native Thread records; fixture expectations or baseline screenshots.
- Fixture fidelity: scripted or real provider, synthetic or real PR inspection, Jira connection state and known limitations.
- Permitted local fixture edits, worktree preparation, provider turns and remote operations; restoration obligations and report/evidence directory outside Git.

Use [workbench-demo](../workbench-demo/SKILL.md) for setup and fixture fidelity.
Use the client tooling authorized by the user. This repository's
[test-t3-app](../test-t3-app/SKILL.md) describes its built-in Browser panel;
explicit user authorization may select Chrome or another available client.
The subagent reuses the supplied runtime. It does not start or stop servers,
seed databases, edit source, commit, push or publish evidence.
Return setup problems to the primary agent and continue independent checks.

## Select coverage

Read the current [user guide](../../../docs/user/agent-workbench.md) and the relevant
changed controls before choosing cases. Use rendered controls and supported browser tools,
not guessed URLs, CSS selectors or labels from an older revision.

Run V1–V8 on the representative fixtures. Add the modules selected by the diff.
For an upstream sync, include C2, C3 and C4 because native Thread lifecycle,
PR surfaces and transcript rendering cross the Workbench boundary.
Select the other modules when their stated triggers apply.
Missing prerequisites for a selected case make it blocked, not not-applicable.
A planned behavior change needs its intended result recorded before comparison.

## Execute

1. Record the actual tested revision, client/build, demo URL/home and initial fixture state.
2. Inspect attention counts before opening Threads, which can acknowledge notifications.
   Record acknowledgments as retained changes when authorized controls cannot restore them.
3. Run the baseline and selected modules using visible controls. Compare rendered results
   with the stated contract and any supplied baseline.
4. Capture the changed view, an adjacent native/Workbench boundary and the narrow layout.
   Capture failures before attempting recovery. Use a short recording for timing defects when supported.
5. Check new console errors if the client exposes them. Record unavailable diagnostics separately.
6. Restore temporary viewport overrides and authorized fixture/configuration changes.
   Keep the owned runtime available for human review unless the task requests teardown.

Navigation and inspection do not authorize sending a provider message, modifying remote
Jira/GitHub data or destructive cleanup. Synthetic history proves rendering, not execution.
Fictional PR inspection fixtures do not prove checkout, rerun or other write actions.
A narrow web viewport does not prove native mobile support.

On failure, preserve the route, fixture, action and visible result. Distinguish a product
regression from an intended change, a fixture limitation or an unavailable service.
Report the issue to the primary agent; do not repair source or reset fixtures yourself.
After a primary-agent fix, repeat the failed path and affected neighbors on the new revision.

## Report

Save the report and evidence outside the checkout. Use one row per baseline or selected case:

| ID  | Result                                 | Actions and observed outcome | Evidence / limitation                      |
| --- | -------------------------------------- | ---------------------------- | ------------------------------------------ |
| V1  | pass / fail / blocked / not applicable | What was actually exercised  | Screenshot, route, recording or diagnostic |

Include the tested commit/base, client and viewport sizes, fixture fidelity, selected modules,
and reasons for unselected modules. List actionable failures, blocked coverage and retained
fixture changes. Remove credentials from URLs and evidence.

Finish when every baseline and selected case has a result and evidence or a specific blocker.
Report actual pass/fail/blocked totals and name incomplete coverage. The primary agent
validates the findings and owns acceptance; this report does not authorize merge or release.
