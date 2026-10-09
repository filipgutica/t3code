import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { makeThreadFixture } from "../test-fixtures";
import {
  getWorkbenchThreadExecutionStatus,
  getWorkbenchTicketExecutionStatuses,
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
      presentation: { label: "Waiting", icon: null },
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
    expect(summarize([input, working])?.presentation.label).toBe("Input");
    expect(summarize([working, failed])?.presentation.label).toBe("Failed");
    expect(summarize([working, waiting])?.presentation.label).toBe("Working");
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
