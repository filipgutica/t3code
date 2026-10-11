import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchTicketPreparation,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { filterVisibleThreads } from "../hostIntegrations";

import {
  createWorkbenchThreadPresentationPolicy,
  isUnsavedTicketPreparation,
} from "./useWorkbenchTicketPreparations";

const one = EnvironmentId.make("one");
const two = EnvironmentId.make("two");
const threadId = ThreadId.make("same-id");
const key = scopedThreadKey(scopeThreadRef(one, threadId));
const preparation: WorkbenchTicketPreparation = {
  threadId,
  projectId: WorkbenchProjectId.make("workspace"),
  ticketId: null,
  phase: "draft",
};
const threads = [
  { environmentId: one, id: threadId },
  { environmentId: two, id: threadId },
];

describe("Workbench preparation visibility", () => {
  it.each([
    ["creating", false, false],
    ["draft", false, false],
    ["promoting", false, false],
    ["discarding", false, false],
    ["planning", false, true],
    ["starting", false, true],
    ["working", true, true],
  ] as const)(
    "keeps saved %s list visibility and notifications distinct",
    (phase, visible, notify) => {
      const policy = createWorkbenchThreadPresentationPolicy(
        new Map([[key, { ...preparation, ticketId: WorkbenchTicketId.make("saved"), phase }]]),
      )!;
      expect(policy.isVisible(scopeThreadRef(one, threadId))).toBe(visible);
      expect(policy.canNotify(scopeThreadRef(one, threadId))).toBe(notify);
      expect(policy.isVisible(scopeThreadRef(two, threadId))).toBe(true);
      expect(policy.canNotify(scopeThreadRef(two, threadId))).toBe(true);
    },
  );

  it.each([
    "creating",
    "draft",
    "promoting",
    "discarding",
    "planning",
    "starting",
    "working",
  ] as const)("never notifies an unsaved %s preparation", (phase) => {
    const policy = createWorkbenchThreadPresentationPolicy(
      new Map([[key, { ...preparation, phase }]]),
    )!;
    expect(policy.canNotify(scopeThreadRef(one, threadId))).toBe(false);
  });
  it("hides an unsaved conversation only in its owning environment", () => {
    const index = new Map([[key, preparation]]);
    expect(filterVisibleThreads(threads, createWorkbenchThreadPresentationPolicy(index))).toEqual([
      threads[1],
    ]);
    expect(isUnsavedTicketPreparation(index, two, threadId)).toBe(false);
  });

  it.each(["planning", "starting"] as const)(
    "hides %s conversations until Start work succeeds",
    (phase) => {
      const index = new Map([
        [key, { ...preparation, ticketId: WorkbenchTicketId.make("saved"), phase }],
      ]);
      expect(filterVisibleThreads(threads, createWorkbenchThreadPresentationPolicy(index))).toEqual(
        [threads[1]],
      );
      expect(isUnsavedTicketPreparation(index, one, threadId)).toBe(false);
    },
  );

  it("hides a partial creation until promotion finishes, even when the ticket exists", () => {
    const index = new Map([
      [
        key,
        { ...preparation, ticketId: WorkbenchTicketId.make("saved"), phase: "promoting" as const },
      ],
    ]);
    expect(filterVisibleThreads(threads, createWorkbenchThreadPresentationPolicy(index))).toEqual([
      threads[1],
    ]);
    expect(isUnsavedTicketPreparation(index, one, threadId)).toBe(true);
  });

  it("reveals the same Thread when work starts", () => {
    const index = new Map([
      [
        key,
        { ...preparation, ticketId: WorkbenchTicketId.make("saved"), phase: "working" as const },
      ],
    ]);
    expect(filterVisibleThreads(threads, createWorkbenchThreadPresentationPolicy(index))).toEqual(
      threads,
    );
  });

  it("leaves native lists unchanged outside Workbench or on older hosts", () => {
    expect(filterVisibleThreads(threads, createWorkbenchThreadPresentationPolicy(new Map()))).toBe(
      threads,
    );
  });
});
