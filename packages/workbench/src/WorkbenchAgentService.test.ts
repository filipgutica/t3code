import {
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { TicketWorkspaceService } from "./TicketWorkspaceService.ts";
import { WorkbenchAgentHost } from "./WorkbenchAgentHost.ts";
import { WorkbenchAgentService, layer } from "./WorkbenchAgentService.ts";
import { WorkbenchNativeAccess } from "./WorkbenchNativeAccess.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "./WorkbenchStore.ts";

const first = ProjectId.make("agent-first");
const second = ProjectId.make("agent-second");
const workspaceId = WorkbenchProjectId.make("agent-workspace");
const planner = ThreadId.make("agent-planner");
const worker = ThreadId.make("agent-worker");
const createdAt = "2026-10-20T10:00:00.000Z";

const testLayer = layer.pipe(
  Layer.provideMerge(
    Layer.succeed(
      WorkbenchAgentHost,
      WorkbenchAgentHost.of({
        ensureArtifactsDir: (ownerId) =>
          Effect.succeed(`/t3/userdata/workbench-artifacts/${ownerId}`),
        describeProjects: (ids) => Effect.succeed(ids.map((id) => ({ id, title: `${id} repo` }))),
        describeThreads: (ids) =>
          Effect.succeed(ids.map((id) => ({ id, title: `${id} title`, pullRequests: [] }))),
      }),
    ),
  ),
  Layer.provideMerge(
    Layer.succeed(
      TicketWorkspaceService,
      TicketWorkspaceService.of({
        prepare: () => Effect.die("unused"),
        release: () => Effect.die("unused"),
      }),
    ),
  ),
  Layer.provideMerge(WorkbenchStoreLive),
  Layer.provideMerge(
    Layer.succeed(
      WorkbenchNativeAccess,
      WorkbenchNativeAccess.of({
        executionSequence: Effect.succeed(0),
        startedExecutionRunIds: Effect.succeed([]),
        hasPendingThreadWork: () => Effect.succeed(false),
        findProject: (id) => Effect.succeedSome({ id, workspaceRoot: `/repos/${id}` }),
        isRepository: () => Effect.succeed(true),
        findThread: (id) =>
          Effect.succeed(id === worker ? Option.some({ id, projectId: first }) : Option.none()),
        hasThreadAtWorktreePath: () => Effect.succeed(false),
      }),
    ),
  ),
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
  Layer.provideMerge(NodeCrypto.layer),
);

const seedWorkspace = Effect.flatMap(WorkbenchStore, (store) =>
  store.createProject({
    id: workspaceId,
    title: "Agent workspace",
    linkedProjectIds: [first, second],
    createdAt,
  }),
);

describe("WorkbenchAgentService", () => {
  it.effect("lets a planning Thread fill its draft but not give it a status", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const agent = yield* WorkbenchAgentService;
      yield* seedWorkspace;
      const begun = yield* store.beginTicketDraft({
        id: WorkbenchTicketId.make("agent-draft"),
        projectId: workspaceId,
        threadId: planner,
        modelSelection: ModelSelection.make({
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-6.1-sol",
        }),
      });
      const draft = yield* store.transitionTicketDraft({
        id: begun.id,
        expectedRevision: begun.revision,
        from: ["creating"],
        phase: "draft",
      });

      const read = yield* agent.read(planner);
      expect(read).toMatchObject({
        kind: "draft",
        id: draft.id,
        revision: draft.revision,
        phase: "draft",
        artifactsDir: `/t3/userdata/workbench-artifacts/${draft.id}`,
      });
      expect(read.repositories.map((repository) => repository.selected)).toEqual([false, false]);

      const { state } = yield* agent.update({
        threadId: planner,
        expectedRevision: draft.revision,
        title: "Expire invitations",
        brief: "## Goal\n\nInvitations expire after a week.",
        repositoryProjectIds: [second],
      });
      expect(state).toMatchObject({ title: "Expire invitations", revision: draft.revision + 1 });
      const saved = yield* store.getTicketDraft(draft.id);
      expect(saved.fields.primaryT3ProjectId).toBe(second);
      expect(saved.updatedByThreadId).toBe(planner);

      const refused = yield* Effect.flip(
        agent.update({ threadId: planner, expectedRevision: state.revision, status: "done" }),
      );
      expect(refused).toMatchObject({
        _tag: "WorkbenchOperationError",
        code: "ticket_draft_invalid",
      });
      const stale = yield* Effect.flip(
        agent.update({ threadId: planner, expectedRevision: draft.revision, title: "Older" }),
      );
      expect(stale).toMatchObject({
        _tag: "WorkstreamChangedError",
        currentRevision: state.revision,
      });
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("edits the Ticket of an assigned Thread and reports a stale revision", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const agent = yield* WorkbenchAgentService;
      yield* seedWorkspace;
      const ticket = yield* store.createTicket({
        id: WorkbenchTicketId.make("agent-ticket"),
        projectId: workspaceId,
        title: "Expire invitations",
        kind: "story",
        markdown: "",
        primaryT3ProjectId: first,
        repositoryProjectIds: [first, second],
        createdAt,
      });
      yield* store.createAssignment({
        id: WorkbenchAssignmentId.make("agent-assignment"),
        ticketId: ticket.id,
        threadId: worker,
        createdAt,
      });

      const { state } = yield* agent.update({
        threadId: worker,
        expectedRevision: ticket.revision,
        brief: "Agent plan.",
        status: "in_progress",
      });
      expect(state).toMatchObject({
        kind: "workstream",
        brief: "Agent plan.",
        status: "in_progress",
        threads: [{ threadId: worker, title: `${worker} title`, recap: null }],
      });
      expect(Option.getOrThrow(yield* store.getTicket(ticket.id)).updatedByThreadId).toBe(worker);
      const stale = yield* Effect.flip(
        agent.update({ threadId: worker, expectedRevision: ticket.revision, brief: "Older" }),
      );
      expect(stale).toMatchObject({
        _tag: "WorkstreamChangedError",
        currentRevision: state.revision,
      });

      // The worker Thread runs in `first`, so the agent may drop `second` but not `first`.
      const locked = yield* Effect.flip(
        agent.update({
          threadId: worker,
          expectedRevision: state.revision,
          repositoryProjectIds: [second],
        }),
      );
      expect(locked).toMatchObject({ code: "ticket_repository_scope_locked" });
      const narrowed = yield* agent.update({
        threadId: worker,
        expectedRevision: state.revision,
        repositoryProjectIds: [first],
      });
      expect(narrowed.state.repositories.filter((repository) => repository.selected)).toEqual([
        { projectId: first, name: `${first} repo`, selected: true, worktreePath: null },
      ]);

      const stranger = yield* Effect.flip(agent.read(ThreadId.make("agent-stranger")));
      expect(stranger.message).toBe("This Thread does not belong to a Workstream");
    }).pipe(Effect.provide(testLayer)),
  );
});
