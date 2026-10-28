import { WorkbenchOperationError } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { TicketWorkspaceHost } from "@t3tools/workbench/TicketWorkspaceHost";
import {
  TicketWorkspaceServiceLive as serviceLayer,
  ticketWorkspaceBranchName,
} from "@t3tools/workbench/TicketWorkspaceService";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ServerConfig } from "../config.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import {
  TicketWorkspacePullRequestResolver,
  TicketWorkspacePullRequestResolverLive,
} from "./TicketWorkspacePullRequestResolver.ts";

export { TicketWorkspaceService } from "@t3tools/workbench/TicketWorkspaceService";

export const ticketWorkspaceHostLayer = Layer.effect(
  TicketWorkspaceHost,
  Effect.gen(function* () {
    const git = yield* GitWorkflowService;
    const projects = yield* ProjectStoreV2;
    const threads = yield* ThreadManagementService;
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
    const textGeneration = yield* TextGeneration.TextGeneration;
    const pullRequestResolver = yield* TicketWorkspacePullRequestResolver;
    const { worktreesDir } = yield* ServerConfig;
    return TicketWorkspaceHost.of({
      worktreesDir,
      generateBranchName: Effect.fn("TicketWorkspaceHost.generateBranchName")(function* (input) {
        const currentSettings = yield* serverSettings.getSettings.pipe(
          Effect.mapError(
            () =>
              new WorkbenchOperationError({
                code: "ticket_workspace_preparation_failed",
                message: "The branch naming settings could not be loaded.",
              }),
          ),
        );
        const settings = resolveProjectSettings(currentSettings, input.primaryT3ProjectId).settings;
        if (settings.branchNamingMode === "static") {
          return ticketWorkspaceBranchName({ ...input, prefix: settings.branchNamePrefix });
        }
        const project =
          input.primaryT3ProjectId === null
            ? Option.none()
            : yield* projects.getShell(input.primaryT3ProjectId).pipe(
                Effect.mapError(
                  () =>
                    new WorkbenchOperationError({
                      code: "ticket_workspace_preparation_failed",
                      message: "The Ticket's primary repository could not be loaded.",
                    }),
                ),
              );
        if (Option.isNone(project)) {
          return yield* new WorkbenchOperationError({
            code: "ticket_workspace_preparation_failed",
            message: "The Ticket's primary repository is unavailable.",
          });
        }
        const modelSelection =
          settings.sourceControlWriterModelSelection === null
            ? settings.textGenerationModelSelection
            : ServerSettings.resolveSourceControlWriterModelSelection(
                settings,
                yield* providerRegistry.getProviders,
                input.primaryT3ProjectId,
              );
        const title = input.issueLabel ? `${input.issueLabel}: ${input.title}` : input.title;
        const result = yield* textGeneration
          .generateBranchName({
            cwd: project.value.workspaceRoot,
            message: input.markdown ? `${title}\n\n${input.markdown}` : title,
            naming: {
              mode: settings.branchNamingMode,
              prefix: settings.branchNamePrefix,
              instructions: settings.branchNameInstructions,
            },
            modelSelection,
          })
          .pipe(
            Effect.mapError(
              () =>
                new WorkbenchOperationError({
                  code: "ticket_workspace_preparation_failed",
                  message:
                    "The Ticket Workspace branch name could not be generated. Check the source control writer model in Settings and retry.",
                }),
            ),
          );
        if (settings.branchNamingMode === "custom") return result.branch;
        const separator = result.branch.indexOf("/");
        return ticketWorkspaceBranchName({
          ...input,
          prefix: separator < 0 ? "" : result.branch.slice(0, separator),
          title: result.branch.slice(separator + 1),
        });
      }),
      resolveOpenPullRequestBranch: pullRequestResolver.resolveOpenPullRequestBranch,
      git: {
        fetchRemoteTrackingBranch: git.fetchRemoteTrackingBranch,
        listRefs: git.listRefs,
        createWorktree: git.createWorktree,
        removeWorktree: git.removeWorktree,
        localStatus: git.localStatus,
        invalidateLocalStatus: git.invalidateLocalStatus,
      },
      projections: {
        getProjectShellById: (id) =>
          projects.getShell(id).pipe(
            Effect.mapError(
              () =>
                new WorkbenchOperationError({
                  code: "ticket_workspace_preparation_failed",
                  message: "A Ticket repository could not be loaded from this environment.",
                }),
            ),
          ),
        getThreadShellById: (id) =>
          threads.getThreadShell(id).pipe(
            Effect.map(Option.fromNullishOr),
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
  Layer.provide(ticketWorkspaceHostLayer.pipe(Layer.provide(TextGeneration.layer))),
  Layer.provide(TicketWorkspacePullRequestResolverLive),
);
