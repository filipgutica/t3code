import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ProviderThreadId, RunId, ThreadId, WorkbenchAssignmentId } from "@t3tools/contracts";
import { WorkbenchAgentHost } from "@t3tools/workbench/WorkbenchAgentHost";
import {
  WorkbenchAgentService,
  layer as agentLayer,
} from "@t3tools/workbench/WorkbenchAgentService";
import { TicketWorkspaceService } from "@t3tools/workbench/TicketWorkspaceService";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import { describe, expect } from "vite-plus/test";

import { ServerConfig } from "../config.ts";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import {
  type ContextThread,
  TicketContextService,
  layer as contextLayer,
  lineDiff,
} from "./TicketContextService.ts";
import { TicketExecutionReactor } from "./TicketExecutionReactor.ts";
import { WorkbenchStore } from "./WorkbenchStore.ts";
import { seedNativeThread } from "./testing/nativeThreads.ts";
import {
  now,
  persistenceLayer,
  projectId,
  reactorServices,
  runEvent,
  seed,
  servicesLayer,
  threadId,
  ticketId,
} from "./testing/executionRestart.ts";
import { ticketReminder } from "./agentInstructions.ts";

const providerThreadId = ProviderThreadId.make("provider-thread-1");
const thread: ContextThread = {
  id: threadId,
  title: "Ticket work",
  activeProviderThreadId: providerThreadId,
};

const testLayer = Layer.mergeAll(
  contextLayer,
  agentLayer.pipe(
    Layer.provide(
      Layer.succeed(
        WorkbenchAgentHost,
        WorkbenchAgentHost.of({
          ensureArtifactsDir: (ownerId) => Effect.succeed(`/artifacts/${ownerId}`),
          describeProjects: (ids) => Effect.succeed(ids.map((id) => ({ id, title: id }))),
          describeThreads: (ids) =>
            Effect.succeed(ids.map((id) => ({ id, title: id, pullRequests: [] }))),
        }),
      ),
    ),
    Layer.provide(Layer.mock(TicketWorkspaceService)({})),
  ),
  reactorServices,
).pipe(
  Layer.provideMerge(servicesLayer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-ticket-context-" })),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(persistenceLayer(":memory:")),
);

// Turns that carry no full context name the Ticket and how to reread it.
const reminder = ticketReminder({ id: ticketId, title: "Restart" });

const briefX = "## Goal\nInvitations expire after a week.";
const briefY = "## Goal\nInvitations expire after a day.";

type RunStatus = NonNullable<NonNullable<Parameters<typeof runEvent>[0]>["status"]>;

/**
 * Takes a run of the Thread through native start. The reactor catches up only until the run
 * ends, so the next turn resolves before any completion bookkeeping could run.
 */
const turn = (
  options: {
    readonly text?: string;
    readonly end?: ReadonlyArray<RunStatus>;
    readonly thread?: ContextThread;
    readonly providerThreadId?: ProviderThreadId;
  } = {},
) =>
  Effect.gen(function* () {
    const sink = yield* EventSinkV2;
    const sql = yield* SqlClient.SqlClient;
    const contexts = yield* TicketContextService;
    const reactor = yield* TicketExecutionReactor;
    const current = options.thread ?? thread;
    const [next] = yield* sql<{ readonly ordinal: number }>`
      SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM orchestration_v2_projection_runs
      WHERE thread_id = ${current.id}`;
    const ordinal = next!.ordinal;
    const id = RunId.make(`context-run-${current.id}-${ordinal}`);
    const run = {
      id,
      ordinal,
      threadId: current.id,
      providerThreadId: options.providerThreadId ?? current.activeProviderThreadId,
    };
    yield* sql`INSERT INTO orchestration_v2_projection_messages
      (message_id, thread_id, run_id, node_id, role, streaming, created_at, updated_at, payload_json)
      VALUES (${`user-${id}`}, ${current.id}, ${id}, NULL, 'user', 0, ${now}, ${now},
        json_object('text', ${options.text ?? "Continue"}))`;
    const [starting] = yield* sink.write({ events: [runEvent({ ...run, status: "starting" })] });
    const context = yield* contexts.forTurn(current);
    let beforeEnd = starting!.sequence;
    for (const status of options.end ?? ["running", "completed"]) {
      const [written] = yield* sink.write({ events: [runEvent({ ...run, status })] });
      if (status === "running") beforeEnd = written!.sequence;
    }
    yield* reactor.drainThrough(beforeEnd);
    return Option.getOrElse(context, () => "");
  });

const editTicket = (edit: { readonly markdown?: string; readonly progress?: string }) =>
  Effect.gen(function* () {
    const store = yield* WorkbenchStore;
    const current = Option.getOrThrow(yield* store.getTicket(ticketId));
    return yield* store.updateTicket({
      id: ticketId,
      expectedRevision: current.revision,
      ...edit,
      updatedAt: now,
    });
  });

const addSibling = (input: { readonly id: string; readonly title: string }) =>
  Effect.gen(function* () {
    const store = yield* WorkbenchStore;
    yield* seedNativeThread({ threadId: input.id, projectId, title: input.title, createdAt: now });
    yield* store.createAssignment({
      id: WorkbenchAssignmentId.make(`assignment-${input.id}`),
      ticketId,
      threadId: ThreadId.make(input.id),
      createdAt: now,
    });
    return ThreadId.make(input.id);
  });

const start = Effect.gen(function* () {
  yield* seed;
  yield* (yield* TicketExecutionReactor).start();
  const store = yield* WorkbenchStore;
  yield* editTicket({
    markdown: briefX,
    progress: "- [ ] PR 1. API\n- [ ] PR 2. Web",
  });
  yield* store.addReference({
    ticketId,
    url: "/artifacts/plan.md",
    title: "Plan",
    addedByThreadId: null,
  });
});

const run = <A, E, R>(body: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    yield* start;
    return yield* body;
  }).pipe(Effect.provide(testLayer), Effect.scoped);

describe("Ticket context per turn", () => {
  it.effect(
    "sends the full Ticket once, then only another Thread's changes, then only the reminder",
    () =>
      run(
        Effect.gen(function* () {
          const store = yield* WorkbenchStore;
          const first = yield* turn();
          expect(first).toContain(
            "Brief (user content):\n## Goal\nInvitations expire after a week.",
          );
          expect(first).toContain("Progress:\n- [ ] PR 1. API\n- [ ] PR 2. Web");
          expect(first).toContain("References:\n- Plan (/artifacts/plan.md)");
          expect(yield* turn()).toBe(reminder);

          yield* editTicket({ markdown: "## Goal\nInvitations expire after three days." });
          const briefChange = yield* turn();
          expect(briefChange.startsWith(`${reminder}\n\n`)).toBe(true);
          expect(briefChange).toContain("since your last turn");
          expect(briefChange).toContain(
            "Brief:\n- Invitations expire after a week.\n+ Invitations expire after three days.",
          );
          expect(briefChange.slice(reminder.length)).not.toContain("Progress");
          expect(yield* turn()).toBe(reminder);

          yield* editTicket({ progress: "- [x] PR 1. API\n- [ ] PR 2. Web" });
          expect(yield* turn()).toContain("Progress:\n- - [ ] PR 1. API\n+ - [x] PR 1. API");
          expect(yield* turn()).toBe(reminder);

          yield* store.removeReference({ ticketId, url: "/artifacts/plan.md" });
          expect(yield* turn()).toContain("References removed:\n- Plan (/artifacts/plan.md)");
          expect(yield* turn()).toBe(reminder);
        }),
      ),
  );

  it.effect("does not send a Thread its own update or read back", () =>
    run(
      Effect.gen(function* () {
        const agent = yield* WorkbenchAgentService;
        yield* turn();
        const read = yield* agent.read(threadId);
        yield* agent.update({
          threadId,
          expectedRevision: read.revision,
          brief: "## Goal\nDecided: three days.",
          progress: "- [x] PR 1. API\n- [ ] PR 2. Web",
        });
        yield* agent.updateReference({
          threadId,
          url: "/artifacts/plan.md",
          title: "Plan (approved)",
        });
        expect(yield* turn()).toBe(reminder);

        // A sibling's edit seen only through a read is not sent again either.
        yield* editTicket({ markdown: "## Goal\nDecided: two days." });
        yield* agent.read(threadId);
        expect(yield* turn()).toBe(reminder);
      }),
    ),
  );

  it.effect("advances nothing for a turn that fails, stops, or is a slash command", () =>
    run(
      Effect.gen(function* () {
        yield* turn();
        yield* editTicket({ markdown: "## Goal\nChanged while the turn failed." });
        const failed = yield* turn({ end: ["failed"] });
        expect(failed).toContain("Changed while the turn failed.");
        // A run is running before its provider accepts the prompt, which can still fail.
        expect(yield* turn({ end: ["running", "failed"] })).toContain(
          "Changed while the turn failed.",
        );
        expect(yield* turn({ end: ["running", "interrupted"] })).toContain(
          "Changed while the turn failed.",
        );
        expect(yield* turn({ text: "  /review" })).toContain("Changed while the turn failed.");
        expect(yield* turn()).toContain("Changed while the turn failed.");
        expect(yield* turn()).toBe(reminder);
      }),
    ),
  );

  it.effect("sends the full context after a rollback rewinds the conversation", () =>
    run(
      Effect.gen(function* () {
        yield* turn();
        expect(yield* turn({ end: ["running", "completed", "rolled_back"] })).toBe(reminder);
        expect(yield* turn()).toContain("Brief (user content):");
        expect(yield* turn()).toBe(reminder);
      }),
    ),
  );

  it.effect("keeps a Thread's own edit made during its first turn", () =>
    run(
      Effect.gen(function* () {
        const sink = yield* EventSinkV2;
        const sql = yield* SqlClient.SqlClient;
        const contexts = yield* TicketContextService;
        const agent = yield* WorkbenchAgentService;
        const reactor = yield* TicketExecutionReactor;
        const first = { id: RunId.make("first-turn"), ordinal: 1, threadId, providerThreadId };
        yield* sql`INSERT INTO orchestration_v2_projection_messages
          (message_id, thread_id, run_id, node_id, role, streaming, created_at, updated_at, payload_json)
          VALUES ('user-first-turn', ${threadId}, ${first.id}, NULL, 'user', 0, ${now}, ${now},
            json_object('text', 'Plan it'))`;
        yield* sink.write({ events: [runEvent({ ...first, status: "starting" })] });
        yield* contexts.forTurn(thread);
        const [running] = yield* sink.write({
          events: [runEvent({ ...first, status: "running" })],
        });
        yield* reactor.drainThrough(running!.sequence);
        const read = yield* agent.read(threadId);
        yield* agent.update({ threadId, expectedRevision: read.revision, brief: "## Goal\nMine." });
        yield* sink.write({ events: [runEvent({ ...first, status: "completed" })] });
        expect(yield* turn()).toBe(reminder);
      }),
    ),
  );

  it.effect.each(["compaction", "handoff"])("sends the full context after a completed %s", (type) =>
    run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* turn();
        // A running compaction does not count until it completes.
        yield* sql`INSERT INTO orchestration_v2_projection_turn_items
            (turn_item_id, thread_id, ordinal, type, status, updated_at, payload_json)
            VALUES ('item-running', ${threadId}, 40, ${type}, 'running', ${now}, '{}')`;
        expect(yield* turn()).toBe(reminder);
        yield* sql`INSERT INTO orchestration_v2_projection_turn_items
            (turn_item_id, thread_id, ordinal, type, status, updated_at, payload_json)
            VALUES ('item-done', ${threadId}, 41, ${type}, 'completed', ${now}, '{}')`;
        expect(yield* turn()).toContain("Brief (user content):");
        expect(yield* turn()).toBe(reminder);
      }),
    ),
  );

  it.effect("sends the full context to a new provider conversation", () =>
    run(
      Effect.gen(function* () {
        yield* turn();
        const switched = {
          ...thread,
          activeProviderThreadId: ProviderThreadId.make("provider-thread-2"),
        };
        expect(yield* turn({ thread: switched })).toContain("Brief (user content):");
        expect(yield* turn({ thread: switched })).toBe(reminder);
      }),
    ),
  );

  it.effect("sends the full context when the starting run opens a new provider conversation", () =>
    run(
      Effect.gen(function* () {
        yield* turn();
        // The Thread's active conversation may still be the old one while the new run starts.
        const next = ProviderThreadId.make("provider-thread-2");
        expect(yield* turn({ providerThreadId: next })).toContain("Brief (user content):");
        expect(yield* turn({ providerThreadId: next })).toBe(reminder);
      }),
    ),
  );

  it.effect("sends the full context when a rewrite would cost more than rereading it", () =>
    run(
      Effect.gen(function* () {
        const brief = (word: string) =>
          Array.from({ length: 200 }, (_, line) => `${word} decision ${line}.`).join("\n");
        yield* editTicket({ markdown: brief("Old") });
        yield* turn();
        yield* editTicket({ markdown: brief("New") });
        const rewritten = yield* turn();
        expect(rewritten).toContain("Brief (user content):");
        expect(rewritten).not.toContain("since your last turn");
      }),
    ),
  );

  it.effect("diffs against a completed turn's context the reactor has not recorded yet", () =>
    run(
      Effect.gen(function* () {
        yield* turn();
        yield* editTicket({ markdown: briefY });
        expect(yield* turn()).toContain("+ Invitations expire after a day.");
        yield* editTicket({ markdown: briefX });
        expect(yield* turn()).toContain("+ Invitations expire after a week.");
      }),
    ),
  );

  it.effect("sends everything after a stopped turn that may have carried a reverted change", () =>
    run(
      Effect.gen(function* () {
        const store = yield* WorkbenchStore;
        yield* turn();
        yield* editTicket({ markdown: briefY });
        expect(yield* turn({ end: ["running", "failed"] })).toContain("a day");
        yield* editTicket({ markdown: briefX });
        expect(yield* turn()).toContain("Brief (user content):");

        yield* editTicket({ markdown: briefY });
        expect(yield* turn({ end: ["running", "interrupted"] })).toContain("a day");
        // A restart's pruning must keep the run's snapshot, or Y would look never sent.
        yield* store.pruneThreadContext;
        yield* editTicket({ markdown: briefX });
        expect(yield* turn()).toContain("Brief (user content):");
      }),
    ),
  );

  // Queue-time resolves for a later run land on the starting run too; resolve takes no run id.
  const raceRun = (id: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const sink = yield* EventSinkV2;
      const reactor = yield* TicketExecutionReactor;
      const race = { id: RunId.make(id), ordinal: 100, threadId, providerThreadId };
      yield* sql`INSERT INTO orchestration_v2_projection_messages
        (message_id, thread_id, run_id, node_id, role, streaming, created_at, updated_at, payload_json)
        VALUES (${`user-${id}`}, ${threadId}, ${race.id}, NULL, 'user', 0, ${now}, ${now},
          json_object('text', 'Continue'))`;
      yield* sink.write({ events: [runEvent({ ...race, status: "starting" })] });
      return Effect.gen(function* () {
        const [running] = yield* sink.write({ events: [runEvent({ ...race, status: "running" })] });
        yield* reactor.drainThrough(running!.sequence);
        yield* sink.write({ events: [runEvent({ ...race, status: "completed" })] });
      });
    });

  it.effect("keeps a queued run's edit for the turn after the starting one", () =>
    run(
      Effect.gen(function* () {
        const contexts = yield* TicketContextService;
        yield* turn();
        const complete = yield* raceRun("race-a");
        // Run A's turn start records the snapshot its text came from.
        expect(yield* contexts.forTurn(thread)).toEqual(Option.some(reminder));
        yield* editTicket({ markdown: "## Goal\nEdited while run A starts." });
        // Run B queues behind A; its queue-time resolve sees the edit but must not record it for A.
        const queued = yield* contexts.forTurn(thread);
        expect(Option.getOrThrow(queued)).toContain("Edited while run A starts.");
        yield* complete;
        expect(yield* turn()).toContain("Edited while run A starts.");
        expect(yield* turn()).toBe(reminder);
      }),
    ),
  );

  it.effect("sends everything after a run whose resolves disagreed", () =>
    run(
      Effect.gen(function* () {
        const contexts = yield* TicketContextService;
        yield* turn();
        yield* editTicket({ markdown: briefY });
        const complete = yield* raceRun("race-revert");
        // A queue-time resolve sees brief Y first; then the brief returns to X before A resolves.
        yield* contexts.forTurn(thread);
        yield* editTicket({ markdown: briefX, progress: "- [x] PR 1. API\n- [ ] PR 2. Web" });
        const sentToA = Option.getOrThrow(yield* contexts.forTurn(thread));
        expect(sentToA).not.toContain("a day");
        yield* complete;
        // Either text may have reached the provider, so a later diff against X could miss Y.
        expect(yield* turn()).toContain("Brief (user content):");
      }),
    ),
  );

  it.effect("prunes the records of Threads outside a Ticket at startup", () =>
    run(
      Effect.gen(function* () {
        const store = yield* WorkbenchStore;
        yield* turn();
        // The member's next run is in flight across the restart.
        yield* turn({ end: ["running"] });
        const member = yield* store.getThreadContext(threadId);
        const seen = Option.getOrThrow(member.seen);
        const orphan = ThreadId.make("context-orphan");
        yield* store.settleThreadContext({ threadId: orphan, seen: member.seen, endedRunIds: [] });
        yield* store.recordPendingThreadContext({
          ...seen,
          runId: RunId.make("orphan-run"),
          threadId: orphan,
        });
        yield* store.pruneThreadContext;
        expect(yield* store.getThreadContext(orphan)).toEqual({ seen: Option.none(), pending: [] });
        expect(yield* store.getThreadContext(threadId)).toEqual(member);
        expect(member.pending).toHaveLength(1);
      }),
    ),
  );
});

describe("Ticket Context view", () => {
  it.effect("shows the text a new Thread's first turn gets and each Thread's next turn", () =>
    run(
      Effect.gen(function* () {
        const contexts = yield* TicketContextService;
        const sibling = yield* addSibling({ id: "context-sibling", title: "Build the web page" });
        yield* turn();
        const view = yield* contexts.forTicket(ticketId);
        // Both Assignments share a creation time, so the roster orders them by Thread id.
        expect(view?.threads).toEqual([
          { threadId: sibling, state: "full", changes: 0 },
          { threadId, state: "upToDate", changes: 0 },
        ]);

        const joining = yield* addSibling({ id: "context-joining", title: "New Thread" });
        const firstTurn = yield* turn({
          thread: { id: joining, title: "New Thread", activeProviderThreadId: providerThreadId },
        });
        expect(firstTurn).toBe(view?.text);
        expect(view?.text).toContain(`thread_id=${threadId}`);
        expect(view?.text).toContain(`thread_id=${sibling}`);

        yield* editTicket({ progress: "- [x] PR 1. API\n- [x] PR 2. Web" });
        const changed = yield* contexts.forTicket(ticketId);
        expect(changed?.threads.find((row) => row.threadId === threadId)).toEqual({
          threadId,
          state: "changes",
          // Both ticks, and the Thread that joined since.
          changes: 3,
        });
      }),
    ),
  );
});

describe("lineDiff", () => {
  it("lists only changed lines and counts each replaced run once", () => {
    expect(lineDiff("a\nb\nc\nd", "a\nB\nc\nd\ne")).toEqual({
      lines: ["- b", "+ B", "+ e"],
      changes: 2,
    });
    expect(lineDiff("same", "same")).toEqual({ lines: [], changes: 0 });
    expect(lineDiff("", "- [ ] one")).toEqual({ lines: ["+ - [ ] one"], changes: 1 });
  });
});
