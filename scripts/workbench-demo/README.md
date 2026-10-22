# Workbench demo

Run the current checkout with fresh Tickets, repositories, native Threads,
synthetic linked PRs, and connected Jira:

```sh
bash scripts/workbench-demo/run.sh
```

Open the printed pairing URL in your preferred browser. **Ctrl-C stops the server
and removes the run.** Each run starts fresh; configuration and Jira authorization
are retained in `~/.t3-workbench-demos/guide`. Remote GitHub and Jira data are left
unchanged.

Each run enables supported provider CLIs found on your `PATH`, preserving explicit
provider settings from the saved demo profile. Providers use their normal local
configuration and authentication; seeding does not copy provider credentials or install tools.
Installed providers may still need authentication in Settings → Providers.

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

## Update synthetic local data

Edit the repository, Workspace, Epic, Ticket, and assigned Thread fixtures in
[`local.mts`](local.mts). Each Ticket has an explicit stable ID; assigned Threads
refer to that ID. Keep an existing ID when changing a title or moving a fixture
row, because browser regressions and prepared worktrees refer to those IDs.
`setupLocal` writes records through the native RPC path, and `verifyLocal` checks
the resulting snapshot and Git worktrees. Run the focused demo tests and a
browser scenario that uses the changed fixture before relying on it in a preview.

The shared attention scenarios live in [`attention.mts`](attention.mts). Both
local runs and private PR previews seed them. They are labelled synthetic and
use a read-only GitHub adapter.

## Attention fixtures

Every fresh local run and private PR preview seeds the **Synthetic attention
fixtures** Epic in Orbit. Ticket and Thread titles start with `[Synthetic
attention]`. No provider ran: interrupted/completed turn outcomes are labelled,
projection-only demo data written while the seeding server is stopped.

| Ticket name after the prefix   | Needs attention | Agent replies | Expected badge after inspection                                          |
| ------------------------------ | --------------- | ------------- | ------------------------------------------------------------------------ |
| Waiting Thread                 | No              | No            | None; an interrupted run is not a reason                                 |
| Review-ready work              | Yes             | Yes           | Done                                                                     |
| Failed PR checks               | Yes             | No            | Checks failed                                                            |
| Unresolved PR feedback         | Yes             | No            | Checks failed +1 (failed checks on PR 901, feedback on PR 902)           |
| Clean Ticket                   | No              | No            | None                                                                     |
| Excluded settled Thread        | No              | No            | None; settled Threads are excluded                                       |
| Excluded archived Thread       | No              | No            | None; archived Threads are excluded                                      |
| Excluded superseded Thread     | No              | No            | None; the historical assignment is excluded and its replacement is clean |
| Non-primary Thread needs input | No              | No            | None; its older assignment only has an interrupted run                   |
| PR inspection unavailable      | No              | No            | Inspection unavailable; no confirmed action                              |
| PR inspection incomplete       | No              | No            | Inspection incomplete; no confirmed action                               |
| Slow PR inspection             | No              | No            | Loading coverage, then a complete clean inspection                       |

Each badge shows the most urgent reason, then **+N** for other reason kinds.
Requested changes and unresolved discussions count as one **Feedback** reason.
The seeded questions sit in interrupted runs, so they stay readable in their
Threads but do not raise attention. No fixture has a pending native request, so
the demo does not show **Input** or **Approval**; unit tests cover those reasons.
Visiting a Thread clears its **Done** notification. PR actions remain until their
source resolves.

The feedback Ticket (`synthetic-attention-feedback`) has a long Markdown
description, scopes **Orbit Web and Orbit API**, and has three active native
Threads, all belonging to the Ticket's primary **Orbit Web** Project. The original
links PRs **901 and 902**; the **shared PR assignment** links
PR **902** again. The **API contract review** Thread links the clean PR **906** in
`workbench-synthetic/attention-api`. Its three PR identities remain distinct;
sharing PR 902 does not duplicate its signals. PR 902 contains
two unresolved discussions, in `synthetic.txt` and `src/invitations.ts`, with
separate destinations, plus one requested-changes review.
PR 901 contains two failed checks (**API tests** and **Web tests**) in the same
synthetic **Attention CI** workflow. These checks share one failed-check signal.

Click a badge on the Board or sidebar. The card groups reasons by Thread and PR,
with **Open thread**, **View checks**, **View review**, or **View threads**. The
Ticket header has the same reasons. Its **Needs attention** section, above Agent
Threads, keeps the same actions visible and can be collapsed.

In the sidebar, open the filter menu beside search and turn on **Needs
attention**. Expect the three confirmed-action Tickets, sorted by urgency. Both
feedback assignments remain because they link PR 902; only the original also
links the failed PR 901. The clean API assignment is excluded. Remove the filter
with its chip. Workspace and Ticket chevrons still collapse and expand while the
filter is on, and text search expands matching groups until it is cleared.

On the Board, select **Needs attention** to see the same three Tickets. The
separate environment inspection line shows four of six linked PRs fully
inspected; two deliberately remain unavailable/incomplete. Use the **Refresh
linked PRs** icon to repeat inspection and confirm it finishes. Loading or
uncertain coverage alone does not add a Ticket to either attention filter.
In **All**, open the unavailable/incomplete examples: their **PR inspection**
section explains the status and offers **Refresh**. Known actions remain visible
while refreshing their PR inspection.
Select **Agent replies** to isolate the **Review-ready work** fixture before
visiting its Thread. This fixture records a completed turn, not task completion. Navigate away and
back to check filter persistence. Search for `no-matching-synthetic-ticket`, then
use **Clear filters** to restore All.
Search for an excluded Ticket in All and inspect
its Thread history or settled section to confirm why it was omitted.

The hosted demo has one environment. Other-environment exclusion is covered by
`workbenchAttention.logic.test.ts`; a foreign environment cannot honestly be
seeded as a local native Thread. This fixture does not claim a multi-environment
runtime verification.

Synthetic PRs 901–905 belong to the fictional
`workbench-synthetic/attention-fixtures` repository; PR 906 belongs to the separate
fictional `workbench-synthetic/attention-api` repository. A credential-free executable
adapter supplies only their allowlisted inspection data; it never forwards a
command to GitHub and refuses every write. Local `run.sh` uses the same adapter for PR inspection and does not link the
configured repositories' real PRs. Setup and maintenance still use the real
GitHub CLI for those repositories; the disposable run keeps their code and
remotes.

For long-description visual checks, use `orbit-001` (**Create the welcome checklist**)
or `beacon-009` (**Build an interactive setup command**). Both keep their original
Ticket IDs and assignments and contain explicitly labelled synthetic specifications
with paragraphs, headings, bullets, checklists, a table, fenced code, links, and long
inline values. Local runs and private previews consume these same fixtures.

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
