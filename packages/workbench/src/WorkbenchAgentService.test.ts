import {
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchOperationError,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WorkbenchTicketWorkspaceAttemptId,
  type WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

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
const spawned = ThreadId.make("agent-spawned");
const spawnedInSecond = ThreadId.make("agent-spawned-second");
const createdAt = "2026-10-20T10:00:00.000Z";

const makeTestLayer = ({
  host = () => ({}),
  prepare = () => Effect.die("unused"),
  listWorktrees = () => Effect.succeed([]),
}: {
  readonly host?: (store: WorkbenchStore["Service"]) => Partial<WorkbenchAgentHost["Service"]>;
  readonly prepare?: TicketWorkspaceService["Service"]["prepare"];
  readonly listWorktrees?: TicketWorkspaceService["Service"]["listWorktrees"];
} = {}) =>
  layer.pipe(
    Layer.provideMerge(
      Layer.effect(
        WorkbenchAgentHost,
        Effect.map(WorkbenchStore, (store) =>
          WorkbenchAgentHost.of({
            ensureArtifactsDir: (ownerId) =>
              Effect.succeed(`/t3/userdata/workbench-artifacts/${ownerId}`),
            describeProjects: (ids) =>
              Effect.succeed(ids.map((id) => ({ id, title: `${id} repo` }))),
            describeThreads: (ids) =>
              Effect.succeed(ids.map((id) => ({ id, title: `${id} title`, pullRequests: [] }))),
            createThread: () => Effect.die("unused"),
            deleteThread: () => Effect.die("unused"),
            sendMessage: () => Effect.die("unused"),
            ...host(store),
          }),
        ),
      ),
    ),
    Layer.provideMerge(
      Layer.succeed(
        TicketWorkspaceService,
        TicketWorkspaceService.of({
          prepare,
          release: () => Effect.die("unused"),
          listWorktrees,
          removeWorktree: () => Effect.die("unused"),
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
          findProject: (id) => Effect.succeedSome({ id, title: id, workspaceRoot: `/repos/${id}` }),
          isRepository: () => Effect.succeed(true),
          findThread: (id) =>
            Effect.succeed(
              id === worker || id === spawned
                ? Option.some({ id, projectId: first })
                : id === spawnedInSecond
                  ? Option.some({ id, projectId: second })
                  : Option.none(),
            ),
          hasThreadAtWorktreePath: () => Effect.succeed(false),
          findStartingRun: () => Effect.succeedNone,
          contextMarker: () => Effect.succeed(0),
          findRun: () => Effect.succeedNone,
        }),
      ),
    ),
    Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
    Layer.provideMerge(NodeCrypto.layer),
  );
const testLayer = makeTestLayer();

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
        // Drafts stored before Progress existed have none.
        progress: "",
        artifactsDir: `/t3/userdata/workbench-artifacts/${draft.id}`,
      });
      expect(read.repositories.map((repository) => repository.selected)).toEqual([false, false]);

      const { state } = yield* agent.update({
        threadId: planner,
        expectedRevision: draft.revision,
        title: "Expire invitations",
        brief: "## Goal\n\nInvitations expire after a week.",
        progress: "- [ ] PR 1. Expire tokens",
        repositoryProjectIds: [second],
      });
      expect(state).toMatchObject({
        title: "Expire invitations",
        progress: "- [ ] PR 1. Expire tokens",
        revision: draft.revision + 1,
      });
      const saved = yield* store.getTicketDraft(draft.id);
      expect(saved.progress).toBe("- [ ] PR 1. Expire tokens");
      expect(saved.fields.repositoryProjectIds).toEqual([second]);
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
      const ticked = yield* agent.update({
        threadId: worker,
        expectedRevision: state.revision,
        progress: "- [x] PR 1. Expire tokens",
      });
      expect(ticked.state).toMatchObject({
        progress: "- [x] PR 1. Expire tokens",
        revision: state.revision + 1,
      });
      expect(Option.getOrThrow(yield* store.getTicket(ticket.id))).toMatchObject({
        progressUpdatedByThreadId: worker,
        progressDone: 1,
        progressTotal: 1,
      });
      const stale = yield* Effect.flip(
        agent.update({ threadId: worker, expectedRevision: ticket.revision, brief: "Older" }),
      );
      expect(stale).toMatchObject({
        _tag: "WorkstreamChangedError",
        currentRevision: ticked.state.revision,
      });

      // The worker Thread runs in `first`, so the agent may drop `second` but not `first`.
      const locked = yield* Effect.flip(
        agent.update({
          threadId: worker,
          expectedRevision: ticked.state.revision,
          repositoryProjectIds: [second],
        }),
      );
      expect(locked).toMatchObject({ code: "ticket_repository_scope_locked" });
      const narrowed = yield* agent.update({
        threadId: worker,
        expectedRevision: ticked.state.revision,
        repositoryProjectIds: [first],
      });
      expect(narrowed.state.repositories.filter((repository) => repository.selected)).toEqual([
        { projectId: first, name: `${first} repo`, selected: true, worktreePath: null },
      ]);

      const stranger = yield* Effect.flip(agent.read(ThreadId.make("agent-stranger")));
      expect(stranger.message).toBe("This Thread does not belong to a Ticket");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect.each([
    { name: "lists the Ticket's other worktrees under their repository", fails: false },
    { name: "still reads the Ticket when its worktrees can't be listed", fails: true },
  ])("$name", ({ fails }) =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const agent = yield* WorkbenchAgentService;
      yield* seedWorkspace;
      const ticket = yield* store.createTicket({
        id: WorkbenchTicketId.make("agent-worktrees-ticket"),
        projectId: workspaceId,
        title: "Expire invitations",
        kind: "story",
        markdown: "",
        repositoryProjectIds: [first, second],
        createdAt,
      });
      yield* store.createAssignment({
        id: WorkbenchAssignmentId.make("agent-worktrees-assignment"),
        ticketId: ticket.id,
        threadId: worker,
        createdAt,
      });

      const read = yield* agent.read(worker);
      expect(
        read.repositories.map(({ projectId, worktrees }) => ({ projectId, worktrees })),
      ).toEqual([
        { projectId: first, worktrees: undefined },
        { projectId: second, worktrees: fails ? undefined : ["/home/user/worktrees/acme/pr-x"] },
      ]);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          listWorktrees: () =>
            fails
              ? Effect.fail(
                  new WorkbenchOperationError({
                    code: "persistence_failed",
                    message: "The Ticket Workspace could not be loaded.",
                  }),
                )
              : Effect.succeed([{ projectId: second, path: "/home/user/worktrees/acme/pr-x" }]),
        }),
      ),
    ),
  );

  // The store checks this under its write lock, so a Thread linked after the caller read the Ticket counts.
  it.effect("refuses any update that drops the repository an active Thread works in", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      yield* seedWorkspace;
      const ticket = yield* store.createTicket({
        id: WorkbenchTicketId.make("agent-scope-ticket"),
        projectId: workspaceId,
        title: "Expire invitations",
        kind: "story",
        markdown: "",
        repositoryProjectIds: [first, second],
        createdAt,
      });
      yield* store.createAssignment({
        id: WorkbenchAssignmentId.make("agent-scope-assignment"),
        ticketId: ticket.id,
        threadId: worker,
        createdAt,
      });
      const keepSecond = (updatedByThreadId?: ThreadId) =>
        store.updateTicket({
          id: ticket.id,
          expectedRevision: ticket.revision,
          repositoryProjectIds: [second],
          updatedAt: createdAt,
          ...(updatedByThreadId === undefined ? {} : { updatedByThreadId }),
        });

      for (const updatedByThreadId of [worker, undefined]) {
        expect(yield* Effect.flip(keepSecond(updatedByThreadId))).toMatchObject({
          code: "ticket_repository_scope_locked",
          message: `${first} can't be removed while an active Thread works in it. Archive or delete that Thread first.`,
        });
      }
    }).pipe(Effect.provide(testLayer)),
  );

  // The service resolves the owner before writing; these are the writes of an agent unlinked in between.
  it.effect("rejects an agent's write once its Thread no longer owns the Ticket", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      yield* seedWorkspace;
      const ticket = yield* store.createTicket({
        id: WorkbenchTicketId.make("agent-unlinked-ticket"),
        projectId: workspaceId,
        title: "Expire invitations",
        kind: "story",
        markdown: "",
        repositoryProjectIds: [first],
        createdAt,
      });
      yield* store.createAssignment({
        id: WorkbenchAssignmentId.make("agent-unlinked-assignment"),
        ticketId: ticket.id,
        threadId: worker,
        createdAt,
      });
      const url = "https://github.com/acme/app/issues/7";
      yield* store.addReference({ ticketId: ticket.id, url, addedByThreadId: worker });
      yield* store.unlinkAssignment({ ticketId: ticket.id, threadId: worker });

      const writes = [
        store.addReference({
          ticketId: ticket.id,
          url: "https://github.com/acme/app/issues/8",
          addedByThreadId: worker,
        }),
        store.removeReference({ ticketId: ticket.id, url, actingThreadId: worker }),
        store.updateReference({
          ticketId: ticket.id,
          url,
          title: "Renamed",
          actingThreadId: worker,
        }),
        store.updateTicket({
          id: ticket.id,
          expectedRevision: ticket.revision,
          markdown: "Agent plan.",
          updatedAt: createdAt,
          updatedByThreadId: worker,
        }),
      ];
      for (const write of writes) {
        expect(yield* Effect.flip(write)).toMatchObject({ code: "thread_not_owner" });
      }
      expect((yield* store.listReferences(ticket.id)).map((reference) => reference.url)).toEqual([
        url,
      ]);
      expect(Option.getOrThrow(yield* store.getTicket(ticket.id)).markdown).toBe("");

      yield* store.removeReference({ ticketId: ticket.id, url });
      expect(yield* store.listReferences(ticket.id)).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "records what a Thread reads or writes itself as seen, and only for a recorded Thread",
    () =>
      Effect.gen(function* () {
        const store = yield* WorkbenchStore;
        const agent = yield* WorkbenchAgentService;
        yield* seedWorkspace;
        const ticket = yield* store.createTicket({
          id: WorkbenchTicketId.make("agent-seen-ticket"),
          projectId: workspaceId,
          title: "Expire invitations",
          kind: "story",
          markdown: "Goal",
          repositoryProjectIds: [first],
          createdAt,
        });
        yield* store.createAssignment({
          id: WorkbenchAssignmentId.make("agent-seen-assignment"),
          ticketId: ticket.id,
          threadId: worker,
          createdAt,
        });
        yield* agent.read(worker);
        expect((yield* store.getThreadContext(worker)).seen).toEqual(Option.none());

        yield* store.settleThreadContext({
          threadId: worker,
          endedRunIds: [],
          seen: Option.some({
            runId: RunId.make("agent-seen-run"),
            snapshot: {
              ownerId: ticket.id,
              revision: ticket.revision,
              brief: "Goal",
              progress: "",
              references: [],
              worktrees: [],
              roster: [],
            },
            providerThreadId: null,
            contextMarker: 0,
          }),
        });
        const { state } = yield* agent.update({
          threadId: worker,
          expectedRevision: ticket.revision,
          brief: "Goal, decided",
          progress: "- [ ] PR 1",
        });
        const url = "/artifacts/agent-seen-ticket/mockup-v1.png";
        yield* agent.addReference({ threadId: worker, url, title: "Mockup v1 (proposed)" });
        yield* agent.updateReference({ threadId: worker, url, title: "Mockup v1 (approved)" });
        const plan = "/artifacts/agent-seen-ticket/plan.md";
        yield* agent.addReference({ threadId: worker, url: plan, title: "Plan" });
        yield* agent.removeReference({ threadId: worker, url: plan });

        expect(
          Option.getOrThrow((yield* store.getThreadContext(worker)).seen).snapshot,
        ).toMatchObject({
          revision: state.revision,
          brief: "Goal, decided",
          progress: "- [ ] PR 1",
          references: [{ url, title: "Mockup v1 (approved)" }],
        });
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "starts another Thread in the caller's repository or a chosen one, linked before its first message",
    () =>
      Effect.gen(function* () {
        const events = yield* Ref.make<ReadonlyArray<string>>([]);
        const note = (event: string) => Ref.update(events, (all) => [...all, event]);
        const workspace = (ticketId: WorkbenchTicketId): WorkbenchTicketWorkspace => ({
          ticketId,
          attemptId: WorkbenchTicketWorkspaceAttemptId.make("agent-attempt"),
          status: "ready",
          branchName: "t3/expire-invitations",
          errorMessage: null,
          repositories: [first, second].map((projectId) => ({
            projectId,
            sourcePath: `/repos/${projectId}`,
            worktreePath: `/worktrees/${projectId}`,
            branchName: "t3/expire-invitations",
            status: "ready" as const,
            errorMessage: null,
            createdAt,
            updatedAt: createdAt,
          })),
          createdAt,
          updatedAt: createdAt,
        });
        const host = (store: WorkbenchStore["Service"]) => ({
          createThread: (input: Parameters<WorkbenchAgentHost["Service"]["createThread"]>[0]) =>
            note(`create ${input.projectId} ${input.worktreePath} ${input.title}`).pipe(
              Effect.as(
                input.title === "Unlinkable"
                  ? ThreadId.make("agent-missing")
                  : input.projectId === second
                    ? spawnedInSecond
                    : spawned,
              ),
            ),
          deleteThread: (threadId: ThreadId) => note(`delete ${threadId}`),
          sendMessage: (input: Parameters<WorkbenchAgentHost["Service"]["sendMessage"]>[0]) =>
            store.resolveThreadOwner(input.threadId).pipe(
              Effect.flatMap((owner) =>
                note(
                  `send ${input.text} linked=${Option.isSome(owner)} from=${input.senderThreadId}`,
                ),
              ),
              Effect.orDie,
            ),
        });
        yield* Effect.gen(function* () {
          const store = yield* WorkbenchStore;
          const agent = yield* WorkbenchAgentService;
          yield* seedWorkspace;
          const ticket = yield* store.createTicket({
            id: WorkbenchTicketId.make("agent-start-ticket"),
            projectId: workspaceId,
            title: "Expire invitations",
            kind: "story",
            markdown: "",
            // The caller works in `first`, which is not the Ticket's first repository.
            repositoryProjectIds: [second, first],
            createdAt,
          });
          yield* store.createAssignment({
            id: WorkbenchAssignmentId.make("agent-start-assignment"),
            ticketId: ticket.id,
            threadId: worker,
            createdAt,
          });
          const modes = { runtimeMode: "full-access", interactionMode: "default" } as const;

          expect(
            yield* agent.startThread({ threadId: worker, message: "Implement PR 3", ...modes }),
          ).toEqual({ threadId: spawned, title: "Expire invitations" });
          expect(
            yield* agent.startThread({
              threadId: worker,
              repositoryProjectId: second,
              message: "Review the API",
              ...modes,
            }),
          ).toEqual({ threadId: spawnedInSecond, title: "Expire invitations" });
          for (const threadId of [worker, spawned, spawnedInSecond]) {
            expect(yield* store.resolveThreadOwner(threadId)).toEqual(
              Option.some({ kind: "ticket", ticketId: ticket.id }),
            );
          }
          const unlinkedRepository = yield* Effect.flip(
            agent.startThread({
              threadId: worker,
              repositoryProjectId: ProjectId.make("agent-elsewhere"),
              message: "Hi",
              ...modes,
            }),
          );
          expect(unlinkedRepository).toMatchObject({ code: "repository_not_linked" });

          const unlinkable = yield* Effect.flip(
            agent.startThread({ threadId: worker, title: "Unlinkable", message: "Hi", ...modes }),
          );
          expect(unlinkable).toMatchObject({ code: "thread_not_found" });
          expect(yield* Ref.get(events)).toEqual([
            "create agent-first /worktrees/agent-first Expire invitations",
            `send Implement PR 3 linked=true from=${worker}`,
            "create agent-second /worktrees/agent-second Expire invitations",
            `send Review the API linked=true from=${worker}`,
            "create agent-first /worktrees/agent-first Unlinkable",
            "delete agent-missing",
          ]);

          yield* store.beginTicketDraft({
            id: WorkbenchTicketId.make("agent-start-draft"),
            projectId: workspaceId,
            threadId: planner,
            modelSelection: ModelSelection.make({
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-6.1-sol",
            }),
          });
          const draft = yield* Effect.flip(
            agent.startThread({ threadId: planner, message: "Hi", ...modes }),
          );
          expect(draft).toMatchObject({ code: "ticket_draft_invalid" });
        }).pipe(
          Effect.provide(
            makeTestLayer({ host, prepare: (input) => Effect.succeed(workspace(input.ticketId)) }),
          ),
        );
      }),
  );
});
