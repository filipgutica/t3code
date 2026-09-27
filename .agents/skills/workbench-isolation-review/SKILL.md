---
name: workbench-isolation-review
description: Review Workbench isolation after implementation, before opening a Workbench PR, and before merging one. Assess the exact diff, shared T3 integrations, package boundaries, and incremental upstream-sync risk. Planning and implementation posture use workbench-isolation.
---

# Workbench isolation review

Review the completed change against the fork's ownership and upstream maintenance constraints. This workflow is read-only with respect to product code and external publication. Run scoped checks and read-only Git inspections; fixes, browser verification, PR creation, and merging require their own authorization.

## Pin the subject

Verify the repository, remotes, dirty state, and exact base/head or working-tree scope. Keep unrelated edits outside the review. Read [workbench-fork.md](../../../docs/internals/workbench-fork.md) for authoritative ownership and sync rules.

Before a PR is opened, review the intended committed range. Before merge, verify the remote PR's current base/head and current required checks. Reuse earlier review evidence only when its scope remains current; review new commits and refresh evidence affected by base or upstream movement.

## Inspect the boundaries

Classify every changed file against the documented ownership boundaries. For each upstream-owned integration, verify:

- The change is needed; a current native extension point or Workbench adapter cannot own it cleanly.
- Workbench rules and state remain with their documented owner; shared code delegates rather than reproducing the feature.
- Existing signatures, defaults, and behavior for non-Workbench callers remain intact unless the user authorized a contract change.
- Native records and lifecycle remain authoritative, and environment identity survives the integration.

Trace relevant callers, types, and tests. Check for copied native implementations, application imports from the Workbench package (including test helpers), unnecessary shared exports, and changes to native persistence or transaction ownership. Directory placement alone does not prove isolation.

## Verify proportionately

For code changes affecting the package, application overlay, or shared integration, run the documented package typecheck/boundary gate from the repository root:

```sh
vp run --filter @t3tools/workbench typecheck
```

Use focused application tests, typechecks, or current CI for affected behavior. For instruction-only changes, validate instructions, links, and commands. The package gate proves package import/dependency isolation; it does not prove UI ownership, compatibility, or future merge safety. Report unavailable checks as unverified.

## Compare upstream risk

For a committed implementation, resolve one upstream SHA from the verified upstream remote. Refresh the ref when network access is available; otherwise identify its age as unknown or cached. Compare the PR base and head against that same SHA using the repository's read-only preview:

```sh
node scripts/workbench-upstream-sync.ts --product <base-sha> --upstream <upstream-sha>
node scripts/workbench-upstream-sync.ts --product <head-sha> --upstream <upstream-sha>
```

Verify command options against the live script. Inspect both overlap and conflict paths: distinguish existing conflicts from new paths and inspect changed conflict regions when paths stay the same. A shared-file edit can increase maintenance cost even when Git merges it cleanly.

The preview examines committed refs. For an uncommitted review, report that limitation and defer the final preview until the intended head is committed. Keep previews separate from actual upstream synchronization. A clean preview establishes only compatibility with the tested upstream SHA.

## Return evidence

Report the reviewed scope, action-required findings with file/line and consequence, justified shared integrations, check results, and incremental sync risk. Distinguish confirmed defects, maintenance tradeoffs, and unverified behavior. State whether review was independent. An isolation review neither authorizes publication nor replaces behavioral review or a test audit.
