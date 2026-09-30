import { expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchAssignment,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { WorkbenchAttentionSignal } from "./workbenchAttention.logic";
import type {
  WorkbenchSidebarTicket,
  WorkbenchSidebarTicketSections,
} from "./workbenchSidebar.logic";
import {
  getWorkbenchSidebarActionableThreadIds,
  prioritizeWorkbenchSidebarAttention,
} from "./workbenchSidebarAttention.logic";

const environmentId = EnvironmentId.make("sidebar-attention");
const workspaceId = WorkbenchProjectId.make("workspace");
const ticketId = WorkbenchTicketId.make("actionable");
const reference = {
  projectId: ProjectId.make("repo"),
  repository: "acme/web",
  number: 7,
  url: "https://github.com/acme/web/pull/7",
};
const thread = (id: string): EnvironmentThreadShell => ({
  id: ThreadId.make(id),
  environmentId,
  projectId: ProjectId.make("repo"),
  title: id,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
  latestTurn: null,
  session: null,
  pullRequests: [],
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
});
const sharedOne = { ...thread("shared-one"), linkedPullRequest: reference };
const sharedTwo = {
  ...thread("shared-two"),
  linkedPullRequest: { ...reference, repository: "ACME/WEB" },
};
const waiting = { ...thread("waiting"), hasPendingUserInput: true };
const newestClean = {
  ...thread("newest-clean"),
  linkedPullRequest: { ...reference, number: 8, url: "https://github.com/acme/web/pull/8" },
};
const excluded = [
  { ...sharedOne, id: ThreadId.make("settled"), settledOverride: "settled" as const },
  { ...sharedOne, id: ThreadId.make("superseded") },
  { ...sharedOne, id: ThreadId.make("foreign"), environmentId: EnvironmentId.make("other") },
  { ...sharedOne, id: ThreadId.make("archived"), archivedAt: "2026-09-30T00:00:00.000Z" },
  { ...thread("branch-only"), branchPullRequest: reference },
];
const assignmentThreads = [newestClean, sharedTwo, waiting, sharedOne, ...excluded];
const threads = [
  ...assignmentThreads,
  {
    ...newestClean,
    id: sharedOne.id,
    title: "Foreign Thread with the same ID",
    environmentId: EnvironmentId.make("other"),
  },
];
const assignments: WorkbenchAssignment[] = assignmentThreads.map((row) => ({
  id: WorkbenchAssignmentId.make(row.id),
  ticketId,
  threadId: row.id,
  createdAt: "2026-09-30T00:00:00.000Z",
  supersededAt: row.id === "superseded" ? "2026-09-30T00:00:00.000Z" : null,
}));
const signals: WorkbenchAttentionSignal[] = [
  {
    kind: "failed-checks",
    source: {
      type: "pull-request",
      row: { threadId: sharedOne.id, threadTitle: sharedOne.title, pullRequest: reference },
    },
    unresolvedReviewThreads: [],
  },
  { kind: "waiting", source: { type: "thread", threadId: waiting.id, threadTitle: waiting.title } },
];
const attentionSignalsByTicket = new Map([[ticketId, signals]]);
const actionableThreadIdsByTicket = () =>
  getWorkbenchSidebarActionableThreadIds({
    environmentId,
    assignments,
    threads,
    attentionSignalsByTicket,
  });

it("retains every eligible Thread sharing an actionable PR, plus its independent waiting Thread", () => {
  expect([...(actionableThreadIdsByTicket().get(ticketId) ?? [])]).toEqual([
    sharedTwo.id,
    waiting.id,
    sharedOne.id,
  ]);
  expect(
    getWorkbenchSidebarActionableThreadIds({
      environmentId: null,
      assignments,
      threads,
      attentionSignalsByTicket,
    }).size,
  ).toBe(0);
  expect(
    getWorkbenchSidebarActionableThreadIds({
      environmentId,
      assignments,
      threads,
      attentionSignalsByTicket: new Map(),
    }).size,
  ).toBe(0);
});

const ticket = (
  id: string,
  status: WorkbenchSidebarTicket["status"] = "in_progress",
): WorkbenchSidebarTicket => ({
  id: WorkbenchTicketId.make(id),
  projectId: workspaceId,
  title: id,
  status,
  archivedAt: null,
});
it.each([false, true])(
  "stably prioritizes confirmed work and promotes Done once without changing status (attention-only=%s)",
  (onlyActionable) => {
    const action = ticket("actionable");
    const second = ticket("second");
    const doneAction = ticket("done-action", "done");
    const secondThread = { ...thread("second-waiting"), hasPendingUserInput: true };
    const doneThread = thread("done-review");
    const selectedArchived = { ...ticket("archived"), archivedAt: "2026-09-30T00:00:00.000Z" };
    const sections: WorkbenchSidebarTicketSections = {
      active: [
        { ticket: ticket("newest-clean"), threads: [] },
        { ticket: action, threads: [newestClean, sharedTwo, waiting, sharedOne, excluded[0]!] },
        { ticket: ticket("older-clean"), threads: [] },
        { ticket: second, threads: [secondThread] },
        { ticket: selectedArchived, threads: [waiting] },
      ],
      done: [
        { ticket: ticket("done-clean", "done"), threads: [] },
        { ticket: doneAction, threads: [doneThread] },
      ],
    };
    const original = structuredClone(sections);
    const groupSignals = new Map(attentionSignalsByTicket)
      .set(second.id, [
        {
          kind: "waiting",
          source: { type: "thread", threadId: secondThread.id, threadTitle: secondThread.title },
        },
      ])
      .set(doneAction.id, [
        {
          kind: "review-ready",
          source: { type: "thread", threadId: doneThread.id, threadTitle: doneThread.title },
        },
      ])
      .set(selectedArchived.id, [signals[1]!]);
    const result = prioritizeWorkbenchSidebarAttention({
      ticketGroupsByWorkspace: new Map([[workspaceId, sections]]),
      attentionSignalsByTicket: groupSignals,
      actionableThreadIdsByTicket: new Map(actionableThreadIdsByTicket())
        .set(second.id, new Set([secondThread.id]))
        .set(doneAction.id, new Set([doneThread.id])),
      onlyActionable,
    }).get(workspaceId)!;
    expect(result.active.map((group) => group.ticket.id)).toEqual(
      onlyActionable
        ? [action.id, second.id, doneAction.id]
        : [
            action.id,
            second.id,
            doneAction.id,
            WorkbenchTicketId.make("newest-clean"),
            WorkbenchTicketId.make("older-clean"),
            selectedArchived.id,
          ],
    );
    expect(result.active[0]?.threads.map((row) => row.id)).toEqual(
      onlyActionable
        ? [sharedTwo.id, waiting.id, sharedOne.id]
        : [sharedTwo.id, waiting.id, sharedOne.id, newestClean.id, excluded[0]!.id],
    );
    expect(result.active[2]?.ticket.status).toBe("done");
    expect(result.done.map((group) => group.ticket.id)).toEqual(
      onlyActionable ? [] : [WorkbenchTicketId.make("done-clean")],
    );
    expect(sections).toEqual(original);
  },
);
