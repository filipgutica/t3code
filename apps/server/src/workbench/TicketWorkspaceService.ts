import { WorkbenchOperationError } from "@t3tools/contracts";
import { TicketWorkspaceHost } from "@t3tools/workbench/TicketWorkspaceHost";
import { TicketWorkspaceServiceLive as serviceLayer } from "@t3tools/workbench/TicketWorkspaceService";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

export {
  TicketWorkspaceService,
  ticketWorkspaceBranchName,
} from "@t3tools/workbench/TicketWorkspaceService";

const hostLayer = Layer.effect(
  TicketWorkspaceHost,
  Effect.gen(function* () {
    const git = yield* GitWorkflowService;
    const projections = yield* ProjectionSnapshotQuery;
    const { worktreesDir } = yield* ServerConfig;
    return TicketWorkspaceHost.of({
      worktreesDir,
      git: {
        listRefs: git.listRefs,
        createWorktree: git.createWorktree,
        removeWorktree: git.removeWorktree,
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

export const TicketWorkspaceServiceLive = serviceLayer.pipe(Layer.provide(hostLayer));
