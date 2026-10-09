import { WorkbenchOperationError, type WorkbenchProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as WorkbenchStore from "./WorkbenchStore.ts";
import * as JiraSyncService from "./jira/JiraSyncService.ts";
import * as WorkbenchJiraRepository from "./jira/WorkbenchJiraRepository.ts";

export class WorkspaceLifecycleService extends Context.Service<
  WorkspaceLifecycleService,
  {
    readonly archive: WorkbenchStore.WorkbenchStore["Service"]["archiveProject"];
    readonly delete: WorkbenchStore.WorkbenchStore["Service"]["deleteProject"];
  }
>()("@t3tools/workbench/WorkspaceLifecycleService") {}

const make = Effect.gen(function* () {
  const store = yield* WorkbenchStore.WorkbenchStore;
  const sync = yield* JiraSyncService.JiraSyncService;
  const repository = yield* WorkbenchJiraRepository.WorkbenchJiraRepository;
  const readBindings = repository.listBindings().pipe(
    Effect.mapError(
      () =>
        new WorkbenchOperationError({
          code: "persistence_failed",
          message: "The Workspace's Jira configuration could not be loaded.",
        }),
    ),
  );

  // Jira I/O uses the binding permit before acquiring SQLite's writer lock.
  // Recheck the binding under that writer lock to cover first-time binding creation.
  const withWorkspacePermit = <A>(
    id: WorkbenchProjectId,
    operation: (bindingId: string | null) => Effect.Effect<A, WorkbenchOperationError>,
  ) =>
    Effect.gen(function* () {
      const binding = (yield* readBindings).find((candidate) => candidate.projectId === id);
      const mutate = operation(binding?.id ?? null);
      return yield* binding ? sync.withBindingPermit(binding.id, mutate) : mutate;
    });

  return WorkspaceLifecycleService.of({
    archive: (input) =>
      withWorkspacePermit(input.id, (expectedJiraBindingId) =>
        store.archiveProject({ ...input, expectedJiraBindingId }),
      ),
    delete: (input) =>
      withWorkspacePermit(input.id, (expectedJiraBindingId) =>
        store.deleteProject({ ...input, expectedJiraBindingId }),
      ),
  });
});

export const layer = Layer.effect(WorkspaceLifecycleService, make);
