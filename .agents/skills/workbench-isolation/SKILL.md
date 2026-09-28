---
name: workbench-isolation
description: Apply the Workbench fork isolation posture when planning or implementing Workbench features, fixes, refactors, or upstream conflict resolutions. Use before choosing owners or changing shared T3 code; completed diffs use workbench-isolation-review.
---

# Workbench isolation

Keep Workbench changes easy to carry through upstream T3 updates. Apply this posture alongside the active planning or engineering workflow; it does not authorize implementation or publication.

## Choose the owner before editing

Read [workbench-fork.md](../../../docs/internals/workbench-fork.md) for isolation and upstream-sync constraints, and [workbench-architecture.md](../../../docs/internals/workbench-architecture.md) for module ownership. For persistence or native record changes, also read [workbench-data-model.md](../../../docs/internals/workbench-data-model.md). Live code and types establish the available extension points.

Trace the affected native behavior and its Workbench callers. Prefer, in order:

1. Existing native behavior exposed through a supported prop, service, adapter, or context.
2. Workbench-owned logic and composition around that behavior.
3. A small shared integration that delegates to Workbench and preserves behavior for other callers.

For each proposed shared-file change, state its necessity, the existing extension points considered, and the behavior outside Workbench that must remain intact. Existing integration files are candidates, not blanket permission to add business rules there. A new hook earns its place only when current callers need it.

Keep native records authoritative. Check where lifecycle, persistence, transactions, and environment identity are owned before introducing Workbench state. Follow the documented ownership rules rather than cloning native models, components, or workflows to make integration convenient.

## Plan the proof

Name the affected entry points and clients, including the reverse action and non-Workbench path when applicable. Choose focused behavior checks and the relevant package boundary gate from the live repository scripts. Keep the verification proportional to the change; documentation-only changes need instruction and link validation, not application suites.

Surface a conflict between the requested behavior and isolation before committing to an implementation. Explain the smallest supported option and its tradeoff; keep progressing on independent authorized work.

After implementation, invoke [workbench-isolation-review](../workbench-isolation-review/SKILL.md) on the exact diff. The same review is required before opening or merging a Workbench PR; reuse current evidence when the reviewed scope and relevant refs have not changed.
