import { makeThreadFixture } from "../test-fixtures";
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
const thread = (id: string): EnvironmentThreadShell =>
  makeThreadFixture({
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
    latestRun: null,
    runtime: null,
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
  {
    kind: "question",
    source: { type: "thread", threadId: waiting.id, threadTitle: waiting.title },
  },
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
  const ticketThreads = actionableThreadIdsByTicket().get(ticketId);
  expect([...(ticketThreads?.keys() ?? [])]).toEqual([sharedTwo.id, waiting.id, sharedOne.id]);
  expect(ticketThreads?.get(sharedTwo.id)).toBe(signals[0]);
  expect(ticketThreads?.get(sharedOne.id)).toBe(signals[0]);
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
  "orders by urgency only under the attention filter and promotes Done once without changing status (attention-only=%s)",
  (onlyActionable) => {
    const action = ticket("actionable");
    const second = ticket("second");
    const doneAction = ticket("done-action", "done");
    const tiedAction = ticket("tied-action");
    const tiedWaiting = { ...thread("tied-waiting"), hasPendingUserInput: true };
    const secondThread = { ...thread("second-waiting"), hasPendingUserInput: true };
    const doneThread = thread("done-review");
    const selectedArchived = { ...ticket("archived"), archivedAt: "2026-09-30T00:00:00.000Z" };
    const sections: WorkbenchSidebarTicketSections = {
      active: [
        { ticket: ticket("newest-clean"), threads: [] },
        {
          ticket: action,
          threads: [newestClean, sharedTwo, waiting, tiedWaiting, sharedOne, excluded[0]!],
        },
        { ticket: ticket("older-clean"), threads: [] },
        { ticket: second, threads: [secondThread] },
        { ticket: tiedAction, threads: [secondThread] },
        { ticket: selectedArchived, threads: [waiting] },
      ],
      done: [
        { ticket: ticket("done-clean", "done"), threads: [] },
        { ticket: doneAction, threads: [doneThread] },
      ],
    };
    const original = structuredClone(sections);
    const groupSignals = new Map(attentionSignalsByTicket)
      .set(action.id, [
        ...signals,
        {
          kind: "question",
          source: { type: "thread", threadId: tiedWaiting.id, threadTitle: tiedWaiting.title },
        },
      ])
      .set(tiedAction.id, [
        {
          kind: "waiting",
          cause: "approval",
          source: { type: "thread", threadId: secondThread.id, threadTitle: secondThread.title },
        },
      ])
      .set(second.id, [
        {
          kind: "waiting",
          cause: "approval",
          source: { type: "thread", threadId: secondThread.id, threadTitle: secondThread.title },
        },
      ])
      .set(doneAction.id, [
        {
          kind: "reply",
          source: { type: "thread", threadId: doneThread.id, threadTitle: doneThread.title },
        },
      ])
      .set(selectedArchived.id, [signals[1]!]);
    const result = prioritizeWorkbenchSidebarAttention({
      ticketGroupsByWorkspace: new Map([[workspaceId, sections]]),
      attentionSignalsByTicket: groupSignals,
      actionableThreadIdsByTicket: new Map(actionableThreadIdsByTicket())
        .set(
          action.id,
          new Map([
            [sharedTwo.id, signals[0]!],
            [waiting.id, signals[1]!],
            [tiedWaiting.id, groupSignals.get(action.id)!.at(-1)!],
            [sharedOne.id, signals[0]!],
          ]),
        )
        .set(tiedAction.id, new Map([[secondThread.id, groupSignals.get(tiedAction.id)![0]!]]))
        .set(second.id, new Map([[secondThread.id, groupSignals.get(second.id)![0]!]]))
        .set(doneAction.id, new Map([[doneThread.id, groupSignals.get(doneAction.id)![0]!]])),
      onlyActionable,
    }).get(workspaceId)!;
    expect(result.active.map((group) => group.ticket.id)).toEqual(
      onlyActionable
        ? [second.id, tiedAction.id, action.id, doneAction.id]
        : [
            WorkbenchTicketId.make("newest-clean"),
            action.id,
            WorkbenchTicketId.make("older-clean"),
            second.id,
            tiedAction.id,
            selectedArchived.id,
            doneAction.id,
          ],
    );
    expect(
      result.active.find((group) => group.ticket.id === action.id)?.threads.map((row) => row.id),
    ).toEqual(
      onlyActionable
        ? [waiting.id, tiedWaiting.id, sharedTwo.id, sharedOne.id]
        : [newestClean.id, sharedTwo.id, waiting.id, tiedWaiting.id, sharedOne.id, excluded[0]!.id],
    );
    expect(result.active.at(-1)?.ticket.status).toBe("done");
    expect(result.done.map((group) => group.ticket.id)).toEqual(
      onlyActionable ? [] : [WorkbenchTicketId.make("done-clean")],
    );
    expect(sections).toEqual(original);
  },
);
