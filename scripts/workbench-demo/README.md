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
