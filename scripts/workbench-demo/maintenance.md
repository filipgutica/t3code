# Demo maintenance

For normal sessions, use the [setup and run instructions](README.md). The
operations below are for dedicated demo resources and regression fixtures. List
the available helpers with `node scripts/workbench-demo/cli.mts --help --maintenance`.

## Create remote examples

Setup can reuse existing GitHub repositories and Jira issues. For new examples,
select `provision` for the relevant service. Preview its plan before applying:

```sh
node scripts/workbench-demo/cli.mts github --preview
node scripts/workbench-demo/cli.mts github --apply
node scripts/workbench-demo/cli.mts jira --preview
node scripts/workbench-demo/cli.mts jira --apply
```

Use `--home PATH` consistently for a nondefault profile. These commands make real
changes in the selected accounts. Jira requires an existing site, project, and
Scrum board. If its workflow cannot reach a requested state, provisioning fails
and retains partial results. Fix the workflow before retrying.

Provisioning can create replacements when fixtures are renamed, labels are
removed, or a sprint is closed. Keep the configured owner, project, and prefix
stable. Use `reuse` for existing repositories without the kit's ownership marker.

## Restore regression fixtures

The regression suite uses a recorded Jira baseline. To intentionally replace it
with the current sprint contents:

```sh
node scripts/workbench-demo/cli.mts capture-baseline --apply
```

Preview a reset, then apply only to a dedicated demo project:

```sh
node scripts/workbench-demo/cli.mts reset-baseline
node scripts/workbench-demo/cli.mts reset-baseline --apply --remote-apply
```

This archives local state, recreates fixtures, retains Jira OAuth, and starts the
server. Stop with Ctrl-C. With `--remote-apply`, it also restores recorded issue
fields and workflow states, returns extra same-project sprint issues to the
backlog, and deletes marked regression-only issues. Omit that flag to leave
remote Jira unchanged. Never reset the shared sprint during a live CI job.

GitHub remote branches and PRs are read, not reset. Use a separate Jira OAuth
grant for CI because Atlassian rotates refresh tokens. See the
[regression suite](../workbench-regression/README.md) for private grant export.

## Screenshot-only conversation fixtures

The `history` helper adds eight explicitly labeled synthetic messages to display
records in a stopped fixture and backs up the database first. These are not
provider executions. Discard that fixture before testing real provider turns.
Do not use it to represent real agent activity in product videos.

## Direct OAuth

Choose direct OAuth only when testing that integration or using your own
Atlassian app. Register the actual web origin plus `/workbench`, or the server
origin plus `/oauth/workbench/jira/callback` for desktop. The hosted broker owns
its callback and app credentials; each local environment retains its own grant.
