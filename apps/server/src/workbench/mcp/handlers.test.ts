import { EnvironmentId, ProviderInstanceId, ThreadId, WorkbenchTicketId } from "@t3tools/contracts";
import {
  WorkbenchAgentService,
  WorkstreamNotOwnedError,
  type WorkstreamState,
} from "@t3tools/workbench/WorkbenchAgentService";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/ai";

import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as McpToolAccessTestkit from "../../mcp/McpToolAccess.testkit.ts";
import * as WorkbenchHandlers from "./handlers.ts";
import { WorkbenchToolkit } from "./tools.ts";

const THREAD_ID = ThreadId.make("thread-planner");
const OWNED: WorkstreamState = {
  kind: "draft",
  id: WorkbenchTicketId.make("draft-1"),
  revision: 3,
  phase: "draft",
  title: "Expire invitations",
  brief: "",
  progress: "- [ ] Expire links after a week",
  repositories: [],
  references: [],
  artifactsDir: "/home/user/.t3/userdata/workbench-artifacts/draft-1",
};

const threadCaller: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-1"),
  requestNamespace: "provider-session-1",
  thread: {
    threadId: THREAD_ID,
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(),
  issuedAt: 1,
};

const clientCaller: McpInvocationContext.McpInvocationScope = {
  ...threadCaller,
  thread: undefined,
  client: { sessionId: "client-1", label: "External client", access: "full-access" },
};

const makeHarness = (owned: boolean) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<readonly [string, unknown]>>([]);
    const record = (name: string, input: unknown) =>
      Ref.update(calls, (recorded) => [...recorded, [name, input] as const]);
    const requireOwned = owned ? Effect.void : Effect.fail(new WorkstreamNotOwnedError());
    const services = Layer.mergeAll(
      Layer.mock(WorkbenchAgentService)({
        read: (threadId) =>
          record("read", threadId).pipe(Effect.andThen(requireOwned), Effect.as(OWNED)),
        update: (input) =>
          record("update", input).pipe(Effect.andThen(requireOwned), Effect.as({ state: OWNED })),
        addReference: (input) =>
          record("addReference", input).pipe(
            Effect.andThen(requireOwned),
            Effect.as({
              url: input.url,
              title: null,
              kind: "jira_issue" as const,
              label: "ORBIT-1",
            }),
          ),
        updateReference: (input) =>
          record("updateReference", input).pipe(
            Effect.andThen(requireOwned),
            Effect.as({
              url: input.url,
              title: input.title,
              kind: "jira_issue" as const,
              label: "ORBIT-1",
            }),
          ),
        removeReference: (input) =>
          record("removeReference", input).pipe(Effect.andThen(requireOwned)),
      }),
      McpToolAccessTestkit.liveThreadsLayer,
    );
    const toolkit = yield* WorkbenchToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(WorkbenchHandlers.layer).pipe(Layer.provide(services)),
      ),
    );
    const call = <Name extends keyof typeof WorkbenchToolkit.tools>(
      name: Name,
      params: Parameters<typeof toolkit.handle<Name>>[1],
      scope: McpInvocationContext.McpInvocationScope = threadCaller,
    ) =>
      toolkit.handle(name, params).pipe(
        Stream.unwrap,
        Stream.runCollect,
        Effect.map(
          (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof WorkbenchToolkit.tools)[Name]>,
        ),
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provide(services),
      );
    return { call, calls };
  });

describe("Workbench toolkit handlers", () => {
  it.effect("acts on the calling Thread's own Ticket", () =>
    Effect.gen(function* () {
      const { call, calls } = yield* makeHarness(true);
      const url = "https://acme.atlassian.net/browse/ORBIT-1";

      expect(yield* call("workbench_ticket_read", {})).toEqual(OWNED);
      expect(
        yield* call("workbench_ticket_update", {
          expectedRevision: 3,
          title: "Expire links",
          progress: "- [x] Expire links after a week",
        }),
      ).toEqual({ state: OWNED });
      expect(yield* call("workbench_reference_add", { url, title: "Expire invitations" })).toEqual({
        url,
        title: null,
        kind: "jira_issue",
        label: "ORBIT-1",
      });
      expect(yield* call("workbench_reference_update", { url, title: "Approved spec" })).toEqual({
        url,
        title: "Approved spec",
        kind: "jira_issue",
        label: "ORBIT-1",
      });
      expect(yield* call("workbench_reference_remove", { url })).toEqual({});
      expect(yield* Ref.get(calls)).toEqual([
        ["read", THREAD_ID],
        [
          "update",
          {
            expectedRevision: 3,
            title: "Expire links",
            progress: "- [x] Expire links after a week",
            threadId: THREAD_ID,
          },
        ],
        ["addReference", { url, title: "Expire invitations", threadId: THREAD_ID }],
        ["updateReference", { url, title: "Approved spec", threadId: THREAD_ID }],
        ["removeReference", { url, threadId: THREAD_ID }],
      ]);
    }),
  );

  it.effect("reports a Thread that belongs to no Ticket", () =>
    Effect.gen(function* () {
      const { call } = yield* makeHarness(false);
      const error = yield* call("workbench_reference_add", {
        url: "https://github.com/acme/app/issues/1",
      }).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "WorkstreamNotOwnedError" });
      expect(error.message).toBe("This Thread does not belong to a Ticket");
    }),
  );

  it.effect("refuses a caller outside a T3 Thread before reading or writing", () =>
    Effect.gen(function* () {
      const { call, calls } = yield* makeHarness(true);
      const refused = {
        _tag: "OrchestratorMcpFailure",
        code: "thread_credential_required",
      };
      expect(yield* Effect.flip(call("workbench_ticket_read", {}, clientCaller))).toMatchObject(
        refused,
      );
      expect(
        yield* Effect.flip(call("workbench_ticket_update", { expectedRevision: 3 }, clientCaller)),
      ).toMatchObject(refused);
      expect(yield* Ref.get(calls)).toEqual([]);
    }),
  );
});
