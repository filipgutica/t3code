import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { makeThreadFixture } from "../test-fixtures";
import {
  getWorkbenchThreadExecutionStatus,
  getWorkbenchTicketExecutionStatuses,
  hasWorkbenchUnreadReply,
  sortWorkbenchTicketThreads,
} from "./workbenchThreadStatus.logic";

const environmentId = EnvironmentId.make("local");
const ticketId = WorkbenchTicketId.make("ticket");
const runtime = {
  status: "running" as const,
  activeRunId: RunId.make("run"),
  activityStartedAt: "2026-10-09T10:00:00.000Z",
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerName: "Codex",
  lastError: null,
  updatedAt: "2026-10-09T10:00:30.000Z",
};
const working = makeThreadFixture({ id: ThreadId.make("working"), environmentId, runtime });
const waiting = makeThreadFixture({
  id: ThreadId.make("waiting"),
  environmentId,
  runtime: { ...runtime, status: "idle", activeRunId: null },
});

function summarize(threads: (typeof working)[]) {
  return getWorkbenchTicketExecutionStatuses({
    environmentId,
    assignments: threads.map(({ id }) => ({ ticketId, threadId: id, supersededAt: null })),
    threadsById: new Map(threads.map((thread) => [thread.id, thread])),
  }).get(ticketId);
}

describe("Workbench native execution indicators", () => {
  it("replaces progress with native approval or input indicators without retaining its timer", () => {
    expect(getWorkbenchThreadExecutionStatus(working)).toMatchObject({
      presentation: { label: "Working", icon: "working" },
      startedAt: runtime.activityStartedAt,
    });
    expect(
      getWorkbenchThreadExecutionStatus({
        ...working,
        goal: { status: "active", objective: "Complete this task" },
      }),
    ).toMatchObject({ presentation: { label: "Goal" }, startedAt: runtime.activityStartedAt });
    const input = { ...working, hasPendingUserInput: true };
    expect(getWorkbenchThreadExecutionStatus(input)).toMatchObject({
      presentation: { label: "Input", icon: "input" },
      startedAt: null,
    });
    expect(
      getWorkbenchThreadExecutionStatus({ ...input, hasPendingApprovals: true }),
    ).toMatchObject({
      presentation: { label: "Approval", icon: "approval" },
      startedAt: null,
    });
  });

  it("keeps background waiting and usage limits distinct from progress or ready notifications", () => {
    expect(getWorkbenchThreadExecutionStatus(waiting)).toMatchObject({
      presentation: { label: "Waiting", icon: "waiting" },
      startedAt: null,
    });
    expect(
      getWorkbenchThreadExecutionStatus({
        ...working,
        runtime: { ...runtime, status: "failed", lastErrorClass: "usage_limit" },
      }),
    ).toMatchObject({ presentation: { label: "Limited" }, startedAt: null });
    expect(getWorkbenchThreadExecutionStatus({ ...working, runtime: null })).toBeNull();
  });

  it("surfaces requests and failures ahead of concurrent work independent of assignment order", () => {
    const input = { ...waiting, hasPendingUserInput: true };
    const failed = makeThreadFixture({
      id: ThreadId.make("failed"),
      environmentId,
      runtime: { ...runtime, status: "failed", lastError: "Provider disconnected" },
    });
    expect(summarize([working, input])?.presentation.label).toBe("Input");
    expect(summarize([working, input])?.threadId).toBe(input.id);
    expect(summarize([input, working])?.presentation.label).toBe("Input");
    expect(summarize([working, failed])?.presentation.label).toBe("Failed");
    expect(summarize([working, waiting])?.presentation.label).toBe("Working");
    // Like a closed native folder: usage limits need the user before failures, Waiting stays quiet.
    const limited = {
      ...failed,
      id: ThreadId.make("limited"),
      runtime: { ...runtime, status: "failed" as const, lastErrorClass: "usage_limit" as const },
    };
    expect(summarize([failed, limited])?.presentation.label).toBe("Limited");
    expect(summarize([waiting])).toBeUndefined();
    const request = { ...waiting, id: ThreadId.make("request"), pendingGuestMessageCount: 1 };
    expect(getWorkbenchThreadExecutionStatus(request)).toMatchObject({
      presentation: { label: "Request", icon: "request" },
      startedAt: null,
    });
    expect(summarize([failed, request])?.presentation.label).toBe("Request");
    expect(summarize([request, failed])?.presentation.label).toBe("Request");
    expect(summarize([request, input])?.presentation.label).toBe("Input");
    expect(
      summarize([working, input, failed, { ...waiting, hasPendingApprovals: true }])?.presentation
        .label,
    ).toBe("Approval");
  });

  it("uses the oldest active work start consistently, including a continued background wake", () => {
    const continued = makeThreadFixture({
      id: ThreadId.make("continued"),
      environmentId,
      latestRun: {
        runId: RunId.make("completed-run"),
        status: "completed",
        requestedAt: "2026-10-09T09:00:00.000Z",
        startedAt: "2026-10-09T09:00:05.000Z",
        completedAt: "2026-10-09T09:30:00.000Z",
        assistantMessageId: null,
      },
      runtime: { ...runtime, activityStartedAt: "2026-10-09T09:00:05.000Z" },
    });
    expect(summarize([working, continued])?.startedAt).toBe("2026-10-09T09:00:05.000Z");
    expect(summarize([continued, working])?.startedAt).toBe("2026-10-09T09:00:05.000Z");
    expect(summarize([working, continued])?.threadId).toBe(continued.id);
    expect(
      getWorkbenchThreadExecutionStatus({
        ...continued,
        runtime: { ...runtime, activityStartedAt: "malformed" },
      })?.startedAt,
    ).toBeNull();
  });

  it("excludes replaced, archived, missing, and foreign-environment Threads from Ticket execution", () => {
    const history = { ...waiting, hasPendingApprovals: true };
    const archived = {
      ...history,
      id: ThreadId.make("archived"),
      archivedAt: "2026-10-08T10:00:00.000Z",
    };
    const foreign = {
      ...history,
      id: ThreadId.make("foreign"),
      environmentId: EnvironmentId.make("remote"),
    };
    const threads = [working, history, archived, foreign];
    const inputs = {
      environmentId,
      assignments: [
        ...threads.map(({ id }) => ({
          ticketId,
          threadId: id,
          supersededAt: id === history.id ? "2026-10-08T10:00:00.000Z" : null,
        })),
        { ticketId, threadId: ThreadId.make("missing"), supersededAt: null },
      ],
      threadsById: new Map(threads.map((thread) => [thread.id, thread])),
    };
    expect(getWorkbenchTicketExecutionStatuses(inputs).get(ticketId)?.presentation.label).toBe(
      "Working",
    );
    expect(getWorkbenchTicketExecutionStatuses({ ...inputs, environmentId: null }).size).toBe(0);
    expect(
      getWorkbenchTicketExecutionStatuses({ ...inputs, assignments: inputs.assignments.slice(1) })
        .size,
    ).toBe(0);
  });
});

describe("sortWorkbenchTicketThreads", () => {
  it("orders a Ticket's Threads like a native folder: needs you, failed, unread, working, waiting", () => {
    const entry = (thread: typeof working) => ({
      threadId: thread.id,
      status: getWorkbenchThreadExecutionStatus(thread),
    });
    const replied = makeThreadFixture({ id: ThreadId.make("replied"), environmentId });
    const idle = makeThreadFixture({ id: ThreadId.make("idle"), environmentId });
    const failed = makeThreadFixture({
      id: ThreadId.make("failed"),
      environmentId,
      runtime: { ...runtime, status: "failed", lastError: "Provider disconnected" },
    });
    const input = { ...waiting, id: ThreadId.make("input"), hasPendingUserInput: true };
    const sorted = sortWorkbenchTicketThreads(
      [idle, waiting, working, replied, failed, input].map(entry),
      new Set([replied.id, working.id]),
    );
    expect(sorted.map(({ threadId }) => threadId)).toEqual([
      input.id,
      failed.id,
      replied.id,
      working.id,
      waiting.id,
      idle.id,
    ]);
  });
});

describe("hasWorkbenchUnreadReply", () => {
  const replied = makeThreadFixture({
    id: ThreadId.make("replied"),
    environmentId,
    latestRun: {
      runId: RunId.make("run"),
      status: "completed",
      assistantMessageId: null,
      requestedAt: "2026-10-09T10:00:00.000Z",
      startedAt: "2026-10-09T10:00:00.000Z",
      completedAt: "2026-10-09T10:05:00.000Z",
    },
    lastVisitedAt: "2026-10-09T10:01:00.000Z",
  });
  const localVisit = {
    [scopedThreadKey(scopeThreadRef(environmentId, replied.id))]: "2026-10-09T10:06:00.000Z",
  };

  it("counts a reply finished after the last visit until a later visit reads it", () => {
    expect(hasWorkbenchUnreadReply(replied, {})).toBe(true);
    expect(
      hasWorkbenchUnreadReply({ ...replied, lastVisitedAt: "2026-10-09T10:06:00.000Z" }, {}),
    ).toBe(false);
  });

  it("reads the local visit only when the server records none, as the native sidebar does", () => {
    const { lastVisitedAt: _serverVisit, ...olderServer } = replied;
    expect(hasWorkbenchUnreadReply(replied, localVisit)).toBe(true);
    expect(hasWorkbenchUnreadReply(olderServer, localVisit)).toBe(false);
  });
});
