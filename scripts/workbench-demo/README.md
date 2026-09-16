# Workbench demo wizard

Set up an isolated local Workbench with sample repositories, tickets, Epics, and
threads. Connect it to existing GitHub/Jira demo resources, or create your own.

**Initial setup saves configuration.** Run the commands below to launch and seed
Workbench. On later runs, the wizard also offers `reset` to restore and launch the
saved baseline.

## 1. Run the wizard

Use the repository's Node version and install its dependencies (`vp i`). For
GitHub, install `gh` and sign in with `gh auth login`. From the repository root:

```sh
export DEMO_HOME="${DEMO_HOME:-$HOME/.t3-workbench-demos/guide}"
bash scripts/workbench-demo/setup.sh
```

- Press **Enter** to accept the displayed value; type a value to change it.
- Saved settings take priority over environment variables and detected defaults.
- GitHub defaults to your signed-in account. Known demo repository pairs are detected when possible.
- Saved secrets stay hidden; Enter retains them.
- With a complete saved profile, press Enter to skip setup, type `edit` to review it,
  or `reset` to restore the saved baseline.

The **demo home** is a separate data directory containing configuration, database,
credentials, and repository clones. The current checkout runs against that directory;
it is not another app installation. The profile is `$DEMO_HOME/config.env`.
Keep it private and choose another `DEMO_HOME` for a separate demo.

## 2. Choose existing or new remote demo resources

GitHub and Jira each have their own mode. You can mix them.

| Mode                                  | GitHub                                                                                                                     | Jira                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `reuse` — use existing demo resources | Uses your selected repositories and existing PRs. Does not create missing PR examples.                                     | Uses your selected project, board, and sprint. Imports existing issues assigned to your connected Jira account. Does not create Jira tickets. |
| `provision` — create demo resources   | Creates dedicated repositories, commits, branches, and draft/open/closed/merged PR examples when you run `github --apply`. | Creates two Epics, five tickets, and a demo sprint when you run `jira --apply`. Requires an existing site, project, and Scrum board.          |

**For the existing guide demo:** choose `reuse`, select `orbit-api,orbit-web` in
that order, and select the Orbit Demo Jira project (`ORBIT`) with its board and
sprint. Tickets such as `ORBIT-1` are imported if they belong to that sprint and
are assigned to your connected account. Other operators select their own resources.

“Reuse saved profile” at startup only skips configuration questions. It is
separate from these remote resource modes and does not verify access.

### What the fields mean

| Field                    | What to enter                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub owner             | The user or organization owning the demo repositories. Enter accepts the detected login.                                                                   |
| Repository names         | Two existing repositories, API first and web second. Used for `reuse`.                                                                                     |
| Repository prefix        | A name such as `workbench-demo` for identifying provisioned resources. Keep it unchanged on reruns.                                                        |
| Jira site / project key  | Enter the site URL; select the project by name. Its key is saved automatically.                                                                            |
| Board / sprint ID        | Select the Scrum board and sprint by name. The wizard saves their IDs.                                                                                     |
| Jira email / API token   | Required for the Jira selection menus and provisioning. Enter keeps saved credentials. Use a classic user API token.                                       |
| OAuth mode / broker URL  | `broker` (recommended) uses the hosted Workbench OAuth broker at `https://workbench-auth.fgutica.workers.dev`; `direct` uses your own Atlassian OAuth app. |
| OAuth client ID / secret | Required only for `direct`; these credentials are used by Workbench to connect Jira and are separate from the API token.                                   |
| Callback URL             | Required only for `direct`: register the actual running web origin plus `/workbench` (or the desktop callback) in that OAuth app.                          |

### Choosing Jira resources without IDs

Enter your Jira site URL, account email, and classic API token. The wizard then
fetches the choices you can access and displays numbered menus:

```text
Project:       Orbit Demo (ORBIT)
Scrum board:   Orbit Demo board
Sprint:        Guide demo sprint (active)
```

Choose a menu number or press Enter for the displayed default. The wizard saves
the project key, board ID, and sprint ID for you. Saved choices are defaults when
still available. In provision mode, skip sprint selection: provisioning creates
or finds the demo sprint later.

Find the **site URL** by opening Jira and copying its browser address. Full board
or ticket URLs are accepted; the wizard extracts and saves the site hostname. For `https://example.atlassian.net/browse/ORBIT-1`, enter
`https://example.atlassian.net`. Use the Jira site, not the Atlassian admin/login URL.
The wizard opens the [API-token page](https://id.atlassian.com/manage-profile/security/api-tokens)
when no token is saved. Use a classic token without scopes; scoped tokens are not
supported. This token is required for these setup menus even in reuse mode.
Workbench's browser OAuth consent is still a separate step.

If no projects, Scrum boards, or active/future sprints appear, check that your
account can access them. Create the missing resources in Jira before retrying.
Lookup failures stop setup without replacing the previously selected IDs.
Site/project creation and OAuth consent remain manual; the menus only read Jira.

## 3. Create remote examples, if you chose provision

**Skip this section for services set to `reuse`.** For each service set to
`provision`, preview the plan, then apply it:

```sh
node scripts/workbench-demo/cli.mts github --home "$DEMO_HOME" --preview
node scripts/workbench-demo/cli.mts github --home "$DEMO_HOME" --apply

node scripts/workbench-demo/cli.mts jira --home "$DEMO_HOME" --preview
node scripts/workbench-demo/cli.mts jira --home "$DEMO_HOME" --apply
```

These commands make real changes in the selected accounts. If Jira cannot reach
a requested state, such as Review or Closed, provisioning reports failure and
retains its partial results. Adjust the demo project's workflow before retrying.

## 4. Start and populate Workbench

In the first terminal, start the current checkout using the isolated demo home:

```sh
node scripts/workbench-demo/cli.mts start --home "$DEMO_HOME"
```

Keep it running. In a second terminal, set the same home and seed local data:

```sh
export DEMO_HOME="${DEMO_HOME:-$HOME/.t3-workbench-demos/guide}"
node scripts/workbench-demo/cli.mts seed --home "$DEMO_HOME"
```

Both remote modes create the local fixture: four repositories, two Workspaces,
four Epics, sixteen tickets, and four linked native threads. Configured GitHub
repositories are cloned and their PRs linked. No agent provider runs during seeding.

Open the **full pairing URL**, including its token, from the first terminal.
Connect Jira through Workbench's **Connect Jira → Connect Atlassian** flow.
The recommended broker mode needs no local client ID, client secret, or callback
registration. The deployed worker owns the Atlassian app credentials and callback.

Only in **direct** mode, register your actual callback before connecting. Web uses
its origin plus `/workbench`; desktop uses the server origin plus
`/oauth/workbench/jira/callback`. Ports can change if occupied.

After consent, import the Jira sprint and verify:

```sh
node scripts/workbench-demo/cli.mts sync-jira --home "$DEMO_HOME"
node scripts/workbench-demo/cli.mts verify --home "$DEMO_HOME" --jira
```

This adds an Orbit Jira Workspace with the imported work. Verification checks
local fixtures, configured GitHub PRs, and expected Jira imports. It does not
prove that Jira covers every requested workflow state.

## Rerun, stop, or reset

Ordinary reruns reuse local fixture IDs and marked remote resources. Remote
provisioning is not guaranteed duplicate-free: renamed Jira fixtures, removed
labels, a closed demo sprint, or concurrent runs can cause replacements.
Changing the owner, project, or prefix selects a different resource set. Unmarked
GitHub repositories are rejected by provisioning; use `reuse` for existing guide resources.

Stop with Ctrl-C in the first terminal, or run:

```sh
node scripts/workbench-demo/cli.mts stop --home "$DEMO_HOME"
```

For repeatable testing, use **reset-baseline** below. It preserves the Jira
connection and launches the seeded environment.

The lower-level `reset --apply` only archives the home and retains configuration
and remote resource IDs. It discards the active local database and connection.
Use it when you intend to start, seed, and connect Jira again.

For optional screenshot conversations, run `history --home "$DEMO_HOME"` while
stopped, then restart. It backs up the database and adds eight labeled synthetic
messages to display records only. These are not provider executions; reset before
using that environment to test real provider turns.

### Restore the shared regression baseline

Capture the intended Jira sprint once, using the configured classic API token:

```sh
node scripts/workbench-demo/cli.mts capture-baseline --home "$DEMO_HOME" --apply
```

Review and restore the baseline with the same reset used by CI:

```sh
node scripts/workbench-demo/cli.mts reset-baseline --home "$DEMO_HOME"
node scripts/workbench-demo/cli.mts reset-baseline --home "$DEMO_HOME" --apply --remote-apply
```

The reset archives local state, recreates the demo repositories and Workbench
fixtures, retains the Jira OAuth connection, and imports the saved sprint. Remote
reset restores recorded Jira issue fields and workflow states, returns extra
same-project sprint issues to the backlog, and deletes marked regression-only
issues. Use it only with the dedicated demo project. Omit `--remote-apply` to leave
remote Jira data unchanged. Local resets are not coordinated with CI: do not reset
the shared ORBIT sprint while a live CI job is using it.

The public Orbit repositories use pinned commits; Beacon uses synthetic local
repositories. GitHub remote branches and PRs are read, not reset. See the
[regression suite setup](../workbench-regression/README.md) for CI credentials,
coverage, and limits. For all commands, run
`node scripts/workbench-demo/cli.mts --help`.

## Broker configuration outside the wizard

For ordinary local development, set these variables in the server environment:

```sh
export T3_WORKBENCH_JIRA_BROKER_URL="https://workbench-auth.fgutica.workers.dev"
export T3_WORKBENCH_JIRA_CLIENT_ID=""
export T3_WORKBENCH_JIRA_CLIENT_SECRET=""
```

The wizard saves these values in the demo profile. An unbundled development
server needs the broker URL explicitly; released builds can use their bundled default.
Restart after changing configuration, then connect Jira once from that environment.

The worker handles authorization and token refresh. Each environment stores its
own grant and calls Jira directly. Use a separate local connection from the CI
grant because Atlassian rotates refresh tokens. Keep direct OAuth for developing
the authentication integration or operating your own Atlassian app.
