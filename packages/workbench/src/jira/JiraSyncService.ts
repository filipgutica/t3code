import {
  WorkbenchJiraOperationError,
  type WorkbenchJiraBinding,
  type WorkbenchJiraBoardConfiguration,
  type WorkbenchJiraIssueSnapshot,
  type WorkbenchJiraSelectedSprint,
  type WorkbenchJiraSyncBindingInput,
  type WorkbenchJiraSyncResult,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { JiraApi } from "./JiraApi.ts";
import { reconcileJiraIssueLinks, type JiraIssueImport } from "./JiraReconciliation.ts";
import { JiraTicketImporter } from "./JiraTicketImporter.ts";
import {
  WorkbenchJiraRepository,
  type WorkbenchJiraRepositoryError,
} from "./WorkbenchJiraRepository.ts";

const syncError = (code: WorkbenchJiraOperationError["code"], message: string) =>
  new WorkbenchJiraOperationError({ code, message });

const repositoryError = (_cause: WorkbenchJiraRepositoryError) =>
  syncError("persistence_failed", "Jira synchronization state could not be saved or loaded.");

const selectedSprintsForBinding = (
  binding: Pick<WorkbenchJiraBinding, "sprintId" | "sprintName" | "selectedSprints">,
) =>
  binding.selectedSprints.length > 0
    ? binding.selectedSprints
    : ([
        { id: binding.sprintId, name: binding.sprintName },
      ] satisfies ReadonlyArray<WorkbenchJiraSelectedSprint>);

const sameSelectedSprints = (
  left: ReadonlyArray<WorkbenchJiraSelectedSprint>,
  right: ReadonlyArray<WorkbenchJiraSelectedSprint>,
) =>
  left.length === right.length &&
  left.every(
    (sprint, index) => sprint.id === right[index]?.id && sprint.name === right[index]?.name,
  );

export const mirrorStatusMappings = (
  configuration: WorkbenchJiraBoardConfiguration,
): WorkbenchJiraBinding["statusMappings"] =>
  configuration.columns.flatMap((column, index) =>
    column.statusIds.map((jiraStatusId) => ({
      jiraStatusId,
      workbenchStatus: column.done
        ? "done"
        : index === 0 || /^to[ _-]?do$/iu.test(column.name.trim())
          ? "todo"
          : "in_progress",
    })),
  );

export interface JiraSyncServiceShape {
  readonly withBindingPermit: <A, E, R>(
    bindingId: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly syncBinding: (
    input: WorkbenchJiraSyncBindingInput,
  ) => Effect.Effect<WorkbenchJiraSyncResult, WorkbenchJiraOperationError>;
}

export class JiraSyncService extends Context.Service<JiraSyncService, JiraSyncServiceShape>()(
  "@t3tools/workbench/jira/JiraSyncService",
) {}

export const make = Effect.gen(function* () {
  const clock = yield* Clock.Clock;
  const api = yield* JiraApi;
  const importer = yield* JiraTicketImporter;
  const repository = yield* WorkbenchJiraRepository;
  const sql = yield* SqlClient.SqlClient;
  const bindingLocks = yield* Ref.make<ReadonlyMap<string, Semaphore.Semaphore>>(new Map());

  const getBindingLock = Effect.fn("JiraSyncService.getBindingLock")(function* (bindingId: string) {
    const existing = (yield* Ref.get(bindingLocks)).get(bindingId);
    if (existing) return existing;

    const proposed = yield* Semaphore.make(1);
    return yield* Ref.modify(bindingLocks, (locks) => {
      const current = locks.get(bindingId);
      if (current) return [current, locks] as const;
      const next = new Map(locks);
      next.set(bindingId, proposed);
      return [proposed, next] as const;
    });
  });

  const withBindingPermit: JiraSyncServiceShape["withBindingPermit"] = (bindingId, effect) =>
    getBindingLock(bindingId).pipe(Effect.flatMap((lock) => lock.withPermit(effect)));

  const syncBinding: JiraSyncServiceShape["syncBinding"] = (input) =>
    withBindingPermit(input.bindingId, syncBindingUnlocked(input));

  const syncBindingUnlocked = Effect.fn("JiraSyncService.syncBindingUnlocked")(function* (
    input: WorkbenchJiraSyncBindingInput,
  ) {
    const bindingOption = yield* repository
      .getBinding(input.bindingId)
      .pipe(Effect.mapError(repositoryError));
    if (Option.isNone(bindingOption)) {
      return yield* syncError("binding_not_found", "The Jira sprint binding was not found.");
    }
    const binding = bindingOption.value;
    if (!binding.active) {
      return yield* syncError("binding_inactive", "The Jira sprint binding is inactive.");
    }

    let observedActiveSprintIdsForError:
      | WorkbenchJiraBinding["observedActiveSprintIds"]
      | undefined;
    const persistSyncError = (error: WorkbenchJiraOperationError) =>
      clock.currentTimeMillis.pipe(
        Effect.flatMap((now) =>
          repository.updateBindingSyncError({
            id: binding.id,
            expectedUpdatedAt: binding.updatedAt,
            updatedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
            message: error.message,
            ...(observedActiveSprintIdsForError === undefined
              ? {}
              : { observedActiveSprintIds: observedActiveSprintIdsForError }),
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("Workbench Jira sync error could not be persisted", {
            bindingId: binding.id,
            cause,
          }).pipe(Effect.as(false)),
        ),
        Effect.asVoid,
      );

    const sync = Effect.gen(function* () {
      let currentSprintId = binding.sprintId;
      let currentSprintName = binding.sprintName;
      let selectedSprints = selectedSprintsForBinding(binding);
      let observedActiveSprintIds = binding.observedActiveSprintIds;
      if (binding.followActiveSprint) {
        const sprints = yield* api.listSprints({
          connectionId: binding.connectionId,
          boardId: binding.boardId,
        });
        const activeSprints = sprints.filter((sprint) => sprint.state === "active");
        observedActiveSprintIds = activeSprints.map((sprint) => sprint.id);
        const activeById = new Map(activeSprints.map((sprint) => [sprint.id, sprint]));
        const retainedSprints = selectedSprints.filter((sprint) => activeById.has(sprint.id));
        const missingSprintCount = selectedSprints.length - retainedSprints.length;
        observedActiveSprintIdsForError =
          missingSprintCount === 0 ? observedActiveSprintIds : binding.observedActiveSprintIds;
        if (missingSprintCount > 0) {
          if (binding.observedActiveSprintIds.length === 0) {
            return yield* syncError(
              "invalid_binding",
              "The followed Jira sprint selection is no longer active. Choose the active sprint or sprints to follow in Jira settings, then sync again.",
            );
          }
          const newActiveSprints = activeSprints.filter(
            (sprint) => !binding.observedActiveSprintIds.includes(sprint.id),
          );
          if (newActiveSprints.length !== missingSprintCount) {
            return yield* syncError(
              "invalid_binding",
              newActiveSprints.length === 0
                ? "The followed Jira sprint has ended and no active sprint is available; no new active sprint replacement is available yet. The board will retry automatically when a new sprint starts."
                : newActiveSprints.length > 1
                  ? `Multiple new active Jira sprints are available, but ${missingSprintCount} replacement sprint${missingSprintCount === 1 ? " is" : "s are"} needed. Choose the sprints to follow in Jira settings, then sync again.`
                  : `The followed Jira sprint selection needs ${missingSprintCount} replacement sprints, but ${newActiveSprints.length} new active Jira sprint is available. Choose the sprints to follow in Jira settings, then sync again.`,
            );
          }
          let replacementIndex = 0;
          selectedSprints = selectedSprints.map((sprint) => {
            const replacement = activeById.get(sprint.id) ?? newActiveSprints[replacementIndex++];
            return { id: replacement!.id, name: replacement!.name };
          });
        } else {
          selectedSprints = selectedSprints.map((sprint) => {
            const activeSprint = activeById.get(sprint.id)!;
            return { id: activeSprint.id, name: activeSprint.name };
          });
        }
      }

      const representativeSprint = selectedSprints[0];
      if (representativeSprint === undefined) {
        return yield* syncError("invalid_binding", "Select at least one Jira sprint.");
      }
      currentSprintId = representativeSprint.id;
      currentSprintName = representativeSprint.name;

      const configuration =
        binding.boardMode === "mirror_jira"
          ? yield* api.getBoardConfiguration({
              connectionId: binding.connectionId,
              boardId: binding.boardId,
            })
          : null;
      const effectiveBinding = {
        ...binding,
        sprintId: currentSprintId,
        sprintName: currentSprintName,
        selectedSprints,
        ...(configuration === null
          ? {}
          : {
              boardColumns: configuration.columns,
              statusMappings: mirrorStatusMappings(configuration),
            }),
      } satisfies WorkbenchJiraBinding;
      const existing = yield* repository
        .listIssueLinks(binding.id)
        .pipe(Effect.mapError(repositoryError));
      const existingByIssueId = new Map(existing.map((link) => [link.issue.issueId, link]));
      const issuesById = new Map<string, WorkbenchJiraIssueSnapshot>();
      for (const selectedSprint of selectedSprints) {
        const sprintIssues = yield* api.listAssignedSprintIssues({
          connectionId: effectiveBinding.connectionId,
          boardId: effectiveBinding.boardId,
          sprintId: selectedSprint.id,
        });
        for (const issue of sprintIssues) {
          if (!issuesById.has(issue.issueId)) issuesById.set(issue.issueId, issue);
        }
      }
      const issues = Array.from(issuesById.values());

      const imports = [] as Array<{
        readonly issue: (typeof issues)[number];
        readonly mappedStatus: WorkbenchJiraBinding["statusMappings"][number]["workbenchStatus"];
      }>;
      for (const issue of issues) {
        const mappedStatus = effectiveBinding.statusMappings.find(
          (mapping) => mapping.jiraStatusId === issue.status.id,
        )?.workbenchStatus;
        if (mappedStatus === undefined) {
          return yield* syncError(
            "status_unmapped",
            `Jira status ${issue.status.name} is not mapped to a Workbench column.`,
          );
        }
        imports.push({ issue, mappedStatus });
      }

      const syncedAt = DateTime.formatIso(DateTime.makeUnsafe(yield* clock.currentTimeMillis));
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const latestBinding = yield* repository
              .getBinding(binding.id)
              .pipe(Effect.mapError(repositoryError));
            if (
              Option.isNone(latestBinding) ||
              latestBinding.value.updatedAt !== binding.updatedAt
            ) {
              return yield* syncError(
                "invalid_binding",
                "The Jira sprint binding changed during synchronization. Refresh it again.",
              );
            }

            const incoming: Array<JiraIssueImport> = [];
            for (const entry of imports) {
              const ticketId = yield* importer.upsertJiraProjection({
                binding: effectiveBinding,
                existingTicketId: existingByIssueId.get(entry.issue.issueId)?.ticketId ?? null,
                issue: entry.issue,
                mappedStatus: entry.mappedStatus,
              });
              incoming.push({ ticketId, issue: entry.issue });
            }

            const result = reconcileJiraIssueLinks({
              bindingId: binding.id,
              existing,
              incoming,
              syncedAt,
            });
            yield* repository
              .replaceIssueLinks(binding.id, result.links)
              .pipe(Effect.mapError(repositoryError));

            const metadataUpdated = yield* repository
              .updateBindingSyncMetadata({
                id: binding.id,
                expectedUpdatedAt: binding.updatedAt,
                syncedAt,
                ...(currentSprintId === binding.sprintId && currentSprintName === binding.sprintName
                  ? {}
                  : { sprintId: currentSprintId, sprintName: currentSprintName }),
                ...(sameSelectedSprints(selectedSprints, binding.selectedSprints)
                  ? {}
                  : { selectedSprints }),
                ...(configuration === null
                  ? {}
                  : {
                      boardColumns: configuration.columns,
                      statusMappings: mirrorStatusMappings(configuration),
                    }),
                ...(binding.followActiveSprint ? { observedActiveSprintIds } : {}),
              })
              .pipe(Effect.mapError(repositoryError));
            if (!metadataUpdated) {
              return yield* syncError(
                "invalid_binding",
                "The Jira sprint binding changed during synchronization. Refresh it again.",
              );
            }
            return result;
          }),
        )
        .pipe(
          Effect.catchTag("SqlError", () =>
            Effect.fail(
              syncError(
                "persistence_failed",
                "Jira synchronization state could not be saved or loaded.",
              ),
            ),
          ),
        );
    });

    return yield* sync.pipe(Effect.tapError(persistSyncError));
  });

  return JiraSyncService.of({ syncBinding, withBindingPermit });
});

export const layer = Layer.effect(JiraSyncService, make);
