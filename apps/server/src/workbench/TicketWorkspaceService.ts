import { WorkbenchOperationError } from "@t3tools/contracts";
import { TicketWorkspaceHost } from "@t3tools/workbench/TicketWorkspaceHost";
import { TicketWorkspaceServiceLive as serviceLayer } from "@t3tools/workbench/TicketWorkspaceService";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ServerConfig } from "../config.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
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
    const pullRequestResolver = yield* TicketWorkspacePullRequestResolver;
    const { worktreesDir } = yield* ServerConfig;
    return TicketWorkspaceHost.of({
      worktreesDir,
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
  Layer.provide(ticketWorkspaceHostLayer),
  Layer.provide(TicketWorkspacePullRequestResolverLive),
);
