import {
  ProviderInstanceId,
  ModelSelection,
  ProjectId,
  RunId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WorkbenchJiraOperationError,
  WorkbenchOperationError,
  WorkbenchTicketWorkspaceAttemptId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as SqlClient from "effect/sql/SqlClient";

import { TicketDraftHost } from "./TicketDraftHost.ts";
import { TicketDraftService, layer } from "./TicketDraftService.ts";
import { TicketWorkspaceService } from "./TicketWorkspaceService.ts";
import { WorkbenchNativeAccess } from "./WorkbenchNativeAccess.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "./WorkbenchStore.ts";
import { ensureWorkbenchSchema } from "./WorkbenchSchema.ts";

const first = ProjectId.make("first-repo");
const second = ProjectId.make("second-repo");
const workspaceId = WorkbenchProjectId.make("tools");
const ticketId = WorkbenchTicketId.make("draft-one");
const threadId = ThreadId.make("planning-one");
const model = ModelSelection.make({
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-6.1-sol",
});
const timestamp = "2026-10-09T12:00:00.000Z";

const fixture = () => {
  const threads = new Map<ThreadId, ProjectId>();
  const paths = new Map<ThreadId, string | null>();
  const archivedThreads = new Set<ThreadId>();
  let sequence = 0;
  let failBinding = false;
  let rejectCreation = false;
  let busy = false;
  let ticketCreates = 0;
  let threadCreates = 0;
  let threadDeletes = 0;
  let prepares = 0;
  let resetBindingOnModeStart = false;
  const native = Layer.succeed(
    WorkbenchNativeAccess,
    WorkbenchNativeAccess.of({
      executionSequence: Effect.sync(() => sequence),
      startedExecutionRunIds: Effect.succeed([]),
      hasPendingThreadWork: () => Effect.sync(() => busy),
      findProject: (id) => Effect.succeed(Option.some({ id })),
      isProjectRepository: () => Effect.succeed(true),
      findThread: (id) =>
        Effect.sync(() => {
          const projectId = threads.get(id);
          return projectId
            ? Option.some({
                id,
                projectId,
                worktreePath: paths.get(id) ?? null,
                branch: paths.get(id) ? "workbench/test" : null,
                archivedAt: archivedThreads.has(id) ? timestamp : null,
              })
            : Option.none();
        }),
      hasThreadAtWorktreePath: (value) => Effect.sync(() => [...paths.values()].includes(value)),
    }),
  );
  const storeLayer = WorkbenchStoreLive.pipe(
    Layer.provideMerge(native),
    Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
    Layer.provide(NodeCrypto.layer),
  );
  const host = Layer.effect(
    TicketDraftHost,
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      return TicketDraftHost.of({
        validatePlanningModel: () => Effect.void,
        createThread: (draft) =>
          Effect.sync(() => {
            threadCreates++;
            threads.set(draft.threadId, draft.anchorProjectId);
            paths.set(draft.threadId, null);
          }),
        requireIdle: () =>
          busy
            ? Effect.fail(
                new WorkbenchOperationError({ code: "ticket_draft_busy", message: "Busy" }),
              )
            : Effect.void,
        requireDiscardable: () =>
          busy
            ? Effect.fail(
                new WorkbenchOperationError({ code: "ticket_draft_busy", message: "Busy" }),
              )
            : Effect.void,
        bindThread: (input) =>
          Effect.gen(function* () {
            if (failBinding) {
              failBinding = false;
              return yield* new WorkbenchOperationError({
                code: "ticket_draft_operation_failed",
                message: "Binding interrupted",
              });
            }
            threads.set(input.draft.threadId, input.projectId);
            paths.set(input.draft.threadId, input.worktreePath);
          }),
        startExecutionMode: (draft) =>
          Effect.sync(() => {
            if (resetBindingOnModeStart) paths.set(draft.threadId, null);
          }),
        deleteThread: (draft) =>
          Effect.sync(() => {
            threadDeletes++;
            threads.delete(draft.threadId);
          }),
        createTicket: (input) =>
          Effect.gen(function* () {
            ticketCreates++;
            if (rejectCreation) {
              rejectCreation = false;
              return yield* new WorkbenchJiraOperationError({
                code: "invalid_binding",
                message: "Choose a valid Jira sprint.",
              });
            }
            return yield* store.createTicket(input);
          }),
      });
    }),
  ).pipe(Layer.provide(storeLayer));
  const workspaces = Layer.effect(
    TicketWorkspaceService,
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      return TicketWorkspaceService.of({
        prepare: (input) =>
          Effect.gen(function* () {
            prepares++;
            const ticket = (yield* store.getSnapshot).tickets.find(
              (value) => value.id === input.ticketId,
            );
            if (!ticket)
              return yield* new WorkbenchOperationError({
                code: "ticket_not_found",
                message: "Missing ticket",
              });
            const attemptId = WorkbenchTicketWorkspaceAttemptId.make("prepared");
            yield* store.claimTicketWorkspace({
              ticketId: ticket.id,
              attemptId,
              branchName: "workbench/test",
              claimedAt: timestamp,
              repositories: ticket.repositoryProjectIds.map((projectId) => ({
                projectId,
                isPrimary: projectId === ticket.primaryT3ProjectId,
                sourcePath: `/repos/${projectId}`,
                worktreePath: `/work-area/${projectId}`,
              })),
            });
            for (const projectId of ticket.repositoryProjectIds)
              yield* store.markTicketWorkspaceRepositoryReady({
                ticketId: ticket.id,
                attemptId,
                projectId,
                worktreePath: `/work-area/${projectId}`,
                branchName: "workbench/test",
                updatedAt: timestamp,
              });
            return yield* store.completeTicketWorkspace({
              ticketId: ticket.id,
              attemptId,
              completedAt: timestamp,
            });
          }),
        release: () =>
          Effect.fail(
            new WorkbenchOperationError({
              code: "ticket_workspace_not_found",
              message: "Not used",
            }),
          ),
      });
    }),
  ).pipe(Layer.provide(storeLayer));
  return {
    layer: layer.pipe(
      Layer.provide(host),
      Layer.provide(workspaces),
      Layer.provideMerge(storeLayer),
    ),
    threads,
    archivedThreads,
    paths,
    setSequence: (next: number) => {
      sequence = next;
    },
    rejectNextCreation: () => {
      rejectCreation = true;
    },
    failNextBinding: () => {
      failBinding = true;
    },
    setBusy: (value: boolean) => {
      busy = value;
    },
    raceBindingOnModeStart: () => {
      resetBindingOnModeStart = true;
    },
    counts: () => ({ ticketCreates, threadCreates, threadDeletes, prepares }),
  };
};
const seed = Effect.gen(function* () {
  const store = yield* WorkbenchStore;
  yield* store.createProject({
    id: workspaceId,
    title: "Tools",
    linkedProjectIds: [first, second],
    createdAt: timestamp,
  });
  const drafts = yield* TicketDraftService;
  let draft = yield* drafts.begin({
    id: ticketId,
    projectId: workspaceId,
    threadId,
    modelSelection: model,
  });
  return yield* drafts.update({
    id: draft.id,
    expectedRevision: draft.revision,
    fields: {
      ...draft.fields,
      title: "Improve worktree errors",
      markdown: "## Goal\nExplain failures",
      repositoryProjectIds: [first, second],
      primaryT3ProjectId: second,
    },
  });
});

const seedUncertainJiraCreate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO workbench_jira_connections
    (connection_id, cloud_id, credential_id, site_name, site_url, scopes_json, created_at, updated_at)
    VALUES ('connection', 'cloud', 'fixture', 'Fixture', 'https://fixture.atlassian.net', '[]', ${timestamp}, ${timestamp})`;
  yield* sql`INSERT INTO workbench_jira_bindings
    (binding_id, workbench_project_id, connection_id, jira_project_id, jira_project_key, jira_project_name,
      board_id, board_name, sprint_id, sprint_name, default_primary_t3_project_id,
      default_repository_project_ids_json, status_mappings_json, active, created_at, updated_at)
    VALUES ('binding', ${workspaceId}, 'connection', 'jira-project', 'FIX', 'Fixture', 1, 'Board', 1, 'Sprint',
      ${first}, '[]', '[]', 1, ${timestamp}, ${timestamp})`;
  yield* sql`INSERT INTO workbench_jira_ticket_creations
    (ticket_id, binding_id, title, kind, markdown, state, created_at, updated_at)
    VALUES (${ticketId}, 'binding', 'Original frozen request', 'story', '', 'uncertain', ${timestamp}, ${timestamp})`;
});

describe("TicketDraftService", () => {
  it.effect(
    "returns a compact preparation index including archived workspaces and promotion recovery",
    () => {
      const f = fixture();
      return Effect.gen(function* () {
        const draft = yield* seed;
        const store = yield* WorkbenchStore;
        const expected = {
          threadId,
          draftId: ticketId,
          projectId: workspaceId,
          ticketId: null,
          phase: "draft",
        };
        expect(yield* store.getTicketPreparations).toEqual([expected]);
        yield* store.archiveProject({
          id: workspaceId,
          expectedRevision: 0,
          archivedAt: timestamp,
          updatedAt: timestamp,
        });
        expect(yield* store.getTicketPreparations).toEqual([expected]);
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE workbench_projects SET archived_at = NULL WHERE project_id = ${workspaceId}`;
        f.failNextBinding();
        yield* (yield* TicketDraftService)
          .promote({ id: draft.id, expectedRevision: draft.revision })
          .pipe(Effect.flip);
        expect(yield* store.getTicketPreparations).toEqual([
          { ...expected, ticketId, phase: "promoting" },
        ]);
        yield* sql`UPDATE workbench_projects SET deleted_at = ${timestamp} WHERE project_id = ${workspaceId}`;
        expect(yield* store.getTicketPreparations).toEqual([]);
      }).pipe(Effect.provide(f.layer));
    },
  );

  it.effect.each(["deleted", "archived", "unlinked", "replaced"] as const)(
    "hides %s saved planning conversations without lifting the old runtime guard",
    (state) => {
      const f = fixture();
      return Effect.gen(function* () {
        const draft = yield* seed;
        const store = yield* WorkbenchStore;
        const service = yield* TicketDraftService;
        const saved = yield* service.promote({ id: draft.id, expectedRevision: draft.revision });
        expect(yield* store.getTicketPreparations).toEqual([
          { threadId, draftId: ticketId, projectId: workspaceId, ticketId, phase: "planning" },
        ]);
        if (state === "deleted") f.threads.delete(threadId);
        if (state === "archived") f.archivedThreads.add(threadId);
        if (state === "unlinked") yield* store.unlinkAssignment({ ticketId, threadId });
        if (state === "replaced") {
          const replacement = ThreadId.make("replacement");
          f.threads.set(replacement, second);
          yield* store.replaceAssignment({
            ticketId,
            previousThreadId: threadId,
            threadId: replacement,
            replacedAt: timestamp,
          });
        }
        expect(yield* store.getTicketPreparations).toEqual([]);
        expect((yield* store.getSnapshot).ticketDrafts).toEqual([]);
        expect((yield* store.getTicketDraftForThread(threadId))?.phase).toBe("planning");
        expect((yield* store.getTicketDraft(saved.id)).threadId).toBe(threadId);
        expect(
          yield* service
            .startWork({ id: saved.id, expectedRevision: saved.revision })
            .pipe(Effect.flip),
        ).toMatchObject({ code: "assignment_changed" });
        expect((yield* store.getTicketDraft(saved.id)).phase).toBe("planning");
      }).pipe(Effect.provide(f.layer));
    },
  );

  it.effect.each(["workspace", "ticket"] as const)(
    "rejects starting work in an archived %s without blocking restoration",
    (target) => {
      const f = fixture();
      return Effect.gen(function* () {
        const draft = yield* seed;
        const service = yield* TicketDraftService;
        const store = yield* WorkbenchStore;
        const saved = yield* service.promote({ id: draft.id, expectedRevision: draft.revision });
        if (target === "workspace") {
          yield* store.archiveProject({
            id: workspaceId,
            expectedRevision: 0,
            archivedAt: timestamp,
            updatedAt: timestamp,
          });
        } else {
          const ticket = (yield* store.getSnapshot).tickets[0]!;
          yield* store.archiveTicket({
            ticketId,
            expectedRevision: ticket.revision,
            archivedAt: timestamp,
            updatedAt: timestamp,
          });
        }
        expect(
          yield* service
            .startWork({ id: saved.id, expectedRevision: saved.revision })
            .pipe(Effect.flip),
        ).toMatchObject({ code: target === "workspace" ? "project_archived" : "ticket_archived" });
        expect((yield* store.getTicketDraft(saved.id)).phase).toBe("planning");
        expect(f.counts().prepares).toBe(0);
        if (target === "workspace") {
          yield* store.archiveProject({
            id: workspaceId,
            expectedRevision: 1,
            archivedAt: null,
            updatedAt: timestamp,
          });
        } else {
          const ticket = (yield* store.getSnapshot).tickets[0]!;
          yield* store.archiveTicket({
            ticketId,
            expectedRevision: ticket.revision,
            archivedAt: null,
            updatedAt: timestamp,
          });
        }
        expect(
          (yield* service.startWork({ id: saved.id, expectedRevision: saved.revision })).phase,
        ).toBe("working");
      }).pipe(Effect.provide(f.layer));
    },
  );

  it.effect("stops indexing a preparation once the same conversation starts work", () => {
    const f = fixture();
    return Effect.gen(function* () {
      const draft = yield* seed;
      const service = yield* TicketDraftService;
      const saved = yield* service.promote({ id: draft.id, expectedRevision: draft.revision });
      const working = yield* service.startWork({ id: saved.id, expectedRevision: saved.revision });
      const store = yield* WorkbenchStore;
      expect(working.phase).toBe("working");
      expect(yield* store.getTicketPreparations).toEqual([]);
      const snapshot = yield* store.getSnapshot;
      expect(snapshot.ticketDrafts).toEqual([]);
      expect(snapshot.tickets.map((ticket) => ticket.id)).toContain(ticketId);
      expect(
        snapshot.assignments.find((assignment) => assignment.threadId === threadId)?.ticketId,
      ).toBe(ticketId);
      expect((yield* store.getTicketDraft(ticketId)).phase).toBe("working");
      expect((yield* store.getTicketDraftForThread(threadId))?.phase).toBe("working");
    }).pipe(Effect.provide(f.layer));
  });

  it.effect("resumes one draft without creating another Thread and protects human edits", () => {
    const f = fixture();
    return Effect.gen(function* () {
      const draft = yield* seed;
      const service = yield* TicketDraftService;
      const resumed = yield* service.begin({
        id: draft.id,
        projectId: workspaceId,
        threadId: draft.threadId,
        modelSelection: model,
      });
      expect(resumed).toEqual(draft);
      const stale = yield* Effect.result(
        service.update({
          id: draft.id,
          expectedRevision: draft.revision - 1,
          fields: { ...draft.fields, title: "Overwrite" },
        }),
      );
      expect(Result.isFailure(stale) && stale.failure.code).toBe("ticket_draft_changed");
      expect(f.counts().threadCreates).toBe(1);
      expect((yield* (yield* WorkbenchStore).getSnapshot).ticketDrafts).toEqual([draft]);
    }).pipe(Effect.provide(f.layer));
  });
  it.effect(
    "creates independent drafts in one workspace after upgrading the singleton index",
    () => {
      const f = fixture();
      return Effect.gen(function* () {
        const firstDraft = yield* seed;
        const store = yield* WorkbenchStore;
        const sql = yield* SqlClient.SqlClient;
        // Simulate an installation that already completed migration 17.
        yield* sql`CREATE UNIQUE INDEX uq_workbench_active_ticket_draft ON workbench_ticket_drafts(workbench_project_id)
        WHERE phase IN ('creating', 'draft', 'promoting', 'discarding')`;
        yield* sql`DELETE FROM workbench_schema_migrations WHERE version = 18`;
        yield* ensureWorkbenchSchema;
        yield* ensureWorkbenchSchema;
        const service = yield* TicketDraftService;
        const input = {
          id: WorkbenchTicketId.make("draft-two"),
          projectId: workspaceId,
          threadId: ThreadId.make("planning-two"),
          modelSelection: model,
        };
        const reservedSecond = yield* store.beginTicketDraft(input);
        expect(reservedSecond.phase).toBe("creating");
        const secondDraft = yield* service.begin(input);
        const editedSecond = yield* service.update({
          id: secondDraft.id,
          expectedRevision: secondDraft.revision,
          fields: { ...secondDraft.fields, title: "A separate investigation" },
        });
        expect(yield* service.begin(input)).toEqual(editedSecond);
        expect(
          yield* service.begin({
            id: firstDraft.id,
            projectId: workspaceId,
            threadId: firstDraft.threadId,
            modelSelection: model,
          }),
        ).toEqual(firstDraft);
        expect(f.counts().threadCreates).toBe(2);
        expect((yield* store.getSnapshot).ticketDrafts).toEqual([firstDraft, editedSecond]);
        yield* service.discard({ id: firstDraft.id, expectedRevision: firstDraft.revision });
        expect((yield* store.getSnapshot).ticketDrafts).toEqual([editedSecond]);
        expect(yield* store.getTicketDraft(editedSecond.id)).toEqual(editedSecond);
      }).pipe(Effect.provide(f.layer));
    },
  );

  it.effect(
    "rejects draft, Thread, and workspace identity collisions without changing either preparation",
    () => {
      const f = fixture();
      return Effect.gen(function* () {
        const draft = yield* seed;
        const store = yield* WorkbenchStore;
        const service = yield* TicketDraftService;
        const otherWorkspace = WorkbenchProjectId.make("other-workspace");
        yield* store.createProject({
          id: otherWorkspace,
          title: "Other",
          linkedProjectIds: [first],
          createdAt: timestamp,
        });
        const input = {
          id: draft.id,
          projectId: workspaceId,
          threadId: draft.threadId,
          modelSelection: model,
        };
        const collisions = [
          { ...input, threadId: ThreadId.make("new-thread") },
          { ...input, id: WorkbenchTicketId.make("new-draft") },
          { ...input, projectId: otherWorkspace },
        ];
        for (const collision of collisions) {
          expect(yield* service.begin(collision).pipe(Effect.flip)).toMatchObject({
            code: "ticket_draft_invalid",
          });
        }
        expect(yield* store.getTicketDraft(draft.id)).toEqual(draft);
        expect(f.counts().threadCreates).toBe(1);
      }).pipe(Effect.provide(f.layer));
    },
  );

  it.effect(
    "recovers promotion after native binding fails without repeating ticket creation",
    () => {
      const f = fixture();
      return Effect.gen(function* () {
        const draft = yield* seed;
        const service = yield* TicketDraftService;
        f.failNextBinding();
        expect(
          Result.isFailure(
            yield* Effect.result(
              service.promote({ id: draft.id, expectedRevision: draft.revision }),
            ),
          ),
        ).toBe(true);
        const store = yield* WorkbenchStore;
        const interrupted = yield* store.getTicketDraft(draft.id);
        expect(interrupted.phase).toBe("promoting");
        const unsafeDiscard = yield* Effect.result(
          service.discard({ id: draft.id, expectedRevision: interrupted.revision }),
        );
        expect(Result.isFailure(unsafeDiscard) && unsafeDiscard.failure.code).toBe(
          "ticket_draft_busy",
        );
        expect(f.counts().threadDeletes).toBe(0);
        const promoted = yield* service.promote({
          id: draft.id,
          expectedRevision: interrupted.revision,
        });
        expect(promoted.phase).toBe("planning");
        expect(promoted.threadId).toBe(threadId);
        expect(f.threads.get(threadId)).toBe(second);
        expect(f.counts()).toMatchObject({ ticketCreates: 1, threadCreates: 1, prepares: 0 });
        expect((yield* store.getSnapshot).assignments[0]?.threadId).toBe(threadId);
        const next = yield* service.begin({
          id: WorkbenchTicketId.make("next"),
          projectId: workspaceId,
          threadId: ThreadId.make("next-thread"),
          modelSelection: model,
        });
        expect(next.id).toBe("next");
      }).pipe(Effect.provide(f.layer));
    },
  );
  it.effect(
    "planning execution never starts the ticket; Start work uses the live primary and advances the boundary",
    () => {
      const f = fixture();
      return Effect.gen(function* () {
        let draft = yield* seed;
        const service = yield* TicketDraftService;
        const store = yield* WorkbenchStore;
        yield* store.initializeTicketExecution;
        draft = yield* service.promote({ id: draft.id, expectedRevision: draft.revision });
        yield* store.consumeTicketExecution({
          sequence: 10,
          run: { id: RunId.make("planning-run"), threadId, startedAt: timestamp },
        });
        let ticket = (yield* store.getSnapshot).tickets[0]!;
        expect(ticket.status).toBe("todo");
        yield* store.updateTicket({
          id: ticket.id,
          expectedRevision: ticket.revision,
          primaryT3ProjectId: first,
          updatedAt: timestamp,
        });
        f.setSequence(20);
        draft = yield* service.startWork({ id: draft.id, expectedRevision: draft.revision });
        expect(draft.phase).toBe("working");
        expect(f.threads.get(threadId)).toBe(first);
        expect(f.paths.get(threadId)).toBe("/work-area/first-repo");
        yield* store.consumeTicketExecution({
          sequence: 19,
          run: { id: RunId.make("delayed-planning-run"), threadId, startedAt: timestamp },
        });
        expect((yield* store.getSnapshot).tickets[0]?.status).toBe("todo");
        yield* store.consumeTicketExecution({
          sequence: 21,
          run: { id: RunId.make("work-run"), threadId, startedAt: timestamp },
        });
        ticket = (yield* store.getSnapshot).tickets[0]!;
        expect(ticket.status).toBe("in_progress");
        expect(f.counts()).toMatchObject({ threadCreates: 1, prepares: 1 });
      }).pipe(Effect.provide(f.layer));
    },
  );
  it.effect(
    "busy promotion leaves the draft editable, and discard removes only its unsaved Thread",
    () => {
      const f = fixture();
      return Effect.gen(function* () {
        const draft = yield* seed;
        const service = yield* TicketDraftService;
        const store = yield* WorkbenchStore;
        f.setBusy(true);
        const attempt = yield* Effect.result(
          service.promote({ id: draft.id, expectedRevision: draft.revision }),
        );
        expect(Result.isFailure(attempt) && attempt.failure.code).toBe("ticket_draft_busy");
        expect((yield* store.getTicketDraft(draft.id)).phase).toBe("draft");
        f.setBusy(false);
        yield* service.discard({ id: draft.id, expectedRevision: draft.revision });
        yield* service.discard({ id: draft.id, expectedRevision: draft.revision });
        expect(f.counts().threadDeletes).toBe(1);
        expect((yield* store.getSnapshot).ticketDrafts).toEqual([]);
        expect((yield* store.getSnapshot).tickets).toEqual([]);
      }).pipe(Effect.provide(f.layer));
    },
  );
  it.effect("Start work ignores obsolete draft scope after the saved ticket changes", () => {
    const f = fixture();
    return Effect.gen(function* () {
      const draft = yield* seed;
      const service = yield* TicketDraftService;
      const store = yield* WorkbenchStore;
      const saved = yield* service.promote({ id: draft.id, expectedRevision: draft.revision });
      const ticket = (yield* store.getSnapshot).tickets[0]!;
      yield* store.updateTicket({
        id: ticket.id,
        expectedRevision: ticket.revision,
        repositoryProjectIds: [first],
        primaryT3ProjectId: first,
        markdown: "Updated plan",
        updatedAt: timestamp,
      });
      yield* store.updateProject({
        id: workspaceId,
        title: "Tools",
        linkedProjectIds: [first],
        updatedAt: timestamp,
      });
      const context = yield* store.getTicketDraftForThread(threadId);
      expect(context?.planningRepositoryProjectIds).toEqual([first]);
      expect(context?.fields.markdown).toBe("Updated plan");
      const working = yield* service.startWork({ id: saved.id, expectedRevision: saved.revision });
      expect(working.phase).toBe("working");
      expect(f.paths.get(threadId)).toBe("/work-area/first-repo");
    }).pipe(Effect.provide(f.layer));
  });
  it.effect(
    "an archived workspace and missing native Thread do not prevent discarding an unsaved draft",
    () => {
      const f = fixture();
      return Effect.gen(function* () {
        const draft = yield* seed;
        const store = yield* WorkbenchStore;
        yield* store.archiveProject({
          id: workspaceId,
          expectedRevision: 0,
          archivedAt: timestamp,
          updatedAt: timestamp,
        });
        f.threads.delete(threadId);
        yield* (yield* TicketDraftService).discard({
          id: draft.id,
          expectedRevision: draft.revision,
        });
        expect((yield* store.getSnapshot).ticketDrafts).toEqual([]);
      }).pipe(Effect.provide(f.layer));
    },
  );
  it.effect(
    "deleting a saved planning ticket releases planning restrictions and preserves native history ownership",
    () => {
      const f = fixture();
      return Effect.gen(function* () {
        const draft = yield* seed;
        const service = yield* TicketDraftService;
        const store = yield* WorkbenchStore;
        yield* service.promote({ id: draft.id, expectedRevision: draft.revision });
        const ticket = (yield* store.getSnapshot).tickets[0]!;
        yield* store.deleteTicket({
          ticketId: ticket.id,
          expectedRevision: ticket.revision,
          deletedAt: timestamp,
        });
        expect(yield* store.getTicketDraftForThread(threadId)).toBeNull();
        expect(f.threads.has(threadId)).toBe(true);
        expect((yield* store.getSnapshot).reservedThreadIds).toContain(threadId);
      }).pipe(Effect.provide(f.layer));
    },
  );
  it.effect(
    "workspace deletion retains its native planning conversation and releases the draft slot",
    () => {
      const f = fixture();
      return Effect.gen(function* () {
        yield* seed;
        const store = yield* WorkbenchStore;
        yield* store.deleteProject({
          id: workspaceId,
          expectedRevision: 0,
          expectedTicketCount: 0,
          expectedEpicCount: 0,
          deletedAt: timestamp,
        });
        expect(yield* store.getTicketDraftForThread(threadId)).toBeNull();
        expect(f.threads.has(threadId)).toBe(true);
        expect((yield* store.getSnapshot).ticketDrafts).toEqual([]);
      }).pipe(Effect.provide(f.layer));
    },
  );
  it.effect("a native rebind racing Start work cannot lift planning restrictions", () => {
    const f = fixture();
    return Effect.gen(function* () {
      const draft = yield* seed;
      const service = yield* TicketDraftService;
      const store = yield* WorkbenchStore;
      const saved = yield* service.promote({ id: draft.id, expectedRevision: draft.revision });
      f.raceBindingOnModeStart();
      const result = yield* Effect.result(
        service.startWork({ id: saved.id, expectedRevision: saved.revision }),
      );
      expect(Result.isFailure(result) && result.failure.code).toBe("ticket_changed");
      expect((yield* store.getTicketDraft(draft.id)).phase).toBe("starting");
      expect((yield* store.getTicketDraftForThread(threadId))?.workArea?.status).toBe("ready");
    }).pipe(Effect.provide(f.layer));
  });
  it.effect("confirmed no-write Jira failure restores an editable draft for Local retry", () => {
    const f = fixture();
    return Effect.gen(function* () {
      const draft = yield* seed;
      const service = yield* TicketDraftService;
      const store = yield* WorkbenchStore;
      const jiraDraft = yield* service.update({
        id: draft.id,
        expectedRevision: draft.revision,
        fields: { ...draft.fields, localOnly: false, jiraSprintId: 999 },
      });
      f.rejectNextCreation();
      const rejected = yield* Effect.result(
        service.promote({ id: jiraDraft.id, expectedRevision: jiraDraft.revision }),
      );
      expect(Result.isFailure(rejected) && rejected.failure.code).toBe("invalid_binding");
      const editable = yield* store.getTicketDraft(draft.id);
      expect(editable.phase).toBe("draft");
      const local = yield* service.update({
        id: editable.id,
        expectedRevision: editable.revision,
        fields: { ...editable.fields, localOnly: true, jiraSprintId: null },
      });
      expect(
        (yield* service.promote({ id: local.id, expectedRevision: local.revision })).phase,
      ).toBe("planning");
      expect(f.counts().threadCreates).toBe(1);
    }).pipe(Effect.provide(f.layer));
  });
  it.effect(
    "abandoning an uncertain Jira create releases the draft slot and retains its no-duplicate ledger",
    () => {
      const f = fixture();
      return Effect.gen(function* () {
        const draft = yield* seed;
        yield* seedUncertainJiraCreate;
        const service = yield* TicketDraftService;
        const store = yield* WorkbenchStore;
        f.rejectNextCreation();
        yield* Effect.result(service.promote({ id: draft.id, expectedRevision: draft.revision }));
        const frozen = yield* store.getTicketDraft(draft.id);
        expect(frozen.phase).toBe("promoting");
        yield* service.discard({ id: frozen.id, expectedRevision: frozen.revision });
        const sql = yield* SqlClient.SqlClient;
        const ledger = yield* sql<{
          readonly state: string;
        }>`SELECT state FROM workbench_jira_ticket_creations WHERE ticket_id = ${draft.id}`;
        expect(ledger[0]?.state).toBe("uncertain");
        expect((yield* store.getSnapshot).ticketDrafts).toEqual([]);
        const next = yield* service.begin({
          id: WorkbenchTicketId.make("fresh-draft"),
          projectId: workspaceId,
          threadId: ThreadId.make("fresh-thread"),
          modelSelection: model,
        });
        expect(next.phase).toBe("draft");
      }).pipe(Effect.provide(f.layer));
    },
  );
});
