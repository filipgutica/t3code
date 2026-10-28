import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import {
  WorkbenchArchiveTicketInput,
  WorkbenchArchiveProjectInput,
  WorkbenchDeleteProjectInput,
  WorkbenchCreateEpicInput,
  WorkbenchCreateTicketInput,
  WorkbenchDeleteTicketInput,
  WorkbenchReplaceAssignmentInput,
  WorkbenchSetJiraIssueLinkInput,
  WorkbenchSnapshot,
  WorkbenchTicket,
  WorkbenchTicketDraft,
  WorkbenchTicketKind,
  WorkbenchTicketStatus,
  WorkbenchUnlinkAssignmentInput,
  WorkbenchUpdateProjectInput,
  WorkbenchUpdateTicketInput,
  parseJiraIssueUrl,
  parseWorkbenchReferenceUrl,
  workbenchTicketIssueLabel,
} from "./workbench.ts";
import { AuthOrchestrationOperateScope } from "./auth.ts";
import { WORKBENCH_CLIENT_GUARDED_RPC_SCOPES } from "./workbenchRpcPermissions.ts";
import { WORKBENCH_WS_METHODS } from "./workbenchRpc.ts";
import { WsRpcGroup } from "./rpc.ts";

const decodeWorkbenchArchiveProjectInput = Schema.decodeUnknownEffect(WorkbenchArchiveProjectInput);
const decodeWorkbenchDeleteProjectInput = Schema.decodeUnknownEffect(WorkbenchDeleteProjectInput);
const decodeWorkbenchSnapshot = Schema.decodeUnknownEffect(WorkbenchSnapshot);
const decodeWorkbenchCreateEpicInput = Schema.decodeUnknownEffect(WorkbenchCreateEpicInput);
const decodeWorkbenchTicketStatus = Schema.decodeUnknownEffect(WorkbenchTicketStatus);
const decodeWorkbenchTicketKind = Schema.decodeUnknownEffect(WorkbenchTicketKind);
const decodeWorkbenchCreateTicketInput = Schema.decodeUnknownEffect(WorkbenchCreateTicketInput);
const decodeWorkbenchArchiveTicketInput = Schema.decodeUnknownEffect(WorkbenchArchiveTicketInput);
const decodeWorkbenchDeleteTicketInput = Schema.decodeUnknownEffect(WorkbenchDeleteTicketInput);
const decodeWorkbenchUpdateProjectInput = Schema.decodeUnknownEffect(WorkbenchUpdateProjectInput);
const decodeWorkbenchSetJiraIssueLinkInput = Schema.decodeUnknownEffect(
  WorkbenchSetJiraIssueLinkInput,
);
const decodeWorkbenchTicketDraft = Schema.decodeUnknownEffect(WorkbenchTicketDraft);
const decodeWorkbenchUpdateTicketInput = Schema.decodeUnknownEffect(WorkbenchUpdateTicketInput);
const decodeWorkbenchReplaceAssignmentInput = Schema.decodeUnknownEffect(
  WorkbenchReplaceAssignmentInput,
);
const decodeWorkbenchUnlinkAssignmentInput = Schema.decodeUnknownEffect(
  WorkbenchUnlinkAssignmentInput,
);

describe("Workbench contracts", () => {
  it.effect(
    "keeps compact snapshot markers optional and full snapshots compatible with legacy decoders",
    () =>
      Effect.gen(function* () {
        const legacyTicket = {
          id: "archived",
          projectId: "workspace",
          title: "Archived",
          markdown: "Full archived body",
          primaryT3ProjectId: "native",
          status: "done",
          blocked: false,
          archivedAt: "2026-10-17T10:00:00.000Z",
          createdAt: "2026-10-17T10:00:00.000Z",
          updatedAt: "2026-10-17T10:00:00.000Z",
        };
        const legacySnapshot = { projects: [], tickets: [legacyTicket], assignments: [] };
        const full = yield* decodeWorkbenchSnapshot(legacySnapshot);
        expect(full.tickets[0]?.markdownOmitted).toBeUndefined();
        expect(full.tickets[0]?.markdown).toBe("Full archived body");
        const compact = yield* decodeWorkbenchSnapshot({
          ...legacySnapshot,
          tickets: [{ ...legacyTicket, markdown: "", markdownOmitted: true }],
        });
        expect(compact.tickets[0]).toMatchObject({ markdown: "", markdownOmitted: true });
        const legacyDecoder = Schema.decodeUnknownEffect(
          Schema.Struct(Struct.omit(WorkbenchTicket.fields, ["markdownOmitted"])),
        );
        expect((yield* legacyDecoder(full.tickets[0])).markdown).toBe("Full archived body");
        const payload = WsRpcGroup.requests.get(
          WORKBENCH_WS_METHODS.workbenchGetSnapshot,
        )!.payloadSchema;
        const decodePayload = Schema.decodeEffect(payload);
        expect(yield* decodePayload({})).toEqual({});
        expect(yield* decodePayload({ compact: true })).toEqual({
          compact: true,
        });
      }),
  );

  it.effect("treats snapshots from older hosts as lacking Epic lifecycle support", () =>
    Effect.gen(function* () {
      const snapshot = yield* decodeWorkbenchSnapshot({
        projects: [],
        tickets: [],
        assignments: [],
      });
      expect(snapshot).not.toHaveProperty("supportsEpicLifecycle", true);
    }),
  );
  it.effect("decodes snapshots from hosts without Thread recaps", () =>
    Effect.gen(function* () {
      const snapshot = yield* decodeWorkbenchSnapshot({
        projects: [],
        tickets: [],
        assignments: [],
      });
      expect(snapshot.threadRecaps).toEqual([]);
      expect(snapshot.references).toEqual([]);
    }),
  );
  it.effect("decodes the persisted Project, Ticket, and Assignment snapshot", () =>
    Effect.gen(function* () {
      const snapshot = yield* decodeWorkbenchSnapshot({
        projects: [
          {
            id: "workbench-project-1",
            title: "Agent Workbench",
            linkedProjectIds: ["t3-project-1"],
            createdAt: "2026-09-03T12:00:00.000Z",
            updatedAt: "2026-09-03T12:00:00.000Z",
          },
        ],
        epics: [
          {
            id: "epic-1",
            projectId: "workbench-project-1",
            title: "Native planning",
            markdown: "Keep planning connected to execution.",
            archivedAt: null,
            createdAt: "2026-09-03T12:00:30.000Z",
            updatedAt: "2026-09-03T12:00:30.000Z",
          },
        ],
        tickets: [
          {
            id: "ticket-1",
            projectId: "workbench-project-1",
            title: "Create the first Ticket flow",
            epicId: "epic-1",
            kind: "story",
            markdown: "Keep the native T3 Thread experience.",
            primaryT3ProjectId: "t3-project-1",
            repositoryProjectIds: ["t3-project-1", "t3-project-2"],
            status: "in_progress",
            blocked: false,
            createdAt: "2026-09-03T12:01:00.000Z",
            updatedAt: "2026-09-03T12:02:00.000Z",
          },
        ],
        assignments: [
          {
            id: "assignment-1",
            ticketId: "ticket-1",
            threadId: "thread-1",
            createdAt: "2026-09-03T12:02:00.000Z",
            supersededAt: null,
          },
        ],
        ticketWorkspaces: [
          {
            ticketId: "ticket-1",
            attemptId: "attempt-1",
            status: "ready",
            branchName: "workbench/ticket-1-a1b2c3d4",
            errorMessage: null,
            repositories: [
              {
                projectId: "t3-project-1",
                isPrimary: true,
                sourcePath: "/repos/t3-project-1",
                worktreePath: "/worktrees/ticket-1/t3-project-1",
                branchName: "workbench/ticket-1-a1b2c3d4",
                status: "ready",
                errorMessage: null,
                createdAt: "2026-09-03T12:01:30.000Z",
                updatedAt: "2026-09-03T12:01:31.000Z",
              },
            ],
            createdAt: "2026-09-03T12:01:30.000Z",
            updatedAt: "2026-09-03T12:01:31.000Z",
          },
        ],
      });

      expect(snapshot.projects[0]).toMatchObject({ archivedAt: null, revision: 0 });
      expect(snapshot.projects[0]?.linkedProjectIds).toEqual(["t3-project-1"]);
      expect(snapshot.epics[0]).toMatchObject({ id: "epic-1", archivedAt: null });
      expect(snapshot.tickets[0]).toMatchObject({
        epicId: "epic-1",
        kind: "story",
        repositoryProjectIds: ["t3-project-1", "t3-project-2"],
        status: "in_progress",
      });
      expect(snapshot.assignments[0]?.threadId).toBe("thread-1");
      expect(snapshot.assignments[0]?.supersededAt).toBeNull();
      expect(snapshot.reservedThreadIds).toEqual([]);
      expect(snapshot.ticketWorkspaces[0]).toMatchObject({
        ticketId: "ticket-1",
        status: "ready",
        repositories: [expect.objectContaining({ projectId: "t3-project-1", isPrimary: true })],
      });
    }),
  );

  it.effect("requires lifecycle revisions and deletion counts for Workspaces", () =>
    Effect.gen(function* () {
      const archive = {
        id: "workspace",
        expectedRevision: 0,
        archivedAt: null,
        updatedAt: "2026-10-09T10:00:00.000Z",
      };
      const deletion = {
        id: "workspace",
        expectedRevision: 0,
        expectedTicketCount: 2,
        expectedEpicCount: 1,
        deletedAt: archive.updatedAt,
      };
      expect(yield* decodeWorkbenchArchiveProjectInput(archive)).toEqual(archive);
      expect(yield* decodeWorkbenchDeleteProjectInput(deletion)).toEqual(deletion);
      expect(
        (yield* Effect.exit(
          decodeWorkbenchArchiveProjectInput({
            ...archive,
            expectedRevision: undefined,
          }),
        ))._tag,
      ).toBe("Failure");
      expect(
        (yield* Effect.exit(
          decodeWorkbenchDeleteProjectInput({
            ...deletion,
            expectedTicketCount: undefined,
          }),
        ))._tag,
      ).toBe("Failure");
    }),
  );

  it.effect("rejects unknown Ticket statuses", () =>
    Effect.gen(function* () {
      expect(yield* decodeWorkbenchTicketStatus("todo")).toBe("todo");
      expect(yield* decodeWorkbenchTicketStatus("in_progress")).toBe("in_progress");
      expect(yield* decodeWorkbenchTicketStatus("done")).toBe("done");
      const result = yield* Effect.exit(decodeWorkbenchTicketStatus("reviewing"));
      const legacyResult = yield* Effect.exit(decodeWorkbenchTicketStatus("ready_for_review"));

      expect(result._tag).toBe("Failure");
      expect(legacyResult._tag).toBe("Failure");
    }),
  );

  it.effect("accepts only Story and Bug Ticket kinds", () =>
    Effect.gen(function* () {
      expect(yield* decodeWorkbenchTicketKind("story")).toBe("story");
      expect(yield* decodeWorkbenchTicketKind("bug")).toBe("bug");
      expect((yield* Effect.exit(decodeWorkbenchTicketKind("task")))._tag).toBe("Failure");
    }),
  );

  it.effect("decodes pre-type and pre-history Workbench payloads", () =>
    Effect.gen(function* () {
      const snapshot = yield* decodeWorkbenchSnapshot({
        projects: [],
        tickets: [
          {
            id: "ticket-1",
            projectId: "workbench-project-1",
            title: "Legacy Ticket",
            markdown: "Legacy body",
            primaryT3ProjectId: "t3-project-1",
            status: "todo",
            blocked: false,
            createdAt: "2026-09-03T12:00:00.000Z",
            updatedAt: "2026-09-03T12:00:00.000Z",
          },
        ],
        assignments: [
          {
            id: "assignment-1",
            ticketId: "ticket-1",
            threadId: "thread-1",
            createdAt: "2026-09-03T12:00:00.000Z",
          },
        ],
      });

      expect(snapshot.tickets[0]).toMatchObject({ kind: "story", repositoryProjectIds: [] });
      expect(snapshot.epics).toEqual([]);
      expect(snapshot.tickets[0]?.epicId).toBeNull();
      expect(snapshot.tickets[0]?.archivedAt).toBeUndefined();
      expect(snapshot.assignments[0]?.supersededAt).toBeNull();
      expect(snapshot.ticketWorkspaces).toEqual([]);
    }),
  );

  it.effect("requires a Ticket revision for mutation inputs", () =>
    Effect.gen(function* () {
      const createInput = yield* decodeWorkbenchCreateTicketInput({
        id: "ticket-1",
        projectId: "workbench-project-1",
        title: "Legacy Ticket",
        markdown: "Legacy body",
        primaryT3ProjectId: "t3-project-1",
        createdAt: "2026-09-03T12:00:00.000Z",
      });
      const updateInput = yield* decodeWorkbenchUpdateTicketInput({
        id: "ticket-1",
        expectedRevision: 0,
        title: "Legacy Ticket",
        markdown: "Updated legacy body",
        status: "in_progress",
        blocked: false,
        updatedAt: "2026-09-03T12:01:00.000Z",
      });
      const statusOnlyUpdateInput = yield* decodeWorkbenchUpdateTicketInput({
        id: "ticket-1",
        expectedRevision: 0,
        status: "in_progress",
        updatedAt: "2026-09-03T12:01:30.000Z",
      });
      const replaceInput = yield* decodeWorkbenchReplaceAssignmentInput({
        ticketId: "ticket-1",
        previousThreadId: "thread-1",
        threadId: "thread-2",
        replacedAt: "2026-09-03T12:02:00.000Z",
      });
      const unlinkInput = yield* decodeWorkbenchUnlinkAssignmentInput({
        ticketId: "ticket-1",
        threadId: "thread-1",
      });
      const epicInput = yield* decodeWorkbenchCreateEpicInput({
        id: "epic-1",
        projectId: "workbench-project-1",
        title: "Native planning",
        markdown: "",
        createdAt: "2026-09-03T12:00:00.000Z",
      });
      const archiveInput = yield* decodeWorkbenchArchiveTicketInput({
        ticketId: "ticket-1",
        archivedAt: null,
        expectedRevision: 0,
        updatedAt: "2026-09-03T12:03:00.000Z",
      });
      const deleteInput = yield* decodeWorkbenchDeleteTicketInput({
        ticketId: "ticket-1",
        expectedRevision: 0,
        deletedAt: "2026-09-03T12:04:00.000Z",
      });

      expect(createInput).toMatchObject({ kind: "story" });
      expect(createInput.epicId).toBeUndefined();
      expect(createInput.repositoryProjectIds).toBeUndefined();
      expect(updateInput.kind).toBeUndefined();
      expect(statusOnlyUpdateInput).toEqual({
        id: "ticket-1",
        expectedRevision: 0,
        status: "in_progress",
        updatedAt: "2026-09-03T12:01:30.000Z",
      });
      expect(updateInput.primaryT3ProjectId).toBeUndefined();
      expect(updateInput.repositoryProjectIds).toBeUndefined();
      expect(replaceInput.id).toBeUndefined();
      expect(unlinkInput).toEqual({ ticketId: "ticket-1", threadId: "thread-1" });
      expect(epicInput.title).toBe("Native planning");
      expect(archiveInput.archivedAt).toBeNull();
      expect(deleteInput.deletedAt).toBe("2026-09-03T12:04:00.000Z");
      expect(
        (yield* Effect.exit(
          decodeWorkbenchUpdateTicketInput({
            id: "ticket-1",
            title: "Legacy Ticket",
            markdown: "Updated legacy body",
            status: "in_progress",
            blocked: false,
            updatedAt: "2026-09-03T12:01:00.000Z",
          }),
        ))._tag,
      ).toBe("Failure");
    }),
  );

  it.effect("decodes Epic Jira links and Ticket References", () =>
    Effect.gen(function* () {
      const jiraIssue = {
        key: "ORBIT-375",
        url: "https://acme.atlassian.net/browse/ORBIT-375",
      };
      const epic = {
        id: "epic-1",
        projectId: "workspace",
        title: "Linked",
        markdown: "",
        archivedAt: null,
        createdAt: "2026-10-25T10:00:00.000Z",
        updatedAt: "2026-10-25T10:00:00.000Z",
      };
      const reference = {
        ticketId: "ticket-1",
        url: jiraIssue.url,
        title: null,
        addedByThreadId: null,
        createdAt: "2026-10-25T10:00:00.000Z",
      };
      const snapshot = yield* decodeWorkbenchSnapshot({
        projects: [],
        epics: [{ ...epic, jiraIssue }],
        tickets: [],
        assignments: [],
        references: [reference],
      });
      expect(snapshot.epics[0]?.jiraIssue).toEqual(jiraIssue);
      expect(snapshot.references).toEqual([reference]);
    }),
  );

  it.effect("requires the Epic version for a Jira link", () =>
    Effect.gen(function* () {
      const epicUnlink = {
        epicId: "epic-1",
        url: null,
        expectedUpdatedAt: "2026-10-25T10:00:00.000Z",
      };
      expect(yield* decodeWorkbenchSetJiraIssueLinkInput(epicUnlink)).toEqual(epicUnlink);
      for (const invalid of [
        { ...epicUnlink, expectedUpdatedAt: undefined },
        { ...epicUnlink, url: " " },
        { kind: "ticket", ticketId: "ticket-1", url: null, expectedRevision: 2 },
      ]) {
        expect((yield* Effect.exit(decodeWorkbenchSetJiraIssueLinkInput(invalid)))._tag).toBe(
          "Failure",
        );
      }
    }),
  );

  it.effect("decodes stored drafts that still carry removed Jira fields", () =>
    Effect.gen(function* () {
      const draft = yield* decodeWorkbenchTicketDraft({
        id: "draft-1",
        projectId: "workspace",
        threadId: "thread-1",
        anchorProjectId: "native",
        modelSelection: { instanceId: "codex", model: "gpt-5" },
        revision: 1,
        phase: "draft",
        fields: {
          title: "Draft",
          markdown: "",
          kind: "story",
          epicId: null,
          repositoryProjectIds: ["native"],
          primaryT3ProjectId: "native",
          localOnly: false,
          jiraSprintId: 12,
        },
        createdAt: "2026-10-25T10:00:00.000Z",
        updatedAt: "2026-10-25T10:00:00.000Z",
      });
      expect(draft.fields).not.toHaveProperty("localOnly");
      expect(draft.fields).not.toHaveProperty("jiraSprintId");
    }),
  );

  it.effect("decodes additive Workspace updates and rejects an empty link set", () =>
    Effect.gen(function* () {
      const updateInput = yield* decodeWorkbenchUpdateProjectInput({
        id: "workbench-project-1",
        title: "Renamed Workspace",
        linkedProjectIds: ["t3-project-2"],
        updatedAt: "2026-09-03T12:03:00.000Z",
      });
      const invalid = yield* Effect.exit(
        decodeWorkbenchUpdateProjectInput({
          id: "workbench-project-1",
          title: "Renamed Workspace",
          linkedProjectIds: [],
          updatedAt: "2026-09-03T12:03:00.000Z",
        }),
      );

      expect(updateInput).toEqual({
        id: "workbench-project-1",
        title: "Renamed Workspace",
        linkedProjectIds: ["t3-project-2"],
        updatedAt: "2026-09-03T12:03:00.000Z",
      });
      expect(invalid._tag).toBe("Failure");
    }),
  );

  it("requires operate scope for every Workbench mutation", () => {
    for (const scope of Object.values(WORKBENCH_CLIENT_GUARDED_RPC_SCOPES)) {
      expect(scope).toBe(AuthOrchestrationOperateScope);
    }
  });

  it("registers every Workbench RPC in the shared group", () => {
    expect(
      new Set([...WsRpcGroup.requests.keys()].filter((method) => method.startsWith("workbench."))),
    ).toEqual(new Set(Object.values(WORKBENCH_WS_METHODS)));
  });
});

describe("parseJiraIssueUrl", () => {
  it.each([
    ["https://acme.atlassian.net/browse/ORBIT-375", "ORBIT-375"],
    ["  https://acme.atlassian.net/browse/ORBIT-375  ", "ORBIT-375"],
    ["https://acme.atlassian.net/browse/orbit-375", "ORBIT-375"],
    ["https://acme.atlassian.net/browse/ORBIT-375/", "ORBIT-375"],
    ["https://acme.atlassian.net/browse/ORBIT-375?focusedCommentId=1", "ORBIT-375"],
    ["http://jira.internal:8080/jira/browse/OPS_2-9/activity", "OPS_2-9"],
    [
      "https://acme.atlassian.net/jira/software/projects/ORBIT/boards/1?selectedIssue=orbit-12",
      "ORBIT-12",
    ],
  ])("reads the issue key from %s", (input, key) => {
    expect(parseJiraIssueUrl(input)).toEqual({ key, url: new URL(input.trim()).href });
  });

  it.each([
    "",
    "ORBIT-375",
    "https://acme.atlassian.net/",
    "https://acme.atlassian.net/jira/software/projects/ORBIT/boards/1",
    "https://acme.atlassian.net/browse/",
    "https://acme.atlassian.net/browse/ORBIT",
    "https://acme.atlassian.net/browse/375-ORBIT",
    "https://acme.atlassian.net/issues/ORBIT-375",
    "https://acme.atlassian.net/board?selectedIssue=not a key",
    "javascript:alert('https://acme.atlassian.net/browse/ORBIT-375')",
    "ftp://acme.atlassian.net/browse/ORBIT-375",
    "data:text/html,https://acme.atlassian.net/browse/ORBIT-375",
  ])("rejects %s", (input) => {
    expect(parseJiraIssueUrl(input)).toBeNull();
  });
});

describe("parseWorkbenchReferenceUrl", () => {
  it.each([
    ["https://acme.atlassian.net/browse/ORBIT-375", "jira_issue", "ORBIT-375"],
    ["http://jira.internal:8080/jira/browse/OPS_2-9/activity", "jira_issue", "OPS_2-9"],
    [
      "https://acme.atlassian.net/jira/software/projects/ORBIT/boards/1?selectedIssue=orbit-12",
      "jira_issue",
      "ORBIT-12",
    ],
    ["https://github.com/acme/orbit-web/issues/61", "github_issue", "orbit-web#61"],
    ["https://www.figma.com/design/abc/Invite-modal", "link", "www.figma.com"],
    ["https://github.com/acme/orbit-web", "link", "github.com"],
    ["https://github.example.com/acme/orbit-web/issues/61", "link", "github.example.com"],
  ])("reads %s as %s", (input, kind, label) => {
    expect(parseWorkbenchReferenceUrl(`  ${input} `)).toEqual({
      url: new URL(input).href,
      kind,
      label,
    });
  });

  it.each([
    ["https://github.com/acme/orbit-web/pull/902", "https://github.com/acme/orbit-web/pull/902"],
    [
      "https://github.com/acme/orbit-web/pull/902/files#diff-1",
      "https://github.com/acme/orbit-web/pull/902",
    ],
    [
      "http://www.github.com/acme/orbit-web/pull/902/commits?w=1",
      "https://github.com/acme/orbit-web/pull/902",
    ],
  ])("stores one URL for every view of a PR: %s", (input, url) => {
    expect(parseWorkbenchReferenceUrl(input)).toEqual({
      url,
      kind: "github_pull_request",
      label: "orbit-web#902",
    });
  });

  it.each([
    ["/home/user/.t3/userdata/workbench-artifacts/ticket-1/plan.md", "plan.md"],
    ["/home/user/specs/", "specs"],
    ["C:\\Users\\user\\mockup.png", "mockup.png"],
    ["D:/designs/flow.svg", "flow.svg"],
  ])("reads the absolute path %s as a file", (input, label) => {
    expect(parseWorkbenchReferenceUrl(` ${input} `)).toEqual({ url: input, kind: "file", label });
  });

  it.each([
    "",
    "ORBIT-375",
    "spec.md",
    "./spec.md",
    "/",
    "//nas/share/spec.md",
    `/${"a".repeat(2_048)}`,
    "javascript:alert(1)",
    "ftp://acme.atlassian.net/browse/ORBIT-375",
    `https://example.com/${"a".repeat(2_048)}`,
  ])("rejects %s", (input) => {
    expect(parseWorkbenchReferenceUrl(input)).toBeNull();
  });

  it("labels a Ticket with its first issue Reference", () => {
    const urls = (...values: ReadonlyArray<string>) => values.map((url) => ({ url }));
    expect(
      workbenchTicketIssueLabel(
        urls(
          "https://github.com/acme/orbit-web/pull/902",
          "https://figma.com/file",
          "https://github.com/acme/orbit-web/issues/61",
          "https://acme.atlassian.net/browse/ORBIT-1",
        ),
      ),
    ).toBe("orbit-web#61");
    expect(workbenchTicketIssueLabel(urls("https://figma.com/file"))).toBeNull();
  });
});
