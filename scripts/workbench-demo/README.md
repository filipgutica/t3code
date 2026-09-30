# Workbench demo

Run the current checkout with fresh Tickets, repositories, native Threads, linked
PRs, and connected Jira:

```sh
bash scripts/workbench-demo/run.sh
```

Open the printed pairing URL in your preferred browser. **Ctrl-C stops the server
and removes the run.** Each run starts fresh; configuration and Jira authorization
are retained in `~/.t3-workbench-demos/guide`. Remote GitHub and Jira data are left
unchanged.

## Set up once

Use the repository's Node version, install dependencies with `vp i`, and sign in
with `gh auth login`. Then run:

```sh
bash scripts/workbench-demo/setup.sh
```

The wizard saves your choices, starts and seeds Workbench, and pauses for Jira
browser authorization. After you connect Atlassian and continue, it syncs the
selected sprint, records the baseline, verifies the connection, and stops the
setup server. Future sessions need only `run.sh`.

Have these ready:

- Two GitHub demo repositories, API first and web second, with existing PRs.
- A Jira Software project, Scrum board, and dedicated demo sprint whose issues
  are all assigned to your connected account.
- Your Atlassian email and a **classic API token without scopes**, used to list
  choices and record the baseline. Workbench's OAuth consent is separate.

Choose **reuse** for existing remote resources and **broker** for the hosted Jira
OAuth flow. The broker needs no local OAuth client secret or callback registration.
The guide profile uses `orbit-api,orbit-web` and the `ORBIT` Jira project; select
your own resources when setting up another account.

Saved values are offered on reruns; secrets stay hidden. Rerun setup to complete
an interrupted authorization or choose `edit` to update credentials. Use a separate
profile when switching Jira projects, boards, or sprints: set `DEMO_HOME` for setup
and run, or pass `--home PATH` to `run.sh`.
Keep profiles outside temporary folders and private: `config.env` contains secrets.

## Private-preview attention fixtures

Every fresh private PR preview automatically seeds the **Synthetic attention
fixtures** Epic in Orbit. Ticket and Thread titles start with `[Synthetic
attention]`. No provider ran: interrupted/completed turn outcomes are labelled,
projection-only demo data written while the seeding server is stopped.

| Ticket name after the prefix   | Needs attention | Ready for review | Expected reason after inspection                                        |
| ------------------------------ | --------------- | ---------------- | ----------------------------------------------------------------------- |
| Waiting Thread                 | Yes             | No               | Waiting for input                                                       |
| Review-ready work              | Yes             | Yes              | Ready for review                                                        |
| Failed PR checks               | Yes             | No               | Failed PR checks                                                        |
| Unresolved PR feedback         | Yes             | No               | Failed PR checks · PR changes requested · Unresolved PR feedback        |
| Clean Ticket                   | No              | No               | None                                                                    |
| Excluded settled Thread        | No              | No               | Settled Thread is excluded despite its interrupted outcome              |
| Excluded archived Thread       | No              | No               | Archived Thread is excluded despite its interrupted outcome             |
| Excluded superseded Thread     | No              | No               | Interrupted historical assignment is excluded; replacement is clean     |
| Non-primary Thread needs input | Yes             | No               | Waiting for input from the older assignment; newest assignment is clean |
| PR inspection unavailable      | Yes             | No               | PR attention unavailable                                                |
| PR inspection incomplete       | Yes             | No               | PR attention unknown; review comments are intentionally truncated       |
| Slow PR inspection             | Initially       | No               | PR attention loading, then disappears after a complete clean inspection |

In **All**, waiting, review-ready, failed-check, and non-primary Thread fixtures
each show a bell with **1**. Unresolved PR feedback shows **3**: failed checks on
PR 901, changes requested on PR 902, and unresolved feedback on PR 902.
Clean and excluded fixtures have no bell. The count
represents actionable signals per source, not unread notifications. Opening a
popover does not clear attention.

The feedback Ticket has two active Threads: the original links PRs **901 and
902**, and the **shared PR assignment** links PR **902** again. Its two PR sources
remain distinct; sharing PR 902 does not duplicate its signals. PR 902 contains
two unresolved discussions, in `synthetic.txt` and `src/invitations.ts`, with
separate questions and destinations, plus one requested-changes review.
PR 901 contains two failed checks (**API tests** and **Web tests**) in the same
synthetic **Attention CI** workflow. These checks share one failed-check signal.
Turn on the sidebar's bell filter to compare both feedback assignments: both
remain visible because they link PR 902, while only the original also links
the failed PR 901. The sidebar filter includes the five confirmed-action Tickets;
inspection-only examples stay out, with a coverage note when inspection is incomplete.
The newest clean assignment on **Non-primary Thread needs input** still has no
PR links or attention; only its older Thread needs input.

Click a bell on the Board or sidebar. Check the source and reason, then open its
Thread, failed checks, requested changes, or exact review discussion. The Ticket
header has the same popover. Its **Needs attention** section, above Agent Threads,
keeps the same actions visible and can be collapsed.

Select **Needs attention**, wait for the finite slow inspection, and check these
memberships and reasons. Five linked PRs are inspected; three are complete and
two deliberately remain unavailable/incomplete. These coverage warnings do not
increase the bell count. Open their Tickets to see the inspection status.
Use **Refresh linked PRs** to repeat inspection and confirm it finishes.
Select **Ready for review** to isolate the review-ready Ticket. Navigate away and
back to check filter persistence. Search for `no-matching-synthetic-ticket`, then
use **Clear filters** to restore All.
Search for an excluded Ticket in All and inspect
its Thread history or settled section to confirm why it was omitted.

The hosted demo has one environment. Other-environment exclusion is covered by
`workbenchAttention.logic.test.ts`; a foreign environment cannot honestly be
seeded as a local native Thread. This fixture does not claim a multi-environment
runtime verification.

Synthetic PRs 901–905 belong to the fictional
`workbench-synthetic/attention-fixtures` repository. A credential-free executable
adapter supplies only their allowlisted inspection data; it never forwards a
command to GitHub. On Failed PR checks, open the PR and choose **Rerun failed
checks**: expect a clearly labelled refusal and no success claim. Verify a real
GitHub rerun separately with an expendable failing PR and Actions write permission.
Normal local `run.sh` demos continue to use real GitHub CLI and configured remotes;
the synthetic adapter is installed only by private-preview startup.

## Troubleshooting

- **Jira authorization fails:** check the signed-in Atlassian account and its site
  access. In direct OAuth mode, the app must allow that account and register the
  actual web origin plus `/workbench`; ports can change. Prefer the hosted broker.
- **No Jira issues:** confirm the selected sprint contains issues assigned to the
  connected account, then rerun setup to refresh the baseline.
- **Interrupted cleanup:** use the run path reported by startup:

  ```sh
  node scripts/workbench-demo/cli.mts recover --run /absolute/path/to/retained/run
  ```

  Include `--home PATH` for a nondefault profile. Recovery preserves refreshed
  authorization before removing the run. Do not manually delete its lock or
  credentials.

## Maintainer operations

Remote provisioning and shared regression resets are maintenance operations,
not demo startup steps. See [maintenance](maintenance.md) when creating remote
examples or repairing CI fixtures, and the
[regression suite](../workbench-regression/README.md) for CI setup.
