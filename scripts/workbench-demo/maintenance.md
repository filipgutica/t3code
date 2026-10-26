# Demo maintenance

For normal sessions, use the [setup and run instructions](README.md). The
operations below are for dedicated demo resources and regression fixtures. List
the available helpers with `node scripts/workbench-demo/cli.mts --help --maintenance`.

## Create remote examples

Setup can reuse existing GitHub repositories. For new examples, select
`provision`. Preview its plan before applying:

```sh
node scripts/workbench-demo/cli.mts github --preview
node scripts/workbench-demo/cli.mts github --apply
```

Use `--home PATH` consistently for a nondefault profile. These commands make real
changes in the selected account.

Provisioning can create replacements when fixtures are renamed. Keep the
configured owner and prefix stable. Use `reuse` for existing repositories without the kit's ownership marker.

## Restore regression fixtures

Preview a reset, then apply it:

```sh
node scripts/workbench-demo/cli.mts reset-baseline
node scripts/workbench-demo/cli.mts reset-baseline --apply
```

This archives local state, recreates fixtures, and starts the server. Stop with
Ctrl-C. GitHub remote branches and PRs are read, not reset.

## Screenshot-only conversation fixtures

The `history` helper adds eight explicitly labeled synthetic messages to display
records in a stopped fixture and backs up the database first. These are not
provider executions. Discard that fixture before testing real provider turns.
Do not use it to represent real agent activity in product videos.
