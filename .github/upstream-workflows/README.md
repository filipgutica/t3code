# Retained upstream workflows

These workflow sources are archived for the Workbench fork. GitHub discovers
workflows in `.github/workflows`, so files here do not start builds, deployments,
scheduled runs, or manual Actions dispatches.

The files retain their previous contents. Git renames allow upstream edits to
follow the source into this directory. Review any new or restored active
workflow during upstream sync; this directory does not block a newly introduced
workflow elsewhere.

Workbench CI, quality, browser and desktop verification, private PR previews,
the static showcase, and manual Workbench packaging remain active. See
[CI ownership](../../docs/internals/workbench-fork.md#ci-ownership) and the
[verification guide](../../docs/operations/workbench-verification.md).

The archived release and macOS preview sources still reference the retained
`release-desktop.yml` and `publish-aur.yml` reusable helpers. The archived files
are reference material, not callable workflows. Restoring one requires explicit
review of its triggers, runner, product identity, and deployment permissions.
