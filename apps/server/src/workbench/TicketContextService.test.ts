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

/** Takes a run of the Thread through native start, as turn start and the reactor see it. */
const turn = (
  options: {
    readonly text?: string;
    readonly end?: "running" | "failed";
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
    yield* sink.write({ events: [runEvent({ ...run, status: "starting" })] });
    const context = yield* contexts.forTurn(current);
    const [ended] = yield* sink.write({
      events: [runEvent({ ...run, status: options.end ?? "running" })],
    });
    yield* reactor.drainThrough(ended!.sequence);
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
    markdown: "## Goal\nInvitations expire after a week.",
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
  it.effect("sends the full Ticket once, then only another Thread's changes, then nothing", () =>
    run(
      Effect.gen(function* () {
        const store = yield* WorkbenchStore;
        const first = yield* turn();
        expect(first).toContain("Brief (user content):\n## Goal\nInvitations expire after a week.");
        expect(first).toContain("Progress:\n- [ ] PR 1. API\n- [ ] PR 2. Web");
        expect(first).toContain("References:\n- Plan (/artifacts/plan.md)");
        expect(yield* turn()).toBe("");

        yield* editTicket({ markdown: "## Goal\nInvitations expire after three days." });
        const briefChange = yield* turn();
        expect(briefChange).toContain("since your last turn");
        expect(briefChange).toContain(
          "Brief:\n- Invitations expire after a week.\n+ Invitations expire after three days.",
        );
        expect(briefChange).not.toContain("Progress");
        expect(yield* turn()).toBe("");

        yield* editTicket({ progress: "- [x] PR 1. API\n- [ ] PR 2. Web" });
        expect(yield* turn()).toContain("Progress:\n- - [ ] PR 1. API\n+ - [x] PR 1. API");
        expect(yield* turn()).toBe("");

        yield* store.removeReference({ ticketId, url: "/artifacts/plan.md" });
        expect(yield* turn()).toContain("References removed:\n- Plan (/artifacts/plan.md)");
        expect(yield* turn()).toBe("");
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
        expect(yield* turn()).toBe("");

        // A sibling's edit seen only through a read is not sent again either.
        yield* editTicket({ markdown: "## Goal\nDecided: two days." });
        yield* agent.read(threadId);
        expect(yield* turn()).toBe("");
      }),
    ),
  );

  it.effect("advances nothing for a turn that fails to start or is a slash command", () =>
    run(
      Effect.gen(function* () {
        yield* turn();
        yield* editTicket({ markdown: "## Goal\nChanged while the turn failed." });
        const failed = yield* turn({ end: "failed" });
        expect(failed).toContain("Changed while the turn failed.");
        expect(yield* turn({ text: "  /review" })).toContain("Changed while the turn failed.");
        expect(yield* turn()).toContain("Changed while the turn failed.");
        expect(yield* turn()).toBe("");
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
        expect(yield* turn()).toBe("");
        yield* sql`INSERT INTO orchestration_v2_projection_turn_items
            (turn_item_id, thread_id, ordinal, type, status, updated_at, payload_json)
            VALUES ('item-done', ${threadId}, 41, ${type}, 'completed', ${now}, '{}')`;
        expect(yield* turn()).toContain("Brief (user content):");
        expect(yield* turn()).toBe("");
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
        expect(yield* turn({ thread: switched })).toBe("");
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
        expect(yield* turn({ providerThreadId: next })).toBe("");
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

  it.effect("keeps a queued run's edit for the turn after the starting one", () =>
    run(
      Effect.gen(function* () {
        const sink = yield* EventSinkV2;
        const contexts = yield* TicketContextService;
        const reactor = yield* TicketExecutionReactor;
        yield* turn();
        const runA = { id: RunId.make("race-a"), ordinal: 100, threadId, providerThreadId };
        yield* sink.write({ events: [runEvent({ ...runA, status: "starting" })] });
        // Run A's turn start records the snapshot its text came from.
        expect(yield* contexts.forTurn(thread)).toEqual(Option.none());
        yield* editTicket({ markdown: "## Goal\nEdited while run A starts." });
        // Run B queues behind A; its queue-time resolve sees the edit but must not record it for A.
        const queued = yield* contexts.forTurn(thread);
        expect(Option.getOrThrow(queued)).toContain("Edited while run A starts.");
        const [running] = yield* sink.write({ events: [runEvent({ ...runA, status: "running" })] });
        yield* reactor.drainThrough(running!.sequence);
        expect(yield* turn()).toContain("Edited while run A starts.");
        expect(yield* turn()).toBe("");
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
