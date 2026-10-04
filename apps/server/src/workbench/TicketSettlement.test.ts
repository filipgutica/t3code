import { assert, describe, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  RunId,
  RuntimeRequestId,
  WorkbenchTicketId,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import { WorkbenchSnapshot } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { WorkbenchStore } from "./WorkbenchStore.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
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
const at = DateTime.makeUnsafe;
const makeThread = (
  id: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell => ({
  id: ThreadId.make(id),
  projectId: ProjectId.make("project"),
  title: id,
  providerInstanceId: ProviderInstanceId.make("codex"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  pullRequests: [],
  createdBy: "user",
  creationSource: "web",
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: ThreadId.make(id) },
  forkedFrom: null,
  activeProviderThreadId: null,
  latestRunId: RunId.make("run"),
  activeRunId: null,
  status: "completed",
  latestRunRequestedAt: at("2026-08-20T00:00:00.000Z"),
  latestRunStartedAt: at("2026-08-20T00:00:00.000Z"),
  latestRunCompletedAt: at("2026-08-20T00:01:00.000Z"),
  latestVisibleMessage: null,
  pendingRuntimeRequest: null,
  pendingBackgroundTasks: [],
  providerInstanceHistory: [],
  itemCount: 0,
  visibleItemCount: 0,
  createdAt: at("2026-08-01T00:00:00.000Z"),
  updatedAt: at("2026-08-20T00:00:00.000Z"),
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  latestUserMessageAt: at("2026-08-20T00:00:00.000Z"),
  hasActionableProposedPlan: false,
  ...overrides,
});

describe("Done Ticket settlement", () => {
  it.effect("settles every completed active assignment from an existing Done Ticket", () =>
    Effect.gen(function* () {
      const threads = [
        makeThread("first"),
        makeThread("second"),
        makeThread("dev-server", {
          pendingBackgroundTasks: [
            { kind: "command", taskId: "dev", description: "vp run dev --share" },
          ],
        }),
      ];
      const commands: Array<OrchestrationV2ServerCommand> = [];
      yield* settleSnapshot({
        tickets: [{ id: ticketId, status: "done", archivedAt: null }],
        assignments: threads.map((thread) => ({
          ticketId,
          threadId: thread.id,
          supersededAt: null,
        })),
        snapshot: {
          snapshotSequence: 7,
          schemaVersion: 1,
          archivedThreads: [],
          threads,
        },
        dispatch: (command) =>
          Effect.sync(() => {
            commands.push(command);
            return { sequence: 8, storedEvents: [] };
          }),
      });
      assert.deepEqual(
        commands.map((command) => command.type),
        ["thread.auto-settle", "thread.auto-settle", "thread.auto-settle"],
      );
      assert.deepEqual(
        commands
          .filter((command) => command.type === "thread.auto-settle")
          .map((command) => command.threadId),
        threads.map((thread) => thread.id),
      );
      for (const command of commands) {
        if (command.type !== "thread.auto-settle") throw new Error("Unexpected command");
        assert.strictEqual(DateTime.formatIso(command.snapshotAt), "2026-08-20T00:00:00.000Z");
        assert.strictEqual(DateTime.formatIso(command.settledAt!), "2026-08-20T00:01:00.000Z");
      }
    }),
  );
  it.effect("preserves active pins, pending work, archived and superseded assignments", () =>
    Effect.gen(function* () {
      const threads = [
        makeThread("pin", { settledOverride: "active" }),
        makeThread("pinned", { pinnedAt: at("2026-08-20T00:00:00.000Z") }),
        makeThread("background", {
          pendingBackgroundTasks: [{ kind: "subagent", taskId: "review", description: "Review" }],
        }),
        makeThread("settled", { settledOverride: "settled" }),
        makeThread("auto-settle-disabled", {
          autoSettleDisabledAt: at("2026-08-20T00:00:00.000Z"),
        }),
        makeThread("pending", {
          pendingRuntimeRequest: {
            id: RuntimeRequestId.make("input"),
            kind: "user_input",
            createdAt: at("2026-08-20T00:00:00.000Z"),
          },
        }),
        makeThread("approval", {
          pendingRuntimeRequest: {
            id: RuntimeRequestId.make("approval"),
            kind: "permission",
            createdAt: at("2026-08-20T00:00:00.000Z"),
          },
        }),
        makeThread("archived", { archivedAt: at("2026-08-21T00:00:00.000Z") }),
        makeThread("unfinished", { latestRunCompletedAt: null }),
        makeThread("plan", { hasActionableProposedPlan: true }),
        makeThread("failed", { status: "failed" }),
        makeThread("superseded"),
      ];
      const commands: Array<OrchestrationV2ServerCommand> = [];
      yield* settleSnapshot({
        tickets: [{ id: ticketId, status: "done", archivedAt: null }],
        assignments: threads.map((thread) => ({
          ticketId,
          threadId: thread.id,
          supersededAt: thread.id === "superseded" ? "2026-08-21T00:00:00.000Z" : null,
        })),
        snapshot: {
          snapshotSequence: 7,
          schemaVersion: 1,
          archivedThreads: [],
          threads,
        },
        dispatch: (command) =>
          Effect.sync(() => {
            commands.push(command);
            return { sequence: 8, storedEvents: [] };
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
        const commands: Array<OrchestrationV2ServerCommand> = [];
        const input = {
          assignments: [{ ticketId, threadId: thread.id, supersededAt: null }],
          snapshot: {
            snapshotSequence: 7,
            schemaVersion: 1,
            archivedThreads: [],
            threads: [thread],
          },
          dispatch: (command: OrchestrationV2ServerCommand) =>
            Effect.sync(() => {
              commands.push(command);
              return { sequence: 8, storedEvents: [] };
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
          activityRunStatus: "running",
        }),
        makeThread("queued", { latestUserMessageAt: at("2026-08-20T00:02:00.000Z") }),
      ];
      const commands: Array<OrchestrationV2ServerCommand> = [];
      yield* settleSnapshot({
        tickets: [{ id: ticketId, status: "done", archivedAt: null }],
        assignments: threads.map((thread) => ({
          ticketId,
          threadId: thread.id,
          supersededAt: null,
        })),
        snapshot: {
          snapshotSequence: 7,
          schemaVersion: 1,
          archivedThreads: [],
          threads,
        },
        dispatch: (command) =>
          Effect.sync(() => {
            commands.push(command);
            return { sequence: 8, storedEvents: [] };
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
            createdAt: DateTime.formatIso(thread.createdAt),
            updatedAt: DateTime.formatIso(thread.updatedAt),
          })),
          assignments: threads.map((thread, index) => ({
            id: `assignment-${index}`,
            ticketId: `ticket-${index}`,
            threadId: thread.id,
            createdAt: DateTime.formatIso(thread.createdAt),
            supersededAt: null,
          })),
        });
        const current = yield* Ref.make(snapshot);
        const commands = yield* Queue.unbounded<OrchestrationV2ServerCommand>();
        const testLayer = layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkbenchStore, { getSnapshot: Ref.get(current) }),
              Layer.mock(ThreadManagementService, {
                getShellSnapshot: () =>
                  Effect.succeed({
                    snapshotSequence: 7,
                    schemaVersion: 1,
                    archivedThreads: [],
                    threads,
                  }),
              }),
              Layer.mock(OrchestratorV2, {
                dispatch: (command) =>
                  Queue.offer(commands, command).pipe(Effect.as({ sequence: 8, storedEvents: [] })),
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
      const commands: Array<OrchestrationV2ServerCommand> = [];
      const input = {
        tickets,
        assignments,
        snapshot: {
          snapshotSequence: 7,
          schemaVersion: 1,
          archivedThreads: [],
          threads: [thread],
        },
        dispatch: (command: OrchestrationV2ServerCommand) =>
          Effect.sync(() => {
            commands.push(command);
            return { sequence: 8, storedEvents: [] };
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
          assignments: [{ ...assignments[0]!, supersededAt: DateTime.formatIso(thread.updatedAt) }],
        }),
      });
      assert.deepEqual(commands, []);
    }),
  );
});
