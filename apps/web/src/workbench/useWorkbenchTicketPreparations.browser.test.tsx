import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchTicketPreparation,
} from "@t3tools/contracts";
import { createElement } from "react";
import { act, render } from "../../test/render";
import { Atom, AsyncResult } from "effect/reactivity";
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { filterVisibleThreads } from "../hostIntegrations";
import {
  createWorkbenchThreadPresentationPolicy,
  useWorkbenchTicketPreparations,
} from "./useWorkbenchTicketPreparations";
vi.mock("../state/presentation", () => ({
  environmentSummaries: {
    get connectedEnvironmentIdsAtom() {
      return connected;
    },
  },
}));
vi.mock("./state", () => ({
  workbenchEnvironment: { ticketPreparations: () => preparations },
}));
const connected = Atom.make([EnvironmentId.make("one")]);
const preparations = Atom.make(AsyncResult.success<ReadonlyArray<WorkbenchTicketPreparation>>([]));
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
  it("retains policy identity on an unchanged refresh and updates changed phases", async () => {
    const registry = AtomRegistry.make();
    registry.set(preparations, AsyncResult.success([preparation]));
    const observed: Array<ReturnType<typeof createWorkbenchThreadPresentationPolicy>> = [];
    function Consumer() {
      const index = useWorkbenchTicketPreparations();
      const policy = createWorkbenchThreadPresentationPolicy(index);
      observed.push(policy);
      return null;
    }
    try {
      await using screen = await render(
        createElement(RegistryContext.Provider, { value: registry }, createElement(Consumer)),
      );
      const policy = observed.at(-1);
      await act(async () => registry.set(preparations, AsyncResult.success([{ ...preparation }])));
      expect(observed.at(-1)).toBe(policy);
      await act(async () =>
        registry.set(preparations, AsyncResult.success([{ ...preparation, phase: "working" }])),
      );
      expect(observed.at(-1)).not.toBe(policy);
      expect(observed.at(-1)?.isVisible(scopeThreadRef(one, threadId))).toBe(true);
    } finally {
      registry.dispose();
    }
  });
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
    const policy = createWorkbenchThreadPresentationPolicy(index)!;
    expect(filterVisibleThreads(threads, policy)).toEqual([threads[1]]);
    expect(policy.canNotify(scopeThreadRef(two, threadId))).toBe(true);
  });
  it("leaves native lists unchanged outside Workbench or on older hosts", () => {
    expect(filterVisibleThreads(threads, createWorkbenchThreadPresentationPolicy(new Map()))).toBe(
      threads,
    );
  });
});
