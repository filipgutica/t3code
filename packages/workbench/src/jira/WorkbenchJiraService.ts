import {
  WorkbenchJiraOperationError,
  type WorkbenchJiraBeginAuthInput,
  type WorkbenchJiraBeginAuthResult,
  type WorkbenchJiraBinding,
  type WorkbenchJiraBoardMode,
  type WorkbenchJiraCompleteAuthInput,
  type WorkbenchJiraCompleteAuthResult,
  type WorkbenchJiraCreateBindingInput,
  type WorkbenchJiraSnapshot,
  type WorkbenchJiraSelectedSprint,
  type WorkbenchJiraSprint,
  type WorkbenchJiraUpdateBindingInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { WorkbenchStore } from "../WorkbenchStore.ts";
import { JiraApi, type JiraApiShape } from "./JiraApi.ts";
import { JiraAuthService } from "./JiraAuthService.ts";
import {
  JiraSyncService,
  mirrorStatusMappings,
  type JiraSyncServiceShape,
} from "./JiraSyncService.ts";
import {
  JiraTicketWriteService,
  type JiraTicketWriteServiceShape,
} from "./JiraTicketWriteService.ts";
import {
  WorkbenchJiraRepository,
  type WorkbenchJiraRepositoryError,
} from "./WorkbenchJiraRepository.ts";

const operationError = (message: string) =>
  new WorkbenchJiraOperationError({ code: "invalid_binding", message });

const repositoryError = (_cause: WorkbenchJiraRepositoryError) =>
  new WorkbenchJiraOperationError({
    code: "persistence_failed",
    message: "Jira connection state could not be saved or loaded.",
  });

const legacySelectedSprints = (binding: Pick<WorkbenchJiraBinding, "sprintId" | "sprintName">) =>
  [
    { id: binding.sprintId, name: binding.sprintName },
  ] satisfies ReadonlyArray<WorkbenchJiraSelectedSprint>;

const selectedSprintsForBinding = (
  binding: Pick<WorkbenchJiraBinding, "sprintId" | "sprintName" | "selectedSprints">,
) =>
  binding.selectedSprints.length > 0 ? binding.selectedSprints : legacySelectedSprints(binding);

const sameSelectedSprints = (
  left: ReadonlyArray<WorkbenchJiraSelectedSprint>,
  right: ReadonlyArray<WorkbenchJiraSelectedSprint>,
) =>
  left.length === right.length &&
  left.every(
    (sprint, index) => sprint.id === right[index]?.id && sprint.name === right[index]?.name,
  );

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
  readonly getTicketTransitions: JiraTicketWriteServiceShape["getTicketTransitions"];
  readonly updateTicket: JiraTicketWriteServiceShape["updateTicket"];
  readonly startTicketExecution: JiraTicketWriteServiceShape["startTicketExecution"];
}

export class WorkbenchJiraService extends Context.Service<
  WorkbenchJiraService,
  WorkbenchJiraServiceShape
>()("@t3tools/workbench/jira/WorkbenchJiraService") {}

export const make = Effect.gen(function* () {
  const api = yield* JiraApi;
  const auth = yield* JiraAuthService;
  const sync = yield* JiraSyncService;
  const repository = yield* WorkbenchJiraRepository;
  const workbench = yield* WorkbenchStore;
  const ticketWriter = yield* JiraTicketWriteService;
  const sql = yield* SqlClient.SqlClient;

  const getSnapshot = sql
    .withTransaction(
      Effect.gen(function* () {
        const connections = yield* repository
          .listConnections()
          .pipe(Effect.mapError(repositoryError));
        const bindings = yield* repository.listBindings().pipe(Effect.mapError(repositoryError));
        const issueLinks = yield* Effect.forEach(bindings, (binding) =>
          repository.listIssueLinks(binding.id).pipe(Effect.mapError(repositoryError)),
        );
        return {
          connections,
          bindings,
          issueLinks: issueLinks.flat(),
        } satisfies WorkbenchJiraSnapshot;
      }),
    )
    .pipe(
      Effect.catchTag("SqlError", () =>
        Effect.fail(
          new WorkbenchJiraOperationError({
            code: "persistence_failed",
            message: "Jira connection state could not be saved or loaded.",
          }),
        ),
      ),
    );

  const validateBinding = Effect.fn("WorkbenchJiraService.validateBinding")(function* (input: {
    readonly projectId: WorkbenchJiraBinding["projectId"];
    readonly connectionId: WorkbenchJiraBinding["connectionId"];
    readonly defaultPrimaryT3ProjectId: WorkbenchJiraBinding["defaultPrimaryT3ProjectId"];
    readonly defaultRepositoryProjectIds: WorkbenchJiraBinding["defaultRepositoryProjectIds"];
    readonly statusMappings: WorkbenchJiraBinding["statusMappings"];
    readonly sprintId: WorkbenchJiraBinding["sprintId"];
    readonly boardId: WorkbenchJiraBinding["boardId"];
    readonly selectedSprints: ReadonlyArray<WorkbenchJiraSelectedSprint>;
    readonly followActiveSprint: boolean;
    readonly boardMode: WorkbenchJiraBoardMode;
    readonly verifyRemote: boolean;
  }) {
    let activeSprints: ReadonlyArray<WorkbenchJiraSprint> = [];
    if (input.verifyRemote) {
      const connection = yield* repository
        .getConnection(input.connectionId)
        .pipe(Effect.mapError(repositoryError));
      if (Option.isNone(connection)) {
        return yield* operationError("The selected Jira site is no longer connected.");
      }
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
      if (input.boardMode === "mapped") {
        return yield* operationError("Map at least one Jira status to a Workbench column.");
      }
    }
    if (input.selectedSprints.length === 0) {
      return yield* operationError("Select at least one Jira sprint.");
    }
    if (
      new Set(input.selectedSprints.map((sprint) => sprint.id)).size !==
      input.selectedSprints.length
    ) {
      return yield* operationError("Each Jira sprint can be selected only once.");
    }
    if (input.boardMode === "mapped") {
      const statusIds = input.statusMappings.map((mapping) => mapping.jiraStatusId);
      if (new Set(statusIds).size !== statusIds.length) {
        return yield* operationError("Each Jira status can be mapped only once.");
      }
    }
    if (input.verifyRemote) {
      const sprints = yield* api.listSprints({
        connectionId: input.connectionId,
        boardId: input.boardId,
      });
      activeSprints = input.followActiveSprint
        ? sprints.filter((sprint) => sprint.state === "active")
        : [];
      const selectedRemoteSprints = input.selectedSprints.map((selectedSprint) =>
        sprints.find((sprint) => sprint.id === selectedSprint.id),
      );
      if (selectedRemoteSprints.some((sprint) => sprint === undefined)) {
        return yield* operationError("Select Jira sprints from the selected board.");
      }
      if (
        input.followActiveSprint &&
        selectedRemoteSprints.some((sprint) => sprint?.state !== "active")
      ) {
        return yield* operationError(
          "Select only currently active Jira sprints, or turn off automatic sprint following.",
        );
      }
      return {
        activeSprints,
        selectedSprints: selectedRemoteSprints.map((sprint) => ({
          id: sprint!.id,
          name: sprint!.name,
        })),
      };
    }
    return { activeSprints, selectedSprints: input.selectedSprints };
  });

  const createBinding: WorkbenchJiraServiceShape["createBinding"] = (input) =>
    Effect.gen(function* () {
      if (input.selectedSprints !== undefined && input.selectedSprints.length === 0) {
        return yield* operationError("Select at least one Jira sprint.");
      }
      const selectedSprints =
        input.selectedSprints ??
        legacySelectedSprints({ sprintId: input.sprintId, sprintName: input.sprintName });
      const representativeSprint = selectedSprints[0]!;
      const normalizedInput = {
        ...input,
        sprintId: representativeSprint.id,
        sprintName: representativeSprint.name,
        selectedSprints,
      };
      const followActiveSprint = input.followActiveSprint ?? true;
      const boardMode = input.boardMode ?? "mapped";
      const validation = yield* validateBinding({
        ...normalizedInput,
        followActiveSprint,
        boardMode,
        verifyRemote: true,
      });
      const existingBindings = yield* repository
        .listBindings()
        .pipe(Effect.mapError(repositoryError));
      if (existingBindings.some((binding) => binding.projectId === input.projectId)) {
        return yield* operationError("This Workbench Workspace already has a Jira binding.");
      }
      const configuration = yield* api.getBoardConfiguration({
        connectionId: input.connectionId,
        boardId: input.boardId,
      });
      const binding = {
        ...normalizedInput,
        sprintId: validation.selectedSprints[0]!.id,
        sprintName: validation.selectedSprints[0]!.name,
        followActiveSprint,
        selectedSprints: validation.selectedSprints,
        observedActiveSprintIds: validation.activeSprints.map((sprint) => sprint.id),
        boardMode,
        boardColumns: configuration.columns,
        statusMappings:
          boardMode === "mirror_jira" ? mirrorStatusMappings(configuration) : input.statusMappings,
        active: true,
        lastSyncedAt: null,
        lastSyncError: null,
        updatedAt: input.createdAt,
      } satisfies WorkbenchJiraBinding;
      yield* repository.upsertBinding(binding).pipe(Effect.mapError(repositoryError));
      return binding;
    });

  const updateBinding: WorkbenchJiraServiceShape["updateBinding"] = (input) =>
    sync.withBindingPermit(
      input.id,
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
        if (input.selectedSprints !== undefined && input.selectedSprints.length === 0) {
          return yield* operationError("Select at least one Jira sprint.");
        }
        const selectedSprints =
          input.selectedSprints ??
          (input.sprintId !== existing.value.sprintId
            ? [{ id: input.sprintId, name: input.sprintName }]
            : selectedSprintsForBinding(existing.value));
        const requestedRepresentativeSprint = selectedSprints[0]!;
        const followActiveSprint = input.followActiveSprint ?? existing.value.followActiveSprint;
        const boardMode = input.boardMode ?? existing.value.boardMode;
        const verifyRemote =
          requestedRepresentativeSprint.id !== existing.value.sprintId ||
          !sameSelectedSprints(selectedSprints, selectedSprintsForBinding(existing.value)) ||
          (input.followActiveSprint !== undefined &&
            input.followActiveSprint !== existing.value.followActiveSprint) ||
          (input.boardMode !== undefined && input.boardMode !== existing.value.boardMode);
        const validation = yield* validateBinding({
          ...input,
          projectId: existing.value.projectId,
          connectionId: existing.value.connectionId,
          boardId: existing.value.boardId,
          followActiveSprint,
          selectedSprints,
          boardMode,
          verifyRemote,
        });
        const configuration = verifyRemote
          ? yield* api.getBoardConfiguration({
              connectionId: existing.value.connectionId,
              boardId: existing.value.boardId,
            })
          : null;
        const canonicalSelectedSprints = validation.selectedSprints;
        const representativeSprint = canonicalSelectedSprints[0]!;
        const binding = {
          ...existing.value,
          ...input,
          sprintId: representativeSprint.id,
          sprintName: representativeSprint.name,
          followActiveSprint,
          selectedSprints: canonicalSelectedSprints,
          observedActiveSprintIds: followActiveSprint
            ? verifyRemote
              ? validation.activeSprints.map((sprint) => sprint.id)
              : existing.value.observedActiveSprintIds
            : existing.value.observedActiveSprintIds,
          boardMode,
          boardColumns: configuration?.columns ?? existing.value.boardColumns,
          statusMappings:
            boardMode === "mirror_jira"
              ? configuration === null
                ? existing.value.statusMappings
                : mirrorStatusMappings(configuration)
              : input.statusMappings,
          lastSyncError: null,
        } satisfies WorkbenchJiraBinding;
        yield* repository.upsertBinding(binding).pipe(Effect.mapError(repositoryError));
        return binding;
      }),
    );

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
    getTicketTransitions: ticketWriter.getTicketTransitions,
    updateTicket: ticketWriter.updateTicket,
    startTicketExecution: ticketWriter.startTicketExecution,
  });
});

export const layer = Layer.effect(WorkbenchJiraService, make);
