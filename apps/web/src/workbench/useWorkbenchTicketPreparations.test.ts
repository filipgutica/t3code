import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchTicketPreparation,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterTicketPreparationThreads,
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
  it("hides an unsaved conversation only in its owning environment", () => {
    const index = new Map([[key, preparation]]);
    expect(filterTicketPreparationThreads(threads, index)).toEqual([threads[1]]);
    expect(isUnsavedTicketPreparation(index, two, threadId)).toBe(false);
  });

  it.each(["planning", "starting"] as const)(
    "hides %s conversations until Start work succeeds",
    (phase) => {
      const index = new Map([
        [key, { ...preparation, ticketId: WorkbenchTicketId.make("saved"), phase }],
      ]);
      expect(filterTicketPreparationThreads(threads, index)).toEqual([threads[1]]);
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
    expect(filterTicketPreparationThreads(threads, index)).toEqual([threads[1]]);
    expect(isUnsavedTicketPreparation(index, one, threadId)).toBe(true);
  });

  it("reveals the same Thread when work starts", () => {
    const index = new Map([
      [
        key,
        { ...preparation, ticketId: WorkbenchTicketId.make("saved"), phase: "working" as const },
      ],
    ]);
    expect(filterTicketPreparationThreads(threads, index)).toEqual(threads);
  });

  it("leaves native lists unchanged outside Workbench or on older hosts", () => {
    expect(filterTicketPreparationThreads(threads, new Map())).toBe(threads);
  });
});
