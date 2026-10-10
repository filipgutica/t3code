import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  findTicketDraftSuggestion,
  getUnsavedConversationDrafts,
  getConversationDraftTitle,
  pickNewestConversationDraft,
  resolveTicketPlanningModelSelection,
  resolveWorkbenchWorkItemView,
  canDiscardConversationDraft,
  supportsConversationDrafts,
  supportsEnforcedTicketPlanning,
  type WorkbenchConversationDraft,
  type WorkbenchSuggestionMessage,
} from "./workbenchTicketDraft.logic";

const workspaceId = WorkbenchProjectId.make("workspace");
const otherWorkspaceId = WorkbenchProjectId.make("other-workspace");
const ticketId = WorkbenchTicketId.make("ticket");
const repoA = ProjectId.make("repo-a");
const repoB = ProjectId.make("repo-b");
const time = "2026-10-01T00:00:00.000Z";

const makeDraft = (
  overrides: Partial<WorkbenchConversationDraft> = {},
): WorkbenchConversationDraft => ({
  id: ticketId,
  projectId: workspaceId,
  threadId: ThreadId.make("thread"),
  anchorProjectId: repoA,
  modelSelection: {
    instanceId: "codex",
    model: "gpt",
  } as WorkbenchConversationDraft["modelSelection"],
  revision: 0,
  phase: "draft",
  fields: {
    title: "",
    markdown: "",
    kind: "story",
    epicId: null,
    repositoryProjectIds: [],
    primaryT3ProjectId: null,
    localOnly: false,
    jiraSprintId: null,
  },
  createdAt: time,
  updatedAt: time,
  ...overrides,
});

const makeSnapshot = (drafts?: ReadonlyArray<WorkbenchConversationDraft>): WorkbenchSnapshot => ({
  projects: [],
  ...(drafts === undefined ? {} : { ticketDrafts: drafts }),
  epics: [],
  tickets: [],
  assignments: [],
  reservedThreadIds: [],
  ticketWorkspaces: [],
});

describe("conversation draft lookup", () => {
  it("tolerates hosts that omit ticketDrafts", () => {
    expect(getUnsavedConversationDrafts(makeSnapshot(), workspaceId)).toEqual([]);
    expect(getUnsavedConversationDrafts(null, workspaceId)).toEqual([]);
  });

  it("tells a host without conversation drafts from one with none yet", () => {
    expect(supportsConversationDrafts(makeSnapshot())).toBe(false);
    expect(supportsConversationDrafts(makeSnapshot([]))).toBe(true);
    expect(supportsConversationDrafts(null)).toBe(false);
  });

  it("finds only the Workspace's unsaved draft", () => {
    const planning = makeDraft({ id: WorkbenchTicketId.make("saved"), phase: "planning" });
    const elsewhere = makeDraft({
      id: WorkbenchTicketId.make("elsewhere"),
      projectId: otherWorkspaceId,
    });
    const unsaved = makeDraft();
    const snapshot = makeSnapshot([planning, elsewhere, unsaved]);
    expect(getUnsavedConversationDrafts(snapshot, workspaceId)).toEqual([unsaved]);
  });

  it("lists multiple drafts and prefers the prepared title over the conversation title", () => {
    const one = makeDraft();
    const two = makeDraft({ id: WorkbenchTicketId.make("second") });
    expect(getUnsavedConversationDrafts(makeSnapshot([one, two]), workspaceId)).toEqual([one, two]);
    expect(getConversationDraftTitle(one, "Explore retries")).toBe("Explore retries");
    expect(getConversationDraftTitle(one, "Prepare ticket")).toBe("Untitled draft");
    expect(
      getConversationDraftTitle(
        { ...one, fields: { ...one.fields, title: "Add retries" } },
        "Explore retries",
      ),
    ).toBe("Add retries");
  });
});

describe("canDiscardConversationDraft", () => {
  it("allows discarding an unsaved draft, including one whose Create ticket is uncertain", () => {
    for (const phase of ["creating", "draft", "promoting"] as const) {
      expect(canDiscardConversationDraft({ phase, ticketExists: false })).toBe(true);
    }
  });

  it("never allows it once the saved ticket exists", () => {
    for (const phase of ["draft", "promoting", "planning", "starting", "working"] as const) {
      expect(canDiscardConversationDraft({ phase, ticketExists: true })).toBe(false);
    }
  });

  it("does not offer it for a draft that is planning, working, or already discarding", () => {
    for (const phase of ["planning", "starting", "working", "discarding"] as const) {
      expect(canDiscardConversationDraft({ phase, ticketExists: false })).toBe(false);
    }
  });
});

describe("resolveWorkbenchWorkItemView", () => {
  const base = {
    workspaceId,
    selectedTicketId: null,
    ticketExists: false,
    hasSelectedEpic: false,
    createTicket: false,
  };

  it("starts a fresh conversation for create=ticket even when drafts exist", () => {
    const draft = makeDraft();
    expect(
      resolveWorkbenchWorkItemView({
        ...base,
        snapshot: makeSnapshot([draft]),
        createTicket: true,
      }),
    ).toEqual({ kind: "conversation", draft: null });
    expect(
      resolveWorkbenchWorkItemView({ ...base, snapshot: makeSnapshot([]), createTicket: true }),
    ).toEqual({ kind: "conversation", draft: null });
  });

  it("keeps an accepted begin in the conversation while its snapshot arrives", () => {
    expect(
      resolveWorkbenchWorkItemView({
        ...base,
        snapshot: makeSnapshot([]),
        selectedTicketId: ticketId,
        awaitingTicketId: ticketId,
      }),
    ).toEqual({ kind: "conversation", draft: null });
  });

  it("resumes the selected draft instead of another draft in the same workspace", () => {
    const first = makeDraft({ id: WorkbenchTicketId.make("first") });
    const second = makeDraft();
    expect(
      resolveWorkbenchWorkItemView({
        ...base,
        snapshot: makeSnapshot([first, second]),
        selectedTicketId: ticketId,
      }),
    ).toEqual({ kind: "conversation", draft: second });
  });

  it("returns to the board when the conversation is closed", () => {
    expect(
      resolveWorkbenchWorkItemView({ ...base, snapshot: makeSnapshot([makeDraft()]) }),
    ).toEqual({ kind: "board" });
  });

  it("opens the same conversation for a planning or starting ticket", () => {
    for (const phase of ["planning", "starting"] as const) {
      const draft = makeDraft({ phase });
      expect(
        resolveWorkbenchWorkItemView({
          ...base,
          snapshot: makeSnapshot([draft]),
          selectedTicketId: ticketId,
          ticketExists: true,
        }),
      ).toEqual({ kind: "conversation", draft });
    }
  });

  it("keeps the conversation while Create ticket waits for the snapshot to hold the ticket", () => {
    // The ticket id is selected first; the stale snapshot still has the draft and no ticket.
    for (const phase of ["creating", "draft", "promoting", "discarding"] as const) {
      const draft = makeDraft({ phase });
      expect(
        resolveWorkbenchWorkItemView({
          ...base,
          snapshot: makeSnapshot([draft]),
          selectedTicketId: ticketId,
          ticketExists: false,
        }),
      ).toEqual({ kind: "conversation", draft });
    }
  });

  it("shows the board for a selected id that has neither a ticket nor a draft", () => {
    expect(
      resolveWorkbenchWorkItemView({
        ...base,
        snapshot: makeSnapshot(),
        selectedTicketId: ticketId,
        ticketExists: false,
      }),
    ).toEqual({ kind: "board" });
  });

  it("uses the ordinary ticket view once work has started or for tickets without a draft", () => {
    const working = makeDraft({ phase: "working" });
    expect(
      resolveWorkbenchWorkItemView({
        ...base,
        snapshot: makeSnapshot([working]),
        selectedTicketId: ticketId,
        ticketExists: true,
      }),
    ).toEqual({ kind: "ticket" });
    expect(
      resolveWorkbenchWorkItemView({
        ...base,
        snapshot: makeSnapshot(),
        selectedTicketId: ticketId,
        ticketExists: true,
      }),
    ).toEqual({ kind: "ticket" });
  });

  it("prefers a selected ticket over a leftover create intent", () => {
    expect(
      resolveWorkbenchWorkItemView({
        ...base,
        snapshot: makeSnapshot(),
        selectedTicketId: ticketId,
        ticketExists: true,
        createTicket: true,
      }),
    ).toEqual({ kind: "ticket" });
  });
});

describe("findTicketDraftSuggestion", () => {
  const known = new Set<string>([repoA, repoB]);
  const fenced = (payload: unknown) =>
    `Here is a proposal.\n\n\`\`\`workbench-ticket-draft\n${
      typeof payload === "string" ? payload : JSON.stringify(payload)
    }\n\`\`\`\n`;
  const proposal = {
    title: " Add retry ",
    markdown: "## Goal\nRetry.",
    repositoryProjectIds: [repoA, repoB],
    primaryT3ProjectId: repoB,
  };
  const assistant = (id: string, text: string, streaming = false): WorkbenchSuggestionMessage => ({
    id,
    role: "assistant",
    text,
    streaming,
  });
  const find = (messages: ReadonlyArray<WorkbenchSuggestionMessage>) =>
    findTicketDraftSuggestion({ messages, knownRepositoryProjectIds: known });

  it("reads a valid proposal and trims text", () => {
    expect(find([assistant("m1", fenced(proposal))])).toEqual({
      messageId: "m1",
      sourceOffset: fenced(proposal).indexOf("```"),
      title: "Add retry",
      markdown: "## Goal\nRetry.",
      repositoryProjectIds: [repoA, repoB],
      primaryT3ProjectId: repoB,
    });
  });

  it("uses the last block of the newest completed assistant message", () => {
    const text = `${fenced({ ...proposal, title: "First" })}\n${fenced({ ...proposal, title: "Second" })}`;
    expect(find([assistant("old", fenced(proposal)), assistant("new", text)])?.title).toBe(
      "Second",
    );
  });

  it.each(["```", "````", "~~~"])(
    "keeps %s fence identity when the plan contains code examples",
    (fence) => {
      const withCode = { ...proposal, markdown: "## Work\n```ts\nconst retry = true;\n```" };
      const text = `Intro\n\n  ${fence}workbench-ticket-draft\n${JSON.stringify(withCode)}\n  ${fence}`;
      const suggestion = find([assistant("m", text)]);
      expect(suggestion?.sourceOffset).toBe(text.indexOf(fence));
      expect(suggestion?.markdown).toBe(withCode.markdown);
    },
  );

  it("ignores a streaming message and falls back to the last completed proposal", () => {
    const suggestion = find([
      assistant("done", fenced(proposal)),
      assistant("live", fenced({ ...proposal, title: "Half written" }), true),
    ]);
    expect(suggestion?.messageId).toBe("done");
  });

  it("ignores user messages that quote the format", () => {
    expect(find([{ id: "u", role: "user", text: fenced(proposal), streaming: false }])).toBeNull();
  });

  it("does not resurrect an older proposal when the newest block is malformed", () => {
    expect(
      find([assistant("old", fenced(proposal)), assistant("bad", fenced("{ not json"))]),
    ).toBeNull();
  });

  it.each([
    ["an unknown repository", { ...proposal, repositoryProjectIds: [repoA, "stranger"] }],
    ["a primary outside the selection", { ...proposal, primaryT3ProjectId: "stranger" }],
    ["an empty repository list", { ...proposal, repositoryProjectIds: [] }],
    ["a blank title", { ...proposal, title: "   " }],
    ["a title over the field limit", { ...proposal, title: "x".repeat(241) }],
    ["missing fields", { title: "Only a title" }],
  ])("rejects %s", (_label, payload) => {
    expect(find([assistant("m", fenced(payload))])).toBeNull();
  });
});

describe("supportsEnforcedTicketPlanning", () => {
  it("matches the drivers the server can restrict to read-only", () => {
    expect(supportsEnforcedTicketPlanning("codex")).toBe(true);
    expect(supportsEnforcedTicketPlanning("claudeAgent")).toBe(true);
    expect(supportsEnforcedTicketPlanning("opencode")).toBe(false);
    expect(supportsEnforcedTicketPlanning(undefined)).toBe(false);
  });
});

describe("resolveTicketPlanningModelSelection", () => {
  const codex = ProviderInstanceId.make("codex");
  const claude = ProviderInstanceId.make("claudeAgent");
  const cursor = ProviderInstanceId.make("cursor");
  const candidates = [
    { instanceId: cursor, driverKind: "cursor", ready: true, defaultModel: "auto" },
    { instanceId: codex, driverKind: "codex", ready: true, defaultModel: "gpt-default" },
    { instanceId: claude, driverKind: "claudeAgent", ready: false, defaultModel: "sonnet" },
  ];

  it("keeps the first preferred selection the server can enforce", () => {
    const sticky = { instanceId: codex, model: "gpt-chosen" } as const;
    expect(
      resolveTicketPlanningModelSelection({
        candidates,
        preferred: [{ instanceId: cursor, model: "auto" }, null, sticky],
      }),
    ).toEqual(sticky);
  });

  it("falls back to the first ready supported provider's default model", () => {
    const selection = resolveTicketPlanningModelSelection({ candidates, preferred: [] });
    expect(selection?.instanceId).toBe(codex);
    expect(selection?.model).toBe("gpt-default");
  });

  it("returns null when no ready provider can plan", () => {
    expect(
      resolveTicketPlanningModelSelection({
        candidates: [candidates[0]!, candidates[2]!],
        preferred: [{ instanceId: claude, model: "sonnet" }],
      }),
    ).toBeNull();
  });
});

describe("pickNewestConversationDraft", () => {
  it("prefers the higher revision of the same draft", () => {
    const stale = makeDraft({ revision: 1 });
    const fresh = makeDraft({ revision: 2, phase: "planning" });
    expect(pickNewestConversationDraft(stale, fresh)).toBe(fresh);
    expect(pickNewestConversationDraft(fresh, stale)).toBe(fresh);
  });

  it("falls back to whichever record exists and prefers the snapshot for a different draft", () => {
    const draft = makeDraft();
    const other = makeDraft({ id: WorkbenchTicketId.make("other"), revision: 9 });
    expect(pickNewestConversationDraft(null, draft)).toBe(draft);
    expect(pickNewestConversationDraft(draft, null)).toBe(draft);
    expect(pickNewestConversationDraft(draft, other)).toBe(draft);
    expect(pickNewestConversationDraft(null, null)).toBeNull();
  });
});
