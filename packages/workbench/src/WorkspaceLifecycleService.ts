import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as WorkbenchStore from "./WorkbenchStore.ts";

export class WorkspaceLifecycleService extends Context.Service<
  WorkspaceLifecycleService,
  {
    readonly archive: WorkbenchStore.WorkbenchStore["Service"]["archiveProject"];
    readonly delete: WorkbenchStore.WorkbenchStore["Service"]["deleteProject"];
  }
>()("@t3tools/workbench/WorkspaceLifecycleService") {}

const make = Effect.gen(function* () {
  const store = yield* WorkbenchStore.WorkbenchStore;
  return WorkspaceLifecycleService.of({
    archive: store.archiveProject,
    delete: store.deleteProject,
  });
});

export const layer = Layer.effect(WorkspaceLifecycleService, make);
