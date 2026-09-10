import { assert, describe, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  WorkbenchTicketId,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import { WorkbenchSnapshot } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { WorkbenchStore } from "./WorkbenchStore.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { TestClock } from "effect/testing";
import { layer, settleDoneTicketThreads } from "./TicketSettlement.ts";

const settleSnapshot = (
  input: Omit<Parameters<typeof settleDoneTicketThreads>[0], "readCurrentWorkbench">,
) =>
  settleDoneTicketThreads({
    ...input,
    readCurrentWorkbench: Effect.succeed({
      tickets: input.tickets,
      assignments: input.assignments,
    }),
  });

const decodeSnapshot = Schema.decodeUnknownSync(WorkbenchSnapshot);

const ticketId = WorkbenchTicketId.make("done-ticket");
const makeThread = (
  id: string,
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell => ({
  id: ThreadId.make(id),
  projectId: ProjectId.make("project"),
  title: id,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  pullRequests: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: "2026-08-20T00:00:00.000Z",
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  latestTurn: {
    turnId: TurnId.make("turn"),
    state: "completed",
    requestedAt: "2026-08-20T00:00:00.000Z",
    startedAt: "2026-08-20T00:00:00.000Z",
    completedAt: "2026-08-20T00:01:00.000Z",
    assistantMessageId: null,
  },
  ...overrides,
});

describe("Done Ticket settlement", () => {
  it.effect("settles every completed active assignment from an existing Done Ticket", () =>
    Effect.gen(function* () {
      const threads = [makeThread("first"), makeThread("second")];
      const commands: Array<OrchestrationCommand> = [];
      yield* settleSnapshot({
        tickets: [{ id: ticketId, status: "done", archivedAt: null }],
        assignments: threads.map((thread) => ({
          ticketId,
          threadId: thread.id,
          supersededAt: null,
        })),
        snapshot: {
          snapshotSequence: 7,
          projects: [],
          threads,
          updatedAt: "2026-08-20T00:01:00.000Z",
        },
        dispatch: (command) =>
          Effect.sync(() => {
            commands.push(command);
            return { sequence: 8 };
          }),
      });
      assert.deepEqual(
        commands.map((command) => command.type),
        ["thread.auto-settle", "thread.auto-settle"],
      );
      for (const command of commands) {
        if (command.type !== "thread.auto-settle") throw new Error("Unexpected command");
        assert.strictEqual(command.snapshotSequence, 7);
        assert.strictEqual(command.settledAt, "2026-08-20T00:01:00.000Z");
      }
    }),
  );
  it.effect("preserves active pins, pending work, archived and superseded assignments", () =>
    Effect.gen(function* () {
      const threads = [
        makeThread("pin", { settledOverride: "active" }),
        makeThread("settled", { settledOverride: "settled" }),
        makeThread("pending", { hasPendingUserInput: true }),
        makeThread("approval", { hasPendingApprovals: true }),
        makeThread("archived", { archivedAt: "2026-08-21T00:00:00.000Z" }),
        makeThread("unfinished", { latestTurn: null }),
        makeThread("superseded"),
      ];
      const commands: Array<OrchestrationCommand> = [];
      yield* settleSnapshot({
        tickets: [{ id: ticketId, status: "done", archivedAt: null }],
        assignments: threads.map((thread) => ({
          ticketId,
          threadId: thread.id,
          supersededAt: thread.id === "superseded" ? "2026-08-21T00:00:00.000Z" : null,
        })),
        snapshot: {
          snapshotSequence: 7,
          projects: [],
          threads,
          updatedAt: "2026-08-20T00:01:00.000Z",
        },
        dispatch: (command) =>
          Effect.sync(() => {
            commands.push(command);
            return { sequence: 8 };
          }),
      });
      assert.deepEqual(commands, []);
    }),
  );
  it.effect(
    "reconciles a newly Done projection but leaves reopened and archived Tickets alone",
    () =>
      Effect.gen(function* () {
        const thread = makeThread("status-change");
        const commands: Array<OrchestrationCommand> = [];
        const input = {
          assignments: [{ ticketId, threadId: thread.id, supersededAt: null }],
          snapshot: {
            snapshotSequence: 7,
            projects: [],
            threads: [thread],
            updatedAt: "2026-08-20T00:01:00.000Z",
          },
          dispatch: (command: OrchestrationCommand) =>
            Effect.sync(() => {
              commands.push(command);
              return { sequence: 8 };
            }),
        };
        yield* settleSnapshot({
          ...input,
          tickets: [{ id: ticketId, status: "in_progress", archivedAt: null }],
        });
        assert.strictEqual(commands.length, 0);
        yield* settleSnapshot({
          ...input,
          tickets: [{ id: ticketId, status: "done", archivedAt: null }],
        });
        assert.strictEqual(commands.length, 1);
        yield* settleSnapshot({
          ...input,
          tickets: [{ id: ticketId, status: "todo", archivedAt: null }],
        });
        yield* settleSnapshot({
          ...input,
          tickets: [{ id: ticketId, status: "done", archivedAt: "2026-08-21T00:00:00.000Z" }],
        });
        assert.strictEqual(commands.length, 1);
      }),
  );
  it.effect("does not settle running sessions or queued work", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-08-20T00:02:00.000Z"));
      const threads = [
        makeThread("running", {
          session: {
            threadId: ThreadId.make("running"),
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: TurnId.make("next"),
            lastError: null,
            updatedAt: "2026-08-20T00:01:00.000Z",
          },
        }),
        makeThread("queued", { latestUserMessageAt: "2026-08-20T00:02:00.000Z" }),
      ];
      const commands: Array<OrchestrationCommand> = [];
      yield* settleSnapshot({
        tickets: [{ id: ticketId, status: "done", archivedAt: null }],
        assignments: threads.map((thread) => ({
          ticketId,
          threadId: thread.id,
          supersededAt: null,
        })),
        snapshot: {
          snapshotSequence: 7,
          projects: [],
          threads,
          updatedAt: "2026-08-20T00:01:00.000Z",
        },
        dispatch: (command) =>
          Effect.sync(() => {
            commands.push(command);
            return { sequence: 8 };
          }),
      });
      assert.deepEqual(commands, []);
    }),
  );
  it.effect("runs on activation and reconciles later Jira/local snapshot changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const threads = [makeThread("initial"), makeThread("later")];
        const snapshot = decodeSnapshot({
          projects: [],
          tickets: threads.map((thread, index) => ({
            id: `ticket-${index}`,
            projectId: "workspace",
            title: "Ticket",
            markdown: "",
            primaryT3ProjectId: thread.projectId,
            status: index === 0 ? "done" : "todo",
            blocked: false,
            archivedAt: null,
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
          })),
          assignments: threads.map((thread, index) => ({
            id: `assignment-${index}`,
            ticketId: `ticket-${index}`,
            threadId: thread.id,
            createdAt: thread.createdAt,
            supersededAt: null,
          })),
        });
        const current = yield* Ref.make(snapshot);
        const commands = yield* Queue.unbounded<OrchestrationCommand>();
        const testLayer = layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkbenchStore, { getSnapshot: Ref.get(current) }),
              Layer.mock(ProjectionSnapshotQuery, {
                getShellSnapshot: () =>
                  Effect.succeed({
                    snapshotSequence: 7,
                    projects: [],
                    threads,
                    updatedAt: "2026-08-20T00:01:00.000Z",
                  }),
              }),
              Layer.mock(OrchestrationEngineService, {
                dispatch: (command) =>
                  Queue.offer(commands, command).pipe(Effect.as({ sequence: 8 })),
              }),
            ),
          ),
        );
        yield* Effect.gen(function* () {
          const first = yield* Queue.take(commands);
          assert.strictEqual(first.type, "thread.auto-settle");
          if (first.type !== "thread.auto-settle") throw new Error("Unexpected command");
          assert.strictEqual(first.threadId, threads[0]!.id);
          yield* Ref.set(current, {
            ...snapshot,
            tickets: snapshot.tickets.map((ticket, index) => ({
              ...ticket,
              status: index === 0 ? ("todo" as const) : ("done" as const),
            })),
          });
          yield* TestClock.adjust("1 minute");
          const second = yield* Queue.take(commands);
          assert.strictEqual(second.type, "thread.auto-settle");
          if (second.type !== "thread.auto-settle") throw new Error("Unexpected command");
          assert.strictEqual(second.threadId, threads[1]!.id);
        }).pipe(Effect.provide(testLayer));
      }),
    ),
  );
  it.effect("revalidates a Ticket reopened or detached after the native snapshot was read", () =>
    Effect.gen(function* () {
      const thread = makeThread("reopened");
      const tickets = [{ id: ticketId, status: "done" as const, archivedAt: null }];
      const assignments = [{ ticketId, threadId: thread.id, supersededAt: null }];
      const commands: Array<OrchestrationCommand> = [];
      const input = {
        tickets,
        assignments,
        snapshot: {
          snapshotSequence: 7,
          projects: [],
          threads: [thread],
          updatedAt: thread.updatedAt,
        },
        dispatch: (command: OrchestrationCommand) =>
          Effect.sync(() => {
            commands.push(command);
            return { sequence: 8 };
          }),
      };
      yield* settleDoneTicketThreads({
        ...input,
        readCurrentWorkbench: Effect.succeed({
          tickets: [{ ...tickets[0]!, status: "todo" as const }],
          assignments,
        }),
      });
      yield* settleDoneTicketThreads({
        ...input,
        readCurrentWorkbench: Effect.succeed({
          tickets,
          assignments: [{ ...assignments[0]!, supersededAt: thread.updatedAt }],
        }),
      });
      assert.deepEqual(commands, []);
    }),
  );
});
