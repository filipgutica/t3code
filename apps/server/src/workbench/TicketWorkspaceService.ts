import { WorkbenchOperationError } from "@t3tools/contracts";
import { TicketWorkspaceHost } from "@t3tools/workbench/TicketWorkspaceHost";
import { TicketWorkspaceServiceLive as serviceLayer } from "@t3tools/workbench/TicketWorkspaceService";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import {
  resolveSourceControlWriterModelSelection,
  ServerSettingsService,
} from "../serverSettings.ts";
import { TextGeneration, layer as textGenerationLayer } from "../textGeneration/TextGeneration.ts";

export { TicketWorkspaceService } from "@t3tools/workbench/TicketWorkspaceService";

export const ticketWorkspaceHostLayer = Layer.effect(
  TicketWorkspaceHost,
  Effect.gen(function* () {
    const git = yield* GitWorkflowService;
    const projections = yield* ProjectionSnapshotQuery;
    const settings = yield* ServerSettingsService;
    const providers = yield* ProviderRegistry;
    const textGeneration = yield* TextGeneration;
    const { worktreesDir } = yield* ServerConfig;
    return TicketWorkspaceHost.of({
      worktreesDir,
      generateBranchName: Effect.fn("TicketWorkspaceHost.generateBranchName")(
        function* ({ cwd, title, description }) {
          const currentSettings = yield* settings.getSettings;
          const modelSelection =
            currentSettings.sourceControlWriterModelSelection === null
              ? currentSettings.textGenerationModelSelection
              : resolveSourceControlWriterModelSelection(
                  currentSettings,
                  yield* providers.getProviders,
                );
          const result = yield* textGeneration.generateBranchName({
            cwd,
            message: `${title}\n\n${description}`,
            modelSelection,
          });
          return result.branch;
        },
        Effect.mapError(
          (error) =>
            new WorkbenchOperationError({
              code: "ticket_workspace_preparation_failed",
              message: `Could not generate a branch name with the configured text generation model: ${error.message}`,
            }),
        ),
      ),
      git: {
        listRefs: git.listRefs,
        createWorktree: git.createWorktree,
        removeWorktree: git.removeWorktree,
        localStatus: git.localStatus,
        invalidateLocalStatus: git.invalidateLocalStatus,
      },
      projections: {
        getProjectShellById: (id) =>
          projections.getProjectShellById(id).pipe(
            Effect.mapError(
              () =>
                new WorkbenchOperationError({
                  code: "ticket_workspace_preparation_failed",
                  message: "A Ticket repository could not be loaded from this environment.",
                }),
            ),
          ),
        getThreadShellById: (id) =>
          projections.getThreadShellById(id).pipe(
            Effect.mapError(
              () =>
                new WorkbenchOperationError({
                  code: "ticket_workspace_preparation_failed",
                  message: "The assigned Agent Thread could not be loaded.",
                }),
            ),
          ),
      },
    });
  }),
);

export const TicketWorkspaceServiceLive = serviceLayer.pipe(
  Layer.provide(ticketWorkspaceHostLayer.pipe(Layer.provide(textGenerationLayer))),
);
