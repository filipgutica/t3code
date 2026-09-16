import {
  WorkbenchJiraOperationError,
  WorkbenchOperationError,
  type WorkbenchCreateTicketInput,
  type WorkbenchJiraBeginAuthInput,
  type WorkbenchJiraBeginAuthResult,
  type WorkbenchJiraClaimAuthInput,
  type WorkbenchJiraClaimAuthResult,
  type WorkbenchJiraBinding,
  type WorkbenchJiraBoardMode,
  type WorkbenchJiraCompleteAuthInput,
  type WorkbenchJiraCompleteAuthResult,
  type WorkbenchJiraCreateBindingInput,
  type WorkbenchJiraMigrateLocalTicketsInput,
  type WorkbenchJiraMigrateLocalTicketsResult,
  type WorkbenchJiraSnapshot,
  type WorkbenchJiraSelectedSprint,
  type WorkbenchJiraSprint,
  type WorkbenchJiraUpdateBindingInput,
  type WorkbenchEpic,
  type WorkbenchTicket,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
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
import { WorkbenchJiraRepository } from "./WorkbenchJiraRepository.ts";

const operationError = (message: string) =>
  new WorkbenchJiraOperationError({ code: "invalid_binding", message });

const repositoryError = (_cause: unknown) =>
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

const encodeEpicMigrationFingerprint = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      bindingId: Schema.String,
      connectionId: Schema.String,
      jiraProjectKey: Schema.String,
      epicId: Schema.String,
      title: Schema.String,
      markdown: Schema.String,
    }),
  ),
);

interface WorkbenchJiraServiceShape {
  readonly getSnapshot: Effect.Effect<WorkbenchJiraSnapshot, WorkbenchJiraOperationError>;
  readonly beginAuth: (
    input: WorkbenchJiraBeginAuthInput,
  ) => Effect.Effect<WorkbenchJiraBeginAuthResult, WorkbenchJiraOperationError>;
  readonly completeAuth: (
    input: WorkbenchJiraCompleteAuthInput,
  ) => Effect.Effect<WorkbenchJiraCompleteAuthResult, WorkbenchJiraOperationError>;
  readonly claimAuth: (
    input: WorkbenchJiraClaimAuthInput,
  ) => Effect.Effect<WorkbenchJiraClaimAuthResult, WorkbenchJiraOperationError>;
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
  readonly createTicket: (
    input: WorkbenchCreateTicketInput,
  ) => Effect.Effect<WorkbenchTicket, WorkbenchJiraOperationError | WorkbenchOperationError>;
  readonly migrateLocalTickets: (
    input: WorkbenchJiraMigrateLocalTicketsInput,
  ) => Effect.Effect<
    WorkbenchJiraMigrateLocalTicketsResult,
    WorkbenchJiraOperationError | WorkbenchOperationError
  >;
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
  const clock = yield* Clock.Clock;

  const completeLocalMigration = (binding: WorkbenchJiraBinding) =>
    Effect.gen(function* () {
      if (binding.localMigrationPending !== true) return;
      if (repository.completeLocalMigrationIfReady === undefined) return;
      const complete = yield* repository
        .completeLocalMigrationIfReady(binding.id, binding.projectId)
        .pipe(Effect.mapError(repositoryError));
      if (!complete) {
        return yield* operationError(
          "Finish migrating all active local Tickets and Epics before importing Jira issues.",
        );
      }
    });

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
        const epicLinks = yield* Effect.forEach(bindings, (binding) =>
          repository.listEpicLinks === undefined
            ? Effect.succeed([])
            : repository.listEpicLinks(binding.id).pipe(Effect.mapError(repositoryError)),
        );
        return {
          connections,
          bindings,
          issueLinks: issueLinks.flat(),
          epicLinks: epicLinks.flat(),
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
        localMigrationPending: input.localMigrationPending ?? false,
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
          followActiveSprint !== existing.value.followActiveSprint ||
          boardMode !== existing.value.boardMode;
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
          // Only a successful migration may clear this flag. A binding edit
          // during an interrupted migration must keep automatic imports gated.
          localMigrationPending:
            existing.value.localMigrationPending === true || input.localMigrationPending === true,
          lastSyncError: null,
        } satisfies WorkbenchJiraBinding;
        yield* repository.upsertBinding(binding).pipe(Effect.mapError(repositoryError));
        return binding;
      }),
    );

  const createTicket: WorkbenchJiraServiceShape["createTicket"] = (input) =>
    // Existing local Ticket publishing keeps its preflight and identity checks together.
    // eslint-disable-next-line complexity
    Effect.gen(function* () {
      const bindings = yield* repository.listBindings().pipe(Effect.mapError(repositoryError));
      const matches = bindings.filter((binding) => binding.projectId === input.projectId);
      if (matches.length === 0) {
        if (input.existingLocalTicketRevision !== undefined) {
          return yield* operationError(
            "Connect this Workspace to Jira before publishing local Tickets.",
          );
        }
        return yield* workbench.createTicket(input);
      }
      if (matches.length > 1) {
        return yield* operationError(
          "This Workbench Workspace is linked to more than one Jira binding. Repair the binding before creating Tickets.",
        );
      }
      const binding = matches[0]!;
      if (!binding.active) {
        return yield* new WorkbenchJiraOperationError({
          code: "binding_inactive",
          message:
            "This Jira Workspace is paused. Resume the Jira binding before creating Tickets.",
        });
      }
      const before = yield* workbench.getSnapshot;
      const project = before.projects.find((candidate) => candidate.id === input.projectId);
      const repositories = input.repositoryProjectIds ?? [input.primaryT3ProjectId];
      if (
        !project ||
        repositories.length === 0 ||
        !repositories.includes(input.primaryT3ProjectId) ||
        new Set(repositories).size !== repositories.length ||
        repositories.some((id) => !project.linkedProjectIds.includes(id))
      ) {
        return yield* operationError(
          "Select valid linked repositories and a primary repository before creating a Jira Ticket.",
        );
      }
      let remoteEpicIssueId: string | undefined;
      if (input.epicId) {
        const canonicalPrefix = `jira:${binding.id}:epic:`;
        if (input.epicId.startsWith(canonicalPrefix)) {
          remoteEpicIssueId = input.epicId.slice(canonicalPrefix.length);
        } else {
          const mappedEpic = yield* sql<{ readonly jiraIssueId: string }>`
            SELECT jira_issue_id AS "jiraIssueId"
            FROM workbench_jira_epic_links
            WHERE binding_id = ${binding.id} AND epic_id = ${input.epicId}
            LIMIT 1
          `.pipe(Effect.mapError(repositoryError));
          remoteEpicIssueId = mappedEpic[0]?.jiraIssueId;
        }
        if (
          remoteEpicIssueId === undefined ||
          !before.epics.some(
            (epic) =>
              epic.id === input.epicId &&
              epic.projectId === input.projectId &&
              epic.archivedAt === null,
          )
        ) {
          return yield* operationError(
            "Select an active Jira Epic from this Workspace before creating the Ticket.",
          );
        }
      }
      const localTicket = before.tickets.find((ticket) => ticket.id === input.id);
      if (input.existingLocalTicketRevision !== undefined && localTicket === undefined) {
        return yield* operationError("The local Ticket no longer exists. Refresh the Workspace.");
      }
      if (localTicket) {
        const creation = yield* sql<{ readonly bindingId: string }>`
          SELECT binding_id AS "bindingId" FROM workbench_jira_ticket_creations WHERE ticket_id = ${input.id}
        `.pipe(Effect.mapError(repositoryError));
        if (creation[0]?.bindingId !== binding.id) {
          if (input.existingLocalTicketRevision === undefined) {
            return yield* operationError(
              "This Ticket ID is already in use. Start a new Ticket creation.",
            );
          }
          const links = yield* Effect.forEach(bindings, (candidate) =>
            repository.listIssueLinks(candidate.id).pipe(Effect.mapError(repositoryError)),
          );
          if (links.some((entries) => entries.some((link) => link.ticketId === input.id))) {
            return yield* operationError("This Ticket is already managed by Jira.");
          }
          if (
            localTicket.projectId !== input.projectId ||
            localTicket.archivedAt !== null ||
            localTicket.revision !== input.existingLocalTicketRevision ||
            localTicket.title !== input.title ||
            localTicket.markdown !== input.markdown ||
            localTicket.kind !== input.kind ||
            localTicket.primaryT3ProjectId !== input.primaryT3ProjectId ||
            localTicket.repositoryProjectIds.length !== repositories.length ||
            localTicket.repositoryProjectIds.some((id, index) => id !== repositories[index])
          ) {
            return yield* operationError(
              "The local Ticket changed. Refresh before publishing it to Jira.",
            );
          }
        }
      }
      const ticketId = yield* ticketWriter.createTicket({
        ...input,
        binding,
        ...(remoteEpicIssueId === undefined ? {} : { remoteEpicIssueId }),
      });
      const snapshot = yield* workbench.getSnapshot.pipe(
        Effect.mapError(
          () =>
            new WorkbenchOperationError({
              code: "persistence_failed",
              message: "Jira created the Ticket, but Workbench could not reload it.",
            }),
        ),
      );
      const ticket = snapshot.tickets.find((candidate) => candidate.id === ticketId);
      if (ticket === undefined) {
        return yield* new WorkbenchOperationError({
          code: "persistence_failed",
          message: "Jira created the Ticket, but Workbench could not find its local projection.",
        });
      }
      return ticket;
    });

  // Migration intentionally performs one preflight for all selected records before writes.
  const migrateLocalTickets: WorkbenchJiraServiceShape["migrateLocalTickets"] = (input) =>
    // eslint-disable-next-line complexity
    Effect.gen(function* () {
      const bindingOption = yield* repository
        .getBinding(input.bindingId)
        .pipe(Effect.mapError(repositoryError));
      if (Option.isNone(bindingOption)) {
        return yield* new WorkbenchJiraOperationError({
          code: "binding_not_found",
          message: "The Jira sprint binding was not found.",
        });
      }
      const binding = bindingOption.value;
      if (!binding.active) {
        return yield* new WorkbenchJiraOperationError({
          code: "binding_inactive",
          message: "The Jira sprint binding is inactive.",
        });
      }

      const requestedTicketIds = input.tickets.map((ticket) => ticket.id);
      if (new Set(requestedTicketIds).size !== requestedTicketIds.length) {
        return yield* operationError("Each local Ticket can be migrated only once.");
      }
      const snapshot = yield* workbench.getSnapshot;
      const links = yield* repository
        .listIssueLinks(binding.id)
        .pipe(Effect.mapError(repositoryError));
      const priorTicketCreations = yield* sql<{
        readonly ticketId: string;
        readonly bindingId: string;
        readonly state: "pending" | "uncertain" | "created";
        readonly resultTicketId: string | null;
      }>`
        SELECT ticket_id AS "ticketId", binding_id AS "bindingId", state,
               result_ticket_id AS "resultTicketId"
        FROM workbench_jira_ticket_creations
      `;
      const completedTicketMigrations = new Set(
        priorTicketCreations
          .filter(
            (creation) =>
              creation.bindingId === binding.id &&
              creation.state === "created" &&
              creation.resultTicketId !== null,
          )
          .map((creation) => creation.ticketId),
      );
      const managedTicketIds = new Set(
        links.filter((link) => link.active).map((link) => link.ticketId),
      );
      const existingEpicLinks = yield* sql<{
        readonly epicId: string;
        readonly jiraIssueId: string;
      }>`
        SELECT epic_id AS "epicId", jira_issue_id AS "jiraIssueId"
        FROM workbench_jira_epic_links
        WHERE binding_id = ${binding.id}
      `;
      const mappedEpicIssues = new Map(
        existingEpicLinks.map((link) => [link.epicId, link.jiraIssueId]),
      );
      const canonicalEpicIssueId = (epicId: string) => {
        const prefix = `jira:${binding.id}:epic:`;
        return epicId.startsWith(prefix) ? epicId.slice(prefix.length) : undefined;
      };
      const existingRemoteEpicIssueId = (epicId: string) =>
        mappedEpicIssues.get(epicId) ?? canonicalEpicIssueId(epicId);
      const requestedEpicItems = input.epics ?? [];
      if (input.tickets.length === 0 && requestedEpicItems.length === 0) {
        return yield* operationError("Select at least one local Ticket or Epic to migrate.");
      }
      const tickets: Array<WorkbenchTicket> = [];
      for (const requested of input.tickets) {
        const ticket = snapshot.tickets.find((candidate) => candidate.id === requested.id);
        if (ticket === undefined) {
          return yield* operationError(
            `Local Ticket ${requested.id} no longer exists. Refresh the Workspace and try again.`,
          );
        }
        const completedPublish =
          input.action === "publish" && completedTicketMigrations.has(ticket.id);
        if (ticket.revision !== requested.revision && !completedPublish) {
          return yield* operationError(
            `Local Ticket ${requested.id} changed. Refresh the Workspace and confirm the migration again.`,
          );
        }
        if (ticket.projectId !== binding.projectId || ticket.archivedAt !== null) {
          return yield* operationError(
            `Local Ticket ${requested.id} is not an active Ticket in the connected Workspace.`,
          );
        }
        if (
          (input.action === "delete" && completedTicketMigrations.has(ticket.id)) ||
          (managedTicketIds.has(ticket.id) && !completedPublish) ||
          ticket.id.startsWith("jira:")
        ) {
          return yield* operationError(
            `Ticket ${ticket.id} is already managed by Jira and cannot be migrated as local work.`,
          );
        }
        tickets.push(ticket);
      }

      const requestedEpicIds = requestedEpicItems.map((epic) => epic.id);
      if (new Set(requestedEpicIds).size !== requestedEpicIds.length) {
        return yield* operationError("Each local Epic can be migrated only once.");
      }
      const referencedEpicIds = [
        ...new Set(tickets.flatMap((ticket) => (ticket.epicId === null ? [] : [ticket.epicId]))),
      ];
      if (
        input.action === "publish" &&
        referencedEpicIds.some(
          (epicId) =>
            !requestedEpicIds.includes(epicId) && existingRemoteEpicIssueId(epicId) === undefined,
        )
      ) {
        return yield* operationError(
          "Confirm every local Epic used by the selected Tickets before publishing.",
        );
      }
      const epics: Array<WorkbenchEpic> = [];
      for (const requested of requestedEpicItems) {
        const epic = snapshot.epics.find((candidate) => candidate.id === requested.id);
        if (epic === undefined) {
          return yield* operationError(
            `Local Epic ${requested.id} no longer exists. Refresh the Workspace and try again.`,
          );
        }
        if (epic.updatedAt !== requested.updatedAt) {
          return yield* operationError(
            `Local Epic ${requested.id} changed. Refresh the Workspace and confirm the migration again.`,
          );
        }
        if (input.action === "delete" && existingRemoteEpicIssueId(epic.id) !== undefined) {
          return yield* operationError(
            `Epic ${epic.id} is already managed by Jira and cannot be deleted as local work.`,
          );
        }
        if (epic.projectId !== binding.projectId || epic.archivedAt !== null) {
          return yield* operationError(
            `Local Epic ${requested.id} is not an active Epic in the connected Workspace.`,
          );
        }
        epics.push(epic);
      }

      const now = DateTime.formatIso(DateTime.makeUnsafe(yield* clock.currentTimeMillis));
      if (input.action === "delete") {
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            // Recheck every selected record inside the transaction. The
            // initial snapshot prevents stale confirmation, while this check
            // keeps a concurrent edit from producing a partial delete.
            for (const ticket of tickets) {
              const currentRows = yield* sql<{
                readonly projectId: string;
                readonly revision: number;
                readonly archivedAt: string | null;
              }>`
                SELECT workbench_project_id AS "projectId", revision,
                       archived_at AS "archivedAt"
                FROM workbench_tickets
                WHERE ticket_id = ${ticket.id}
                LIMIT 1
              `;
              const current = currentRows[0];
              if (
                current === undefined ||
                current.projectId !== binding.projectId ||
                current.archivedAt !== null ||
                current.revision !== ticket.revision
              ) {
                return yield* operationError(
                  `Local Ticket ${ticket.id} changed. Refresh the Workspace and confirm the deletion again.`,
                );
              }
            }

            const selectedTicketIds = new Set<string>(tickets.map((ticket) => ticket.id));
            for (const epic of epics) {
              const currentRows = yield* sql<{
                readonly projectId: string;
                readonly updatedAt: string;
                readonly archivedAt: string | null;
              }>`
                SELECT workbench_project_id AS "projectId", updated_at AS "updatedAt",
                       archived_at AS "archivedAt"
                FROM workbench_epics
                WHERE epic_id = ${epic.id}
                LIMIT 1
              `;
              const current = currentRows[0];
              if (
                current === undefined ||
                current.projectId !== binding.projectId ||
                current.archivedAt !== null ||
                current.updatedAt !== epic.updatedAt
              ) {
                return yield* operationError(
                  `Local Epic ${epic.id} changed. Refresh the Workspace and confirm the deletion again.`,
                );
              }
              const references = yield* sql<{ readonly ticketId: string }>`
                SELECT ticket_id AS "ticketId"
                FROM workbench_tickets
                WHERE epic_id = ${epic.id} AND deleted_at IS NULL
              `;
              if (references.some((reference) => !selectedTicketIds.has(reference.ticketId))) {
                return yield* operationError(
                  `Local Epic ${epic.id} is still used by another Ticket. Confirm all of its Tickets before deleting it.`,
                );
              }
            }

            for (const ticket of tickets) {
              yield* workbench.deleteTicket({
                ticketId: ticket.id,
                expectedRevision: ticket.revision,
                deletedAt: now,
              });
              yield* sql`UPDATE workbench_tickets SET epic_id = NULL WHERE ticket_id = ${ticket.id}`;
            }
            for (const epic of epics) {
              // Deleted Tickets retain their history, but cannot keep a removed Epic alive.
              yield* sql`
                UPDATE workbench_tickets SET epic_id = NULL
                WHERE epic_id = ${epic.id} AND deleted_at IS NOT NULL
              `;
              const deleted = yield* sql<{ readonly epicId: string }>`
                DELETE FROM workbench_epics
                WHERE epic_id = ${epic.id}
                  AND workbench_project_id = ${binding.projectId}
                  AND archived_at IS NULL
                  AND updated_at = ${epic.updatedAt}
                RETURNING epic_id AS "epicId"
              `;
              if (deleted.length === 0) {
                return yield* operationError(
                  `Local Epic ${epic.id} changed. Refresh the Workspace and confirm the deletion again.`,
                );
              }
            }
            yield* completeLocalMigration(binding);
            return {
              action: input.action,
              requestedTicketCount: tickets.length,
              publishedTicketCount: 0,
              publishedEpicCount: 0,
              deletedTicketCount: tickets.length,
              deletedEpicCount: epics.length,
              ticketIds: tickets.map((ticket) => ticket.id),
              epicIds: epics.map((epic) => epic.id),
            } satisfies WorkbenchJiraMigrateLocalTicketsResult;
          }),
        );
      }

      const publishEpic = (epic: (typeof epics)[number]) =>
        sync.withBindingPermit(
          binding.id,
          // The publish flow keeps its idempotency, CAS, and post-create checks together.
          // eslint-disable-next-line complexity
          Effect.gen(function* () {
            const currentBindingOption = yield* repository
              .getBinding(binding.id)
              .pipe(Effect.mapError(repositoryError));
            if (Option.isNone(currentBindingOption)) {
              return yield* new WorkbenchJiraOperationError({
                code: "binding_not_found",
                message: "The Jira sprint binding was not found.",
              });
            }
            const currentBinding = currentBindingOption.value;
            if (!currentBinding.active) {
              return yield* new WorkbenchJiraOperationError({
                code: "binding_inactive",
                message: "The Jira sprint binding is inactive.",
              });
            }
            // Epics belong to a Jira project, independently of sprint selection.
            if (
              currentBinding.projectId !== binding.projectId ||
              currentBinding.connectionId !== binding.connectionId ||
              currentBinding.jiraProjectId !== binding.jiraProjectId ||
              currentBinding.jiraProjectKey !== binding.jiraProjectKey
            ) {
              return yield* operationError(
                "The Jira connection changed while Epic publication was waiting. Refresh the Workspace and confirm the migration again.",
              );
            }
            const fingerprint = encodeEpicMigrationFingerprint({
              bindingId: binding.id,
              connectionId: binding.connectionId,
              jiraProjectKey: binding.jiraProjectKey,
              epicId: epic.id,
              title: epic.title,
              markdown: epic.markdown,
            });
            const existingRows = yield* sql<{
              readonly epicId: string;
              readonly requestFingerprint: string;
              readonly jiraIssueId: string | null;
              readonly jiraIssueKey: string | null;
              readonly state: "pending" | "uncertain" | "created";
            }>`
              SELECT epic_id AS "epicId", request_fingerprint AS "requestFingerprint",
                     jira_issue_id AS "jiraIssueId", jira_issue_key AS "jiraIssueKey", state
              FROM workbench_jira_epic_creations
              WHERE epic_id = ${epic.id}
              LIMIT 1
            `;
            const existing = existingRows[0];
            if (existing && existing.requestFingerprint !== fingerprint) {
              return yield* operationError(
                `Epic ${epic.id} has a saved Jira creation with different content. Check Jira before retrying.`,
              );
            }
            if (existing?.state === "uncertain" && existing.jiraIssueId === null) {
              return yield* operationError(
                `Jira may have accepted Epic ${epic.id}, but Workbench could not confirm it. Check Jira before retrying.`,
              );
            }
            if (existing?.jiraIssueId && existing.jiraIssueKey) {
              yield* sql`
                INSERT INTO workbench_jira_epic_links (
                  binding_id, jira_issue_id, jira_issue_key, epic_id
                ) VALUES (
                  ${binding.id}, ${existing.jiraIssueId}, ${existing.jiraIssueKey}, ${epic.id}
                ) ON CONFLICT(binding_id, jira_issue_id) DO UPDATE SET
                  jira_issue_key = excluded.jira_issue_key, epic_id = excluded.epic_id
              `;
              return { id: existing.jiraIssueId, key: existing.jiraIssueKey };
            }
            const prepare = api.prepareEpicCreation;
            if (prepare === undefined) {
              return yield* operationError("Jira Epic creation is not available on this server.");
            }
            const prepared = yield* prepare({
              connectionId: binding.connectionId,
              projectKey: binding.jiraProjectKey,
            });
            // Metadata preparation can involve remote reads. Re-read the
            // local Epic after those awaits so a concurrent edit cannot be
            // published under the original snapshot's fingerprint.
            const currentEpicRows = yield* sql<{
              readonly title: string;
              readonly markdown: string;
              readonly updatedAt: string;
              readonly archivedAt: string | null;
            }>`
              SELECT title, markdown, updated_at AS "updatedAt", archived_at AS "archivedAt"
              FROM workbench_epics
              WHERE epic_id = ${epic.id}
              LIMIT 1
            `;
            const currentEpic = currentEpicRows[0];
            if (
              currentEpic === undefined ||
              currentEpic.archivedAt !== null ||
              currentEpic.updatedAt !== epic.updatedAt ||
              currentEpic.title !== epic.title ||
              currentEpic.markdown !== epic.markdown
            ) {
              return yield* operationError(
                `Local Epic ${epic.id} changed. Refresh the Workspace and confirm the migration again.`,
              );
            }
            yield* sql`
              INSERT OR IGNORE INTO workbench_jira_epic_creations (
                epic_id, binding_id, title, markdown, request_fingerprint, state, created_at, updated_at
              ) VALUES (
                ${epic.id}, ${binding.id}, ${epic.title}, ${epic.markdown}, ${fingerprint},
                'pending', ${epic.createdAt}, ${epic.updatedAt}
              )
            `;
            const claimed = yield* sql<{ readonly epicId: string }>`
              UPDATE workbench_jira_epic_creations
              SET state = 'uncertain', updated_at = ${now}
              WHERE epic_id = ${epic.id} AND jira_issue_id IS NULL AND state = 'pending'
              RETURNING epic_id AS "epicId"
            `;
            if (claimed.length === 0) {
              return yield* operationError(
                "Jira Epic creation is already in progress. Check Jira before retrying.",
              );
            }
            const created = yield* api
              .createIssue({
                connectionId: binding.connectionId,
                projectKey: binding.jiraProjectKey,
                ticket: { id: epic.id, title: epic.title, markdown: epic.markdown, kind: "story" },
                ...prepared,
              })
              .pipe(
                Effect.catch((error) =>
                  Effect.gen(function* () {
                    if (error.outcome === "rejected") {
                      yield* sql`DELETE FROM workbench_jira_epic_creations WHERE epic_id = ${epic.id} AND jira_issue_id IS NULL`;
                    }
                    return yield* operationError("Jira could not create this local Epic.");
                  }),
                ),
              );
            // Persist the remote identity before any post-create validation so
            // an interruption cannot cause a duplicate Epic on retry.
            yield* sql`
              UPDATE workbench_jira_epic_creations
              SET state = 'created', jira_issue_id = ${created.id}, jira_issue_key = ${created.key}, updated_at = ${now}
              WHERE epic_id = ${epic.id} AND jira_issue_id IS NULL
            `;
            // The local Epic can change while Jira accepts the POST. Refuse
            // to attach that remote issue to a newer local revision; the
            // durable creation row remains available for an explicit retry.
            const postCreateEpicRows = yield* sql<{
              readonly title: string;
              readonly markdown: string;
              readonly updatedAt: string;
              readonly archivedAt: string | null;
            }>`
              SELECT title, markdown, updated_at AS "updatedAt", archived_at AS "archivedAt"
              FROM workbench_epics
              WHERE epic_id = ${epic.id}
              LIMIT 1
            `;
            const postCreateEpic = postCreateEpicRows[0];
            if (
              postCreateEpic === undefined ||
              postCreateEpic.archivedAt !== null ||
              postCreateEpic.updatedAt !== epic.updatedAt ||
              postCreateEpic.title !== epic.title ||
              postCreateEpic.markdown !== epic.markdown
            ) {
              return yield* operationError(
                `Local Epic ${epic.id} changed while Jira was creating it. Refresh the Workspace before retrying.`,
              );
            }
            yield* sql`
              INSERT INTO workbench_jira_epic_links (
                binding_id, jira_issue_id, jira_issue_key, epic_id
              ) VALUES (
                ${binding.id}, ${created.id}, ${created.key}, ${epic.id}
              ) ON CONFLICT(binding_id, jira_issue_id) DO UPDATE SET
                jira_issue_key = excluded.jira_issue_key, epic_id = excluded.epic_id
            `;
            return created;
          }),
        );

      const epicIssues = new Map(mappedEpicIssues);
      for (const epic of epics) {
        const remote = yield* publishEpic(epic);
        epicIssues.set(epic.id, remote.id);
      }
      for (const requested of input.tickets) {
        const ticket = tickets.find((candidate) => candidate.id === requested.id)!;
        if (completedTicketMigrations.has(ticket.id)) continue;
        const remoteEpicIssueId =
          ticket.epicId === null
            ? undefined
            : (epicIssues.get(ticket.epicId) ?? existingRemoteEpicIssueId(ticket.epicId));
        if (ticket.epicId !== null && remoteEpicIssueId === undefined) {
          return yield* operationError(
            `Local Epic ${ticket.epicId} was not published. Retry the migration before importing Jira.`,
          );
        }
        yield* ticketWriter.createTicket({
          id: ticket.id,
          projectId: ticket.projectId,
          title: ticket.title,
          kind: ticket.kind,
          markdown: ticket.markdown,
          primaryT3ProjectId: ticket.primaryT3ProjectId,
          repositoryProjectIds: ticket.repositoryProjectIds,
          jiraSprintId: binding.sprintId,
          existingLocalTicketRevision: requested.revision,
          createdAt: ticket.createdAt,
          binding,
          ...(remoteEpicIssueId === undefined ? {} : { remoteEpicIssueId }),
        });
      }
      yield* completeLocalMigration(binding);
      return {
        action: input.action,
        requestedTicketCount: tickets.length,
        publishedTicketCount: tickets.length,
        publishedEpicCount: epics.length,
        deletedTicketCount: 0,
        deletedEpicCount: 0,
        ticketIds: tickets.map((ticket) => ticket.id),
        epicIds: epics.map((epic) => epic.id),
      } satisfies WorkbenchJiraMigrateLocalTicketsResult;
    }).pipe(
      Effect.catchTag("SqlError", () =>
        Effect.fail(
          new WorkbenchJiraOperationError({
            code: "persistence_failed",
            message: "Jira migration state could not be saved or loaded.",
          }),
        ),
      ),
    );

  const syncActiveBindings = repository.listBindings().pipe(
    Effect.mapError(repositoryError),
    Effect.flatMap((bindings) =>
      Effect.forEach(
        bindings.filter((binding) => binding.active),
        (binding) =>
          sync.syncBinding({ bindingId: binding.id, background: true }).pipe(
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
    claimAuth:
      auth.claim ??
      (() =>
        Effect.fail(
          new WorkbenchJiraOperationError({
            code: "not_configured",
            message: "The Jira authorization broker is not configured for this server.",
          }),
        )),
    listProjects: api.listProjects,
    listBoards: api.listBoards,
    listSprints: api.listSprints,
    getBoardConfiguration: api.getBoardConfiguration,
    createBinding,
    updateBinding,
    createTicket,
    syncBinding: sync.syncBinding,
    getTicketTransitions: ticketWriter.getTicketTransitions,
    updateTicket: ticketWriter.updateTicket,
    startTicketExecution: ticketWriter.startTicketExecution,
    migrateLocalTickets,
  });
});

export const layer = Layer.effect(WorkbenchJiraService, make);
