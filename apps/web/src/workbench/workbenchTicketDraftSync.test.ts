import type { WorkbenchTicketDraftFields } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import type { WorkbenchConversationDraft } from "./workbenchTicketDraft.logic";
import { DRAFT_CONFLICT_MESSAGE, createTicketDraftFieldSync } from "./workbenchTicketDraftSync";

const fieldsWith = (
  patch: Partial<WorkbenchTicketDraftFields> = {},
): WorkbenchTicketDraftFields => ({
  title: "",
  markdown: "",
  kind: "story",
  epicId: null,
  repositoryProjectIds: [],
  primaryT3ProjectId: null,
  localOnly: false,
  jiraSprintId: null,
  ...patch,
});
const draftAt = (
  revision: number,
  patch: Partial<WorkbenchTicketDraftFields> = {},
): WorkbenchConversationDraft =>
  ({ revision, phase: "draft", fields: fieldsWith(patch) }) as WorkbenchConversationDraft;

type SaveInput = { expectedRevision: number; fields: WorkbenchTicketDraftFields };

/** Saves that succeed with the next revision and record what was sent. */
const acceptingSync = (initial: WorkbenchConversationDraft) => {
  const sent: SaveInput[] = [];
  const sync = createTicketDraftFieldSync({
    initial,
    save: async (input) => {
      sent.push(input);
      return {
        ok: true,
        draft: { ...initial, revision: input.expectedRevision + 1, fields: input.fields },
      };
    },
  });
  return { sync, sent };
};

type SaveResult = Awaited<ReturnType<Parameters<typeof createTicketDraftFieldSync>[0]["save"]>>;

/** Saves that stay open until the test answers them, to place a snapshot mid-save. */
const manualSync = (initial: WorkbenchConversationDraft) => {
  const sent: SaveInput[] = [];
  const answers: Array<(result: SaveResult) => void> = [];
  const sync = createTicketDraftFieldSync({
    initial,
    save: (input) =>
      new Promise((resolve) => {
        sent.push(input);
        answers.push(resolve);
      }),
  });
  return { sync, sent, answer: (index: number, result: SaveResult) => answers[index]!(result) };
};

describe("createTicketDraftFieldSync", () => {
  it("threads each returned revision into the next save", async () => {
    const { sync, sent } = acceptingSync(draftAt(3));
    sync.edit({ title: "one" });
    await sync.flush();
    sync.edit({ title: "two" });
    await sync.flush();
    expect(sent.map((save) => save.expectedRevision)).toEqual([3, 4]);
    expect(sync.revision()).toBe(5);
  });

  it("serializes overlapping flushes and sends the newest edit with every earlier change", async () => {
    const { sync, sent, answer } = manualSync(draftAt(0));
    sync.edit({ title: "a" });
    const first = sync.flush();
    await Promise.resolve();
    sync.edit({ markdown: "b" });
    sync.edit({ title: "c" });
    const second = sync.flush();
    // The second save cannot start until the first returns its revision.
    expect(sent).toHaveLength(1);
    answer(0, { ok: true, draft: draftAt(1) });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({
      expectedRevision: 1,
      fields: fieldsWith({ title: "c", markdown: "b" }),
    });
    answer(1, { ok: true, draft: draftAt(2) });
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    expect(sync.hasPendingEdits()).toBe(false);
  });

  it("flushes nothing when there are no edits", async () => {
    const { sync, sent } = acceptingSync(draftAt(0));
    expect(await sync.flush()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  describe("a newer saved draft with nothing unsaved", () => {
    it("is adopted into the fields, so the next local edit keeps it", async () => {
      const { sync, sent } = acceptingSync(draftAt(1, { markdown: "old" }));
      sync.adopt(draftAt(2, { markdown: "written elsewhere" }));
      expect(sync.getSnapshot().fields.markdown).toBe("written elsewhere");
      expect(sync.getSnapshot().conflict).toBeNull();
      sync.edit({ title: "mine" });
      await sync.flush();
      // The data-loss case: the title edit must not write the old description back.
      expect(sent).toEqual([
        {
          expectedRevision: 2,
          fields: fieldsWith({ title: "mine", markdown: "written elsewhere" }),
        },
      ]);
    });

    it("ignores a draft that is not newer", () => {
      const { sync } = acceptingSync(draftAt(4, { title: "kept" }));
      sync.adopt(draftAt(4, { title: "same revision" }));
      sync.adopt(draftAt(2, { title: "older" }));
      expect(sync.getSnapshot().fields.title).toBe("kept");
      expect(sync.revision()).toBe(4);
    });

    it("notifies subscribers so the form shows the adopted fields", () => {
      const { sync } = acceptingSync(draftAt(1));
      const listener = vi.fn();
      const unsubscribe = sync.subscribe(listener);
      sync.adopt(draftAt(2, { title: "remote" }));
      expect(listener).toHaveBeenCalledOnce();
      unsubscribe();
      sync.adopt(draftAt(3, { title: "later" }));
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe("a newer saved draft while edits are unsaved", () => {
    it("keeps the edits, reports a conflict, and never saves over the remote write", async () => {
      const { sync, sent } = acceptingSync(draftAt(1));
      sync.edit({ title: "mine" });
      sync.adopt(draftAt(2, { markdown: "remote" }));
      expect(sync.getSnapshot().fields.title).toBe("mine");
      expect(sync.getSnapshot().conflict?.revision).toBe(2);
      expect(await sync.flush()).toEqual({ ok: false, message: DRAFT_CONFLICT_MESSAGE });
      expect(sent).toHaveLength(0);
      expect(sync.hasPendingEdits()).toBe(true);
    });

    it("reload takes the saved draft and drops the edits", async () => {
      const { sync, sent } = acceptingSync(draftAt(1));
      sync.edit({ title: "mine" });
      sync.adopt(draftAt(2, { title: "theirs", markdown: "remote" }));
      sync.reload();
      expect(sync.getSnapshot()).toEqual({
        fields: fieldsWith({ title: "theirs", markdown: "remote" }),
        conflict: null,
      });
      expect(sync.hasPendingEdits()).toBe(false);
      expect(sync.revision()).toBe(2);
      expect(await sync.flush()).toEqual({ ok: true });
      expect(sent).toHaveLength(0);
    });

    it("keeping my edits saves them against the saved draft's revision", async () => {
      const { sync, sent } = acceptingSync(draftAt(1));
      sync.edit({ title: "mine" });
      sync.adopt(draftAt(5, { title: "theirs" }));
      sync.keepMine();
      expect(sync.getSnapshot().conflict).toBeNull();
      expect(await sync.flush()).toEqual({ ok: true });
      expect(sent).toEqual([{ expectedRevision: 5, fields: fieldsWith({ title: "mine" }) }]);
    });

    it("tracks the newest saved draft and names its revision for a discard", () => {
      const { sync } = acceptingSync(draftAt(1));
      sync.edit({ title: "mine" });
      sync.adopt(draftAt(2));
      sync.adopt(draftAt(4, { title: "newest" }));
      sync.adopt(draftAt(3));
      expect(sync.getSnapshot().conflict?.fields.title).toBe("newest");
      expect(sync.latestRevision()).toBe(4);
    });

    it.each(["promoting", "planning"] as const)(
      "keeps unsaved edits available to copy when the remote draft is already %s",
      async (phase) => {
        const { sync, sent } = acceptingSync(draftAt(1));
        sync.edit({ title: "mine" });
        sync.adopt({ ...draftAt(2, { title: "created elsewhere" }), phase });
        sync.keepMine();
        expect(sync.getSnapshot().fields.title).toBe("mine");
        expect(sync.getSnapshot().conflict?.phase).toBe(phase);
        expect(await sync.flush()).toEqual({ ok: false, message: DRAFT_CONFLICT_MESSAGE });
        expect(sent).toHaveLength(0);
        sync.reload();
        expect(await sync.flush()).toEqual({ ok: true });
        expect(sync.getSnapshot().fields.title).toBe("created elsewhere");
      },
    );
  });

  describe("a save that is in flight", () => {
    it("does not read its own snapshot echo as a conflict", async () => {
      const { sync, sent, answer } = manualSync(draftAt(1));
      sync.edit({ title: "mine " });
      const flushed = sync.flush();
      await Promise.resolve();
      expect(sync.hasPendingEdits()).toBe(true);
      // The snapshot carries the server's trimmed copy before the command reply arrives.
      sync.adopt(draftAt(2, { title: "mine" }));
      answer(0, { ok: true, draft: draftAt(2, { title: "mine" }) });
      expect(await flushed).toEqual({ ok: true });
      expect(sync.hasPendingEdits()).toBe(false);
      expect(sync.getSnapshot().conflict).toBeNull();
      expect(sync.getSnapshot().fields.title).toBe("mine ");
      expect(sync.revision()).toBe(2);
      expect(sent).toHaveLength(1);
    });

    it("keeps a newer edit made during the save instead of the echo", async () => {
      const { sync, sent, answer } = manualSync(draftAt(1));
      sync.edit({ title: "a" });
      const flushed = sync.flush();
      await Promise.resolve();
      sync.edit({ title: "ab" });
      sync.adopt(draftAt(2, { title: "a" }));
      answer(0, { ok: true, draft: draftAt(2, { title: "a" }) });
      await vi.waitFor(() => expect(sent).toHaveLength(2));
      expect(sent[1]).toEqual({ expectedRevision: 2, fields: fieldsWith({ title: "ab" }) });
      answer(1, { ok: true, draft: draftAt(3) });
      expect(await flushed).toEqual({ ok: true });
      expect(sync.getSnapshot().conflict).toBeNull();
    });

    it("turns a held-back draft into a conflict when the save is rejected", async () => {
      const { sync, answer } = manualSync(draftAt(1));
      sync.edit({ title: "mine" });
      const flushed = sync.flush();
      await Promise.resolve();
      sync.adopt(draftAt(2, { markdown: "remote" }));
      expect(sync.getSnapshot().conflict).toBeNull();
      answer(0, { ok: false, message: "This ticket draft changed." });
      expect(await flushed).toEqual({ ok: false, message: "This ticket draft changed." });
      expect(sync.getSnapshot().conflict?.revision).toBe(2);
      expect(sync.getSnapshot().fields.title).toBe("mine");
      expect(sync.hasPendingEdits()).toBe(true);
    });
  });

  describe("a rejected save", () => {
    it("does not retry edits explicitly abandoned after a failed save", async () => {
      const save = vi.fn(async () => ({ ok: false as const, message: "Offline." }));
      const sync = createTicketDraftFieldSync({ initial: draftAt(1), save });
      sync.edit({ title: "discard me" });
      expect(await sync.flush()).toEqual({ ok: false, message: "Offline." });
      sync.abandon();
      expect(sync.hasPendingEdits()).toBe(false);
      expect(await sync.flush()).toEqual({ ok: true });
      expect(save).toHaveBeenCalledOnce();
    });
    it("keeps the edit so the next flush retries it", async () => {
      let fail = true;
      const sync = createTicketDraftFieldSync({
        initial: draftAt(0),
        save: async ({ expectedRevision, fields }) =>
          fail
            ? { ok: false, message: "Offline." }
            : { ok: true, draft: { ...draftAt(expectedRevision + 1), fields } },
      });
      sync.edit({ title: "keep me" });
      expect(await sync.flush()).toEqual({ ok: false, message: "Offline." });
      expect(sync.hasPendingEdits()).toBe(true);
      expect(sync.revision()).toBe(0);
      fail = false;
      expect(await sync.flush()).toEqual({ ok: true });
      expect(sync.revision()).toBe(1);
    });

    it("surfaces the remote write as a conflict once the snapshot refreshes, without losing the edit", async () => {
      const sync = createTicketDraftFieldSync({
        initial: draftAt(1),
        save: async () => ({ ok: false, message: "This ticket draft changed." }),
      });
      sync.edit({ title: "mine" });
      await sync.flush();
      expect(sync.getSnapshot().conflict).toBeNull();
      sync.adopt(draftAt(2, { markdown: "remote" }));
      expect(sync.getSnapshot().conflict?.fields.markdown).toBe("remote");
      expect(sync.getSnapshot().fields.title).toBe("mine");
      expect(sync.hasPendingEdits()).toBe(true);
    });

    it("recovers after the person keeps their edits", async () => {
      const sent: SaveInput[] = [];
      let reject = true;
      const sync = createTicketDraftFieldSync({
        initial: draftAt(1),
        save: async (input) => {
          sent.push(input);
          return reject
            ? { ok: false, message: "This ticket draft changed." }
            : { ok: true, draft: draftAt(input.expectedRevision + 1) };
        },
      });
      sync.edit({ title: "mine" });
      await sync.flush();
      sync.adopt(draftAt(3, { markdown: "remote" }));
      reject = false;
      sync.keepMine();
      expect(await sync.flush()).toEqual({ ok: true });
      expect(sent.at(-1)).toEqual({ expectedRevision: 3, fields: fieldsWith({ title: "mine" }) });
      expect(sync.revision()).toBe(4);
    });
  });
});
