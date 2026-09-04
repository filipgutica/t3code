import {
  WorkbenchJiraOperationError,
  type WorkbenchJiraBinding,
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
  "t3/workbench/jira/JiraSyncService",
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

    const existing = yield* repository
      .listIssueLinks(binding.id)
      .pipe(Effect.mapError(repositoryError));
    const existingByIssueId = new Map(existing.map((link) => [link.issue.issueId, link]));
    const issues = yield* api.listAssignedSprintIssues({
      connectionId: binding.connectionId,
      boardId: binding.boardId,
      sprintId: binding.sprintId,
    });

    const imports = [] as Array<{
      readonly issue: (typeof issues)[number];
      readonly mappedStatus: WorkbenchJiraBinding["statusMappings"][number]["workbenchStatus"];
    }>;
    for (const issue of issues) {
      const mappedStatus = binding.statusMappings.find(
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
          if (Option.isNone(latestBinding) || latestBinding.value.updatedAt !== binding.updatedAt) {
            return yield* syncError(
              "invalid_binding",
              "The Jira sprint binding changed during synchronization. Refresh it again.",
            );
          }

          const incoming: Array<JiraIssueImport> = [];
          for (const entry of imports) {
            const ticketId = yield* importer.upsertJiraProjection({
              binding,
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

  return JiraSyncService.of({ syncBinding, withBindingPermit });
});

export const layer = Layer.effect(JiraSyncService, make);
