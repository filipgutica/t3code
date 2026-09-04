import {
  WorkbenchJiraOperationError,
  type WorkbenchJiraBeginAuthInput,
  type WorkbenchJiraBeginAuthResult,
  type WorkbenchJiraBinding,
  type WorkbenchJiraCompleteAuthInput,
  type WorkbenchJiraCompleteAuthResult,
  type WorkbenchJiraCreateBindingInput,
  type WorkbenchJiraSnapshot,
  type WorkbenchJiraUpdateBindingInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { WorkbenchStore } from "../WorkbenchStore.ts";
import { JiraApi, layer as jiraApiLayer, type JiraApiShape } from "./JiraApi.ts";
import { JiraAuthService, layer as jiraAuthLayer } from "./JiraAuthService.ts";
import { layer as jiraCredentialStoreLayer } from "./JiraCredentialStore.ts";
import { layer as jiraOAuthClientLayer } from "./JiraOAuthClient.ts";
import {
  JiraSyncService,
  layer as jiraSyncLayer,
  type JiraSyncServiceShape,
} from "./JiraSyncService.ts";
import { layer as jiraTicketImporterLayer } from "./JiraTicketImporter.ts";
import {
  WorkbenchJiraRepository,
  layerSql as workbenchJiraRepositoryLayer,
  type WorkbenchJiraRepositoryError,
} from "./WorkbenchJiraRepository.ts";

const operationError = (message: string) =>
  new WorkbenchJiraOperationError({ code: "invalid_binding", message });

const repositoryError = (_cause: WorkbenchJiraRepositoryError) =>
  new WorkbenchJiraOperationError({
    code: "persistence_failed",
    message: "Jira connection state could not be saved or loaded.",
  });

interface WorkbenchJiraServiceShape {
  readonly getSnapshot: Effect.Effect<WorkbenchJiraSnapshot, WorkbenchJiraOperationError>;
  readonly beginAuth: (
    input: WorkbenchJiraBeginAuthInput,
  ) => Effect.Effect<WorkbenchJiraBeginAuthResult, WorkbenchJiraOperationError>;
  readonly completeAuth: (
    input: WorkbenchJiraCompleteAuthInput,
  ) => Effect.Effect<WorkbenchJiraCompleteAuthResult, WorkbenchJiraOperationError>;
  readonly listProjects: JiraApiShape["listProjects"];
  readonly listBoards: JiraApiShape["listBoards"];
  readonly listSprints: JiraApiShape["listSprints"];
  readonly getBoardConfiguration: JiraApiShape["getBoardConfiguration"];
  readonly createBinding: (
    input: WorkbenchJiraCreateBindingInput,
  ) => Effect.Effect<WorkbenchJiraBinding, WorkbenchJiraOperationError>;
  readonly updateBinding: (
    input: WorkbenchJiraUpdateBindingInput,
  ) => Effect.Effect<WorkbenchJiraBinding, WorkbenchJiraOperationError>;
  readonly syncBinding: JiraSyncServiceShape["syncBinding"];
}

export class WorkbenchJiraService extends Context.Service<
  WorkbenchJiraService,
  WorkbenchJiraServiceShape
>()("t3/workbench/jira/WorkbenchJiraService") {}

export const make = Effect.gen(function* () {
  const api = yield* JiraApi;
  const auth = yield* JiraAuthService;
  const sync = yield* JiraSyncService;
  const repository = yield* WorkbenchJiraRepository;
  const workbench = yield* WorkbenchStore;

  const getSnapshot = Effect.gen(function* () {
    const connections = yield* repository.listConnections().pipe(Effect.mapError(repositoryError));
    const bindings = yield* repository.listBindings().pipe(Effect.mapError(repositoryError));
    const issueLinks = yield* Effect.forEach(bindings, (binding) =>
      repository.listIssueLinks(binding.id).pipe(Effect.mapError(repositoryError)),
    );
    return { connections, bindings, issueLinks: issueLinks.flat() } satisfies WorkbenchJiraSnapshot;
  });

  const validateBinding = Effect.fn("WorkbenchJiraService.validateBinding")(function* (input: {
    readonly projectId: WorkbenchJiraBinding["projectId"];
    readonly connectionId: WorkbenchJiraBinding["connectionId"];
    readonly defaultPrimaryT3ProjectId: WorkbenchJiraBinding["defaultPrimaryT3ProjectId"];
    readonly defaultRepositoryProjectIds: WorkbenchJiraBinding["defaultRepositoryProjectIds"];
    readonly statusMappings: WorkbenchJiraBinding["statusMappings"];
  }) {
    const connection = yield* repository
      .getConnection(input.connectionId)
      .pipe(Effect.mapError(repositoryError));
    if (Option.isNone(connection)) {
      return yield* operationError("The selected Jira site is no longer connected.");
    }
    const snapshot = yield* workbench.getSnapshot.pipe(
      Effect.mapError(() =>
        operationError("The selected Workbench Workspace could not be loaded."),
      ),
    );
    const workspace = snapshot.projects.find((project) => project.id === input.projectId);
    if (!workspace)
      return yield* operationError("The selected Workbench Workspace does not exist.");
    const selectedRepositories = new Set(input.defaultRepositoryProjectIds);
    if (!selectedRepositories.has(input.defaultPrimaryT3ProjectId)) {
      return yield* operationError(
        "The primary repository must be included in the Jira Ticket scope.",
      );
    }
    if (
      input.defaultRepositoryProjectIds.length === 0 ||
      input.defaultRepositoryProjectIds.some((id) => !workspace.linkedProjectIds.includes(id))
    ) {
      return yield* operationError(
        "Jira Tickets can only use repositories linked to this Workspace.",
      );
    }
    if (input.statusMappings.length === 0) {
      return yield* operationError("Map at least one Jira status to a Workbench column.");
    }
    const statusIds = input.statusMappings.map((mapping) => mapping.jiraStatusId);
    if (new Set(statusIds).size !== statusIds.length) {
      return yield* operationError("Each Jira status can be mapped only once.");
    }
  });

  const createBinding: WorkbenchJiraServiceShape["createBinding"] = (input) =>
    Effect.gen(function* () {
      yield* validateBinding(input);
      const existingBindings = yield* repository
        .listBindings()
        .pipe(Effect.mapError(repositoryError));
      if (existingBindings.some((binding) => binding.projectId === input.projectId)) {
        return yield* operationError("This Workbench Workspace already has a Jira binding.");
      }
      const binding = {
        ...input,
        active: true,
        lastSyncedAt: null,
        updatedAt: input.createdAt,
      } satisfies WorkbenchJiraBinding;
      yield* repository.upsertBinding(binding).pipe(Effect.mapError(repositoryError));
      return binding;
    });

  const updateBinding: WorkbenchJiraServiceShape["updateBinding"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* repository
        .getBinding(input.id)
        .pipe(Effect.mapError(repositoryError));
      if (Option.isNone(existing)) {
        return yield* new WorkbenchJiraOperationError({
          code: "binding_not_found",
          message: "The Jira sprint binding was not found.",
        });
      }
      yield* validateBinding({
        ...input,
        projectId: existing.value.projectId,
        connectionId: existing.value.connectionId,
      });
      const binding = { ...existing.value, ...input } satisfies WorkbenchJiraBinding;
      yield* repository.upsertBinding(binding).pipe(Effect.mapError(repositoryError));
      return binding;
    });

  const syncActiveBindings = repository.listBindings().pipe(
    Effect.mapError(repositoryError),
    Effect.flatMap((bindings) =>
      Effect.forEach(
        bindings.filter((binding) => binding.active),
        (binding) =>
          sync.syncBinding({ bindingId: binding.id }).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Workbench Jira background sync failed", {
                bindingId: binding.id,
                code: cause.code,
                message: cause.message,
              }),
            ),
          ),
        { concurrency: 1 },
      ),
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning("Workbench Jira background sync could not list bindings", { cause }),
    ),
  );
  yield* Effect.forever(Effect.sleep("5 minutes").pipe(Effect.andThen(syncActiveBindings)), {
    disableYield: true,
  }).pipe(Effect.forkScoped);

  return WorkbenchJiraService.of({
    getSnapshot,
    beginAuth: auth.begin,
    completeAuth: auth.complete,
    listProjects: api.listProjects,
    listBoards: api.listBoards,
    listSprints: api.listSprints,
    getBoardConfiguration: api.getBoardConfiguration,
    createBinding,
    updateBinding,
    syncBinding: sync.syncBinding,
  });
});

export const layer = Layer.effect(WorkbenchJiraService, make);

const authLayer = jiraAuthLayer.pipe(
  Layer.provide(jiraCredentialStoreLayer),
  Layer.provide(jiraOAuthClientLayer),
  Layer.provideMerge(workbenchJiraRepositoryLayer),
);

const apiLayer = jiraApiLayer.pipe(
  Layer.provide(authLayer),
  Layer.provideMerge(workbenchJiraRepositoryLayer),
);

const syncLayer = jiraSyncLayer.pipe(
  Layer.provide(apiLayer),
  Layer.provide(jiraTicketImporterLayer),
  Layer.provideMerge(workbenchJiraRepositoryLayer),
);

export const layerLive = layer.pipe(
  Layer.provideMerge(authLayer),
  Layer.provideMerge(apiLayer),
  Layer.provideMerge(syncLayer),
  Layer.provideMerge(jiraTicketImporterLayer),
  Layer.provideMerge(workbenchJiraRepositoryLayer),
);
