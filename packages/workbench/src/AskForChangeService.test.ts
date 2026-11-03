import {
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchOperationError,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { AskForChangeService, AskForChangeServiceLive } from "./AskForChangeService.ts";
import { MarkdownRewriteHost, type MarkdownRewriteRequest } from "./MarkdownRewriteHost.ts";
import { WorkbenchNativeAccess } from "./WorkbenchNativeAccess.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "./WorkbenchStore.ts";

const projectId = ProjectId.make("ask-project");
const workspaceId = WorkbenchProjectId.make("ask-workspace");
const ticketId = WorkbenchTicketId.make("ask-ticket");
const createdAt = "2026-10-20T10:00:00.000Z";
const goal = "Explain why worktree setup fails.";
const target = "Show the failing command and its [log](https://example.invalid/log).";
const brief = `## Goal\n\n${goal}\n\n${target}\n\n- Keep the retry button`;
const start = brief.indexOf(target);
const selection = {
  start,
  end: start + target.length,
  blockSource: target,
  selectedText: "failing command",
  instruction: "Also mention the exit code.",
};

const storeLayer = WorkbenchStoreLive.pipe(
  Layer.provideMerge(
    Layer.succeed(WorkbenchNativeAccess, {
      findProject: (id) => Effect.succeedSome({ id, title: id, workspaceRoot: `/repos/${id}` }),
      isRepository: () => Effect.succeed(true),
      findThread: () => Effect.succeedNone,
      hasThreadAtWorktreePath: () => Effect.succeed(false),
      listThreadWorkspacePaths: Effect.succeed([]),
      findStartingRun: () => Effect.succeedNone,
      contextMarker: () => Effect.succeed(0),
      findRun: () => Effect.succeedNone,
      executionSequence: Effect.succeed(0),
      startedExecutionRunIds: Effect.succeed([]),
      hasPendingThreadWork: () => Effect.succeed(false),
    }),
  ),
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
  Layer.provideMerge(NodeCrypto.layer),
);

/** The fake host may use the store, to write while the rewrite is running. */
const withHost = (
  rewrite: (
    request: MarkdownRewriteRequest,
  ) => Effect.Effect<string, WorkbenchOperationError, WorkbenchStore>,
) =>
  AskForChangeServiceLive.pipe(
    Layer.provide(
      Layer.effect(
        MarkdownRewriteHost,
        Effect.gen(function* () {
          const store = yield* WorkbenchStore;
          return MarkdownRewriteHost.of({
            rewrite: (request) =>
              rewrite(request).pipe(Effect.provideService(WorkbenchStore, store)),
          });
        }),
      ),
    ),
    Layer.provideMerge(storeLayer),
  );

const seedTicket = Effect.gen(function* () {
  const store = yield* WorkbenchStore;
  yield* store.createProject({
    id: workspaceId,
    title: "Ask",
    linkedProjectIds: [projectId],
    createdAt,
  });
  return yield* store.createTicket({
    id: ticketId,
    projectId: workspaceId,
    title: "Explain worktree failures",
    markdown: brief,
    repositoryProjectIds: [projectId],
    createdAt,
  });
});

const seedDraft = Effect.gen(function* () {
  const store = yield* WorkbenchStore;
  yield* store.createProject({
    id: workspaceId,
    title: "Ask",
    linkedProjectIds: [projectId],
    createdAt,
  });
  const created = yield* store.beginTicketDraft({
    id: ticketId,
    projectId: workspaceId,
    threadId: ThreadId.make("ask-planning"),
    modelSelection: ModelSelection.make({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-6.1-sol",
    }),
  });
  const draft = yield* store.transitionTicketDraft({
    id: created.id,
    expectedRevision: created.revision,
    from: ["creating"],
    phase: "draft",
  });
  return yield* store.updateTicketDraft({
    id: draft.id,
    expectedRevision: draft.revision,
    fields: { title: "Explain worktree failures", markdown: brief, repositoryProjectIds: [] },
    writer: { kind: "user" },
  });
});

describe("AskForChangeService", () => {
  it.effect("replaces the selected blocks and keeps every other byte", () => {
    const requests: Array<MarkdownRewriteRequest> = [];
    return Effect.gen(function* () {
      const service = yield* AskForChangeService;
      const ticket = yield* seedTicket;
      const saved = yield* service.askForTicketChange({
        id: ticketId,
        expectedRevision: ticket.revision,
        ...selection,
      });
      expect(saved.markdown).toBe(
        `${brief.slice(0, selection.start)}Rewritten block.${brief.slice(selection.end)}`,
      );
      expect(saved).toMatchObject({
        revision: ticket.revision + 1,
        updatedByThreadId: null,
        updatedByAskForChange: true,
        reviewBase: { title: ticket.title, markdown: brief },
      });
      expect(requests).toEqual([
        {
          projectId,
          blocks: target,
          selectedText: selection.selectedText,
          instruction: selection.instruction,
          context: `${ticket.title}\n\n${goal}`,
        },
      ]);
    }).pipe(
      Effect.provide(
        withHost((request) =>
          Effect.sync(() => {
            requests.push(request);
            return "\nRewritten block.\n";
          }),
        ),
      ),
    );
  });

  it.effect("rejects a block source that no longer matches without generating", () => {
    let rewrites = 0;
    return Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const service = yield* AskForChangeService;
      const ticket = yield* seedTicket;
      const error = yield* Effect.flip(
        service.askForTicketChange({
          id: ticketId,
          expectedRevision: ticket.revision,
          ...selection,
          end: selection.end - 1,
        }),
      );
      expect(error).toMatchObject({ code: "ask_for_change_invalid" });
      expect(rewrites).toBe(0);
      expect(Option.getOrThrow(yield* store.getTicket(ticketId))).toEqual(ticket);
    }).pipe(
      Effect.provide(
        withHost(() =>
          Effect.sync(() => {
            rewrites += 1;
            return "Rewritten block.";
          }),
        ),
      ),
    );
  });

  it.effect("writes nothing when the brief changes during generation", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const service = yield* AskForChangeService;
      const ticket = yield* seedTicket;
      const error = yield* Effect.flip(
        service.askForTicketChange({
          id: ticketId,
          expectedRevision: ticket.revision,
          ...selection,
        }),
      );
      expect(error).toMatchObject({
        code: "ticket_changed",
        message: "The brief changed while rewriting. Ask again.",
      });
      expect(Option.getOrThrow(yield* store.getTicket(ticketId))).toMatchObject({
        markdown: "Edited meanwhile.",
        updatedByAskForChange: false,
      });
    }).pipe(
      Effect.provide(
        withHost(() =>
          Effect.gen(function* () {
            const store = yield* WorkbenchStore;
            const current = Option.getOrThrow(yield* store.getTicket(ticketId));
            yield* store.updateTicket({
              id: ticketId,
              expectedRevision: current.revision,
              markdown: "Edited meanwhile.",
              updatedAt: createdAt,
              writer: { kind: "user" },
            });
            return "Rewritten block.";
          }).pipe(Effect.orDie),
        ),
      ),
    ),
  );

  it.effect("writes nothing when the request is interrupted during generation", () => {
    const started = Deferred.makeUnsafe<void>();
    return Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const service = yield* AskForChangeService;
      const ticket = yield* seedTicket;
      const request = yield* service
        .askForTicketChange({ id: ticketId, expectedRevision: ticket.revision, ...selection })
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(request);
      expect(Option.getOrThrow(yield* store.getTicket(ticketId))).toEqual(ticket);
    }).pipe(
      Effect.provide(
        withHost(() => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))),
      ),
    );
  });

  it.effect("rewrites a draft's brief and fails if the draft changes meanwhile", () => {
    let interleave = false;
    return Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const service = yield* AskForChangeService;
      const draft = yield* seedDraft;
      const saved = yield* service.askForDraftChange({
        id: draft.id,
        expectedRevision: draft.revision,
        ...selection,
      });
      expect(saved).toMatchObject({
        fields: {
          markdown: `${brief.slice(0, selection.start)}Rewritten block.${brief.slice(selection.end)}`,
        },
        updatedByAskForChange: true,
        reviewBase: { title: draft.fields.title, markdown: brief },
      });

      interleave = true;
      const reverted = { ...selection, end: selection.start + "Rewritten block.".length };
      const error = yield* Effect.flip(
        service.askForDraftChange({
          id: draft.id,
          expectedRevision: saved.revision,
          ...reverted,
          blockSource: "Rewritten block.",
        }),
      );
      expect(error).toMatchObject({
        code: "ticket_draft_changed",
        message: "The brief changed while rewriting. Ask again.",
      });
      expect((yield* store.getTicketDraft(draft.id)).fields.markdown).toBe("Edited meanwhile.");
    }).pipe(
      Effect.provide(
        withHost(() =>
          Effect.gen(function* () {
            if (interleave) {
              const store = yield* WorkbenchStore;
              const current = yield* store.getTicketDraft(ticketId);
              yield* store.updateTicketDraft({
                id: ticketId,
                expectedRevision: current.revision,
                fields: { ...current.fields, markdown: "Edited meanwhile." },
                writer: { kind: "user" },
              });
            }
            return "Rewritten block.";
          }),
        ),
      ),
    );
  });
});
