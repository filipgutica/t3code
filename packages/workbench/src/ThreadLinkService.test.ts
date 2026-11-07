import {
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchOperationError,
  WorkbenchProjectId,
  WorkbenchTicketId,
  WorkbenchTicketWorkspaceAttemptId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ThreadLinkHost, type ThreadBinding } from "./ThreadLinkHost.ts";
import { ThreadLinkService, layer } from "./ThreadLinkService.ts";
import { TicketWorkspaceService } from "./TicketWorkspaceService.ts";
import { WorkbenchNativeAccess } from "./WorkbenchNativeAccess.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "./WorkbenchStore.ts";

const api = ProjectId.make("link-api");
const web = ProjectId.make("link-web");
const elsewhere = ProjectId.make("link-elsewhere");
const workspaceId = WorkbenchProjectId.make("link-workspace");
const ticketId = WorkbenchTicketId.make("link-ticket");
const branch = "t3/expire-invitations";
const createdAt = "2026-11-07T10:00:00.000Z";
const checkout = (projectId: ProjectId) => `/worktrees/${projectId}`;

const inTicket = ThreadId.make("link-in-ticket");
const otherWorktree = ThreadId.make("link-other-worktree");
const foreign = ThreadId.make("link-foreign");
const assignedElsewhere = ThreadId.make("link-assigned-elsewhere");

interface NativeThread extends ThreadBinding {
  readonly archivedAt: string | null;
}

/** Native Threads the fake host forks, rebinds, and deletes. */
const makeNative = () => {
  const threads = new Map<ThreadId, NativeThread>([
    [inTicket, { projectId: api, branch, worktreePath: checkout(api), archivedAt: null }],
    [
      otherWorktree,
      { projectId: api, branch: "feature/draft", worktreePath: "/elsewhere/api", archivedAt: null },
    ],
    [foreign, { projectId: elsewhere, branch: null, worktreePath: null, archivedAt: null }],
    [assignedElsewhere, { projectId: api, branch: null, worktreePath: null, archivedAt: null }],
  ]);
  const events: Array<string> = [];
  return { threads, events };
};
type Native = ReturnType<typeof makeNative>;

const describeBinding = (binding: ThreadBinding) =>
  `${binding.projectId} ${binding.worktreePath} ${binding.branch}`;

const makeHost = (
  native: Native,
  overrides: Partial<ThreadLinkHost["Service"]> = {},
): ThreadLinkHost["Service"] =>
  ThreadLinkHost.of({
    forkThread: (sourceThreadId) =>
      Effect.sync(() => {
        const source = native.threads.get(sourceThreadId)!;
        const forkId = ThreadId.make(`${sourceThreadId}-fork`);
        native.threads.set(forkId, { ...source });
        native.events.push(`fork ${sourceThreadId}`);
        return forkId;
      }),
    rebindThread: ({ threadId, from, to }) =>
      Effect.sync(() => {
        native.threads.set(threadId, { ...to, archivedAt: null });
        native.events.push(
          `rebind ${threadId} from ${describeBinding(from)} to ${describeBinding(to)}`,
        );
      }),
    deleteThread: (threadId) =>
      Effect.sync(() => {
        native.threads.delete(threadId);
        native.events.push(`delete ${threadId}`);
      }),
    ...overrides,
  });

const makeTestLayer = (native: Native, host: ThreadLinkHost["Service"]) =>
  layer.pipe(
    Layer.provideMerge(Layer.succeed(ThreadLinkHost, host)),
    Layer.provideMerge(
      Layer.effect(
        TicketWorkspaceService,
        Effect.map(WorkbenchStore, (store) =>
          TicketWorkspaceService.of({
            prepare: (input) =>
              Effect.sync(() => native.events.push("prepare")).pipe(
                Effect.andThen(store.getTicketWorkspace(input.ticketId)),
                Effect.map(Option.getOrThrow),
              ),
            release: () => Effect.die("unused"),
            listWorktrees: () => Effect.die("unused"),
            removeWorktree: () => Effect.die("unused"),
          }),
        ),
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
            Effect.sync(() =>
              Option.map(Option.fromUndefinedOr(native.threads.get(id)), (thread) => ({
                id,
                ...thread,
              })),
            ),
          hasThreadAtWorktreePath: () => Effect.succeed(false),
          listThreadWorkspacePaths: Effect.succeed([]),
          findStartingRun: () => Effect.succeedNone,
          contextMarker: () => Effect.succeed(0),
          findRun: () => Effect.succeedNone,
        }),
      ),
    ),
    Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
    Layer.provideMerge(NodeCrypto.layer),
  );

/** A Ticket on `api` and `web` whose worktrees are ready, and another Ticket that owns a Thread. */
const seed = Effect.gen(function* () {
  const store = yield* WorkbenchStore;
  yield* store.createProject({
    id: workspaceId,
    title: "Link workspace",
    linkedProjectIds: [api, web, elsewhere],
    createdAt,
  });
  for (const [id, title] of [
    [ticketId, "Expire invitations"],
    [WorkbenchTicketId.make("link-other-ticket"), "Other Ticket"],
  ] as const) {
    yield* store.createTicket({
      id,
      projectId: workspaceId,
      title,
      markdown: "",
      repositoryProjectIds: [api, web],
      createdAt,
    });
  }
  yield* store.createAssignment({
    id: WorkbenchAssignmentId.make("link-other-assignment"),
    ticketId: WorkbenchTicketId.make("link-other-ticket"),
    threadId: assignedElsewhere,
    createdAt,
  });
  const attemptId = WorkbenchTicketWorkspaceAttemptId.make("link-attempt");
  yield* store.claimTicketWorkspace({
    ticketId,
    attemptId,
    branchName: branch,
    repositories: [api, web].map((projectId) => ({
      projectId,
      sourcePath: `/repos/${projectId}`,
      worktreePath: checkout(projectId),
    })),
    claimedAt: createdAt,
  });
  for (const projectId of [api, web]) {
    yield* store.markTicketWorkspaceRepositoryReady({
      ticketId,
      attemptId,
      projectId,
      worktreePath: checkout(projectId),
      branchName: branch,
      updatedAt: createdAt,
    });
  }
  yield* store.completeTicketWorkspace({ ticketId, attemptId, completedAt: createdAt });
});

const link = (threadId: ThreadId, repositoryProjectId?: ProjectId) =>
  Effect.flatMap(ThreadLinkService, (links) =>
    links.linkThread({
      id: WorkbenchAssignmentId.make(`link-assignment-${threadId}`),
      ticketId,
      threadId,
      ...(repositoryProjectId === undefined ? {} : { repositoryProjectId }),
      createdAt,
    }),
  );

const ownerOf = (threadId: ThreadId) =>
  Effect.flatMap(WorkbenchStore, (store) => store.resolveThreadOwner(threadId));

describe("ThreadLinkService", () => {
  it.effect("links a Thread that already runs in a Ticket worktree without forking it", () => {
    const native = makeNative();
    return Effect.gen(function* () {
      yield* seed;
      const assignment = yield* link(inTicket);
      expect(assignment.threadId).toBe(inTicket);
      expect(yield* ownerOf(inTicket)).toEqual(Option.some({ kind: "ticket", ticketId }));
      expect(native.events).toEqual([]);
    }).pipe(Effect.provide(makeTestLayer(native, makeHost(native))));
  });

  it.effect("links a fork bound to the Ticket worktree and leaves the source unchanged", () => {
    const native = makeNative();
    const source = native.threads.get(otherWorktree);
    return Effect.gen(function* () {
      yield* seed;
      const assignment = yield* link(otherWorktree);
      const fork = ThreadId.make(`${otherWorktree}-fork`);
      expect(assignment.threadId).toBe(fork);
      expect(native.events).toEqual([
        "prepare",
        `fork ${otherWorktree}`,
        `rebind ${fork} from link-api /elsewhere/api feature/draft to link-api ${checkout(api)} ${branch}`,
      ]);
      expect(native.threads.get(otherWorktree)).toEqual(source);
      expect(yield* ownerOf(otherWorktree)).toEqual(Option.none());
      expect(yield* ownerOf(fork)).toEqual(Option.some({ kind: "ticket", ticketId }));
    }).pipe(Effect.provide(makeTestLayer(native, makeHost(native))));
  });

  it.effect("forks a Thread from an unlinked repository into the Ticket repository picked", () => {
    const native = makeNative();
    return Effect.gen(function* () {
      yield* seed;
      expect(yield* Effect.flip(link(foreign))).toMatchObject({ code: "repository_not_linked" });
      expect(yield* Effect.flip(link(foreign, elsewhere))).toMatchObject({
        code: "repository_not_linked",
      });
      expect(native.events).toEqual([]);

      const assignment = yield* link(foreign, web);
      const fork = ThreadId.make(`${foreign}-fork`);
      expect(assignment.threadId).toBe(fork);
      expect(native.events).toEqual([
        "prepare",
        `fork ${foreign}`,
        `rebind ${fork} from link-elsewhere null null to link-web ${checkout(web)} ${branch}`,
      ]);
    }).pipe(Effect.provide(makeTestLayer(native, makeHost(native))));
  });

  it.effect("refuses a source another Ticket owns or that is archived, before forking", () => {
    const native = makeNative();
    native.threads.set(foreign, { ...native.threads.get(foreign)!, archivedAt: createdAt });
    return Effect.gen(function* () {
      yield* seed;
      expect(yield* Effect.flip(link(assignedElsewhere))).toMatchObject({
        code: "assignment_already_exists",
      });
      expect(yield* Effect.flip(link(foreign, web))).toMatchObject({ code: "thread_not_found" });
      expect(native.events).toEqual([]);
    }).pipe(Effect.provide(makeTestLayer(native, makeHost(native))));
  });

  it.effect("deletes the fork when rebinding it fails", () => {
    const native = makeNative();
    const failure = new WorkbenchOperationError({
      code: "persistence_failed",
      message: "The fork could not be moved.",
    });
    const host = makeHost(native, { rebindThread: () => Effect.fail(failure) });
    return Effect.gen(function* () {
      yield* seed;
      expect(yield* Effect.flip(link(otherWorktree))).toBe(failure);
      const fork = ThreadId.make(`${otherWorktree}-fork`);
      expect(native.events).toEqual(["prepare", `fork ${otherWorktree}`, `delete ${fork}`]);
      expect(native.threads.has(fork)).toBe(false);
      expect(yield* ownerOf(fork)).toEqual(Option.none());
    }).pipe(Effect.provide(makeTestLayer(native, host)));
  });

  it.effect("reports the unlinked fork when cleanup also fails", () => {
    const native = makeNative();
    const host = makeHost(native, {
      rebindThread: () =>
        Effect.fail(
          new WorkbenchOperationError({
            code: "persistence_failed",
            message: "The fork could not be moved.",
          }),
        ),
      deleteThread: () =>
        Effect.fail(
          new WorkbenchOperationError({
            code: "persistence_failed",
            message: "The fork could not be deleted.",
          }),
        ),
    });
    return Effect.gen(function* () {
      yield* seed;
      const failure = yield* Effect.flip(link(otherWorktree));
      const fork = ThreadId.make(`${otherWorktree}-fork`);
      expect(failure.message).toContain(fork);
      expect(failure.message).toContain("could not be deleted");
      expect(native.threads.has(fork)).toBe(true);
      expect(yield* ownerOf(fork)).toEqual(Option.none());
      expect(yield* ownerOf(otherWorktree)).toEqual(Option.none());
    }).pipe(Effect.provide(makeTestLayer(native, host)));
  });

  it.effect("deletes the fork when its Assignment cannot be created", () => {
    const native = makeNative();
    return Effect.gen(function* () {
      yield* seed;
      const links = yield* ThreadLinkService;
      const failure = yield* Effect.flip(
        links.linkThread({
          id: WorkbenchAssignmentId.make("link-other-assignment"),
          ticketId,
          threadId: otherWorktree,
          createdAt,
        }),
      );
      expect(failure).toMatchObject({ code: "persistence_failed" });
      const fork = ThreadId.make(`${otherWorktree}-fork`);
      expect(native.events.at(-1)).toBe(`delete ${fork}`);
      expect(native.threads.has(fork)).toBe(false);
      expect(yield* ownerOf(fork)).toEqual(Option.none());
      expect(yield* ownerOf(otherWorktree)).toEqual(Option.none());
      expect(native.threads.has(assignedElsewhere)).toBe(true);
      expect(yield* ownerOf(assignedElsewhere)).toEqual(
        Option.some({
          kind: "ticket",
          ticketId: WorkbenchTicketId.make("link-other-ticket"),
        }),
      );
    }).pipe(Effect.provide(makeTestLayer(native, makeHost(native))));
  });
});
