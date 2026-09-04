import {
  WorkbenchJiraOperationError,
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

  const syncBinding: JiraSyncServiceShape["syncBinding"] = (input) =>
    Effect.gen(function* () {
      const lock = yield* getBindingLock(input.bindingId);
      return yield* lock.withPermit(syncBindingUnlocked(input));
    });

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

    const incoming: Array<JiraIssueImport> = [];
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
      const ticketId = yield* importer.upsertJiraProjection({
        binding,
        existingTicketId: existingByIssueId.get(issue.issueId)?.ticketId ?? null,
        issue,
        mappedStatus,
      });
      incoming.push({ ticketId, issue });
    }

    const syncedAt = DateTime.formatIso(DateTime.makeUnsafe(yield* clock.currentTimeMillis));
    const result = reconcileJiraIssueLinks({
      bindingId: binding.id,
      existing,
      incoming,
      syncedAt,
    });
    yield* repository
      .replaceIssueLinks(binding.id, result.links)
      .pipe(Effect.mapError(repositoryError));
    yield* repository
      .upsertBinding({ ...binding, lastSyncedAt: syncedAt, updatedAt: syncedAt })
      .pipe(Effect.mapError(repositoryError));
    return result;
  });

  return JiraSyncService.of({ syncBinding });
});

export const layer = Layer.effect(JiraSyncService, make);
