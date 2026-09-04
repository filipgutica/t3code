import { assert, describe, it } from "@effect/vitest";
import {
  ProjectId,
  WorkbenchJiraBindingId,
  WorkbenchJiraConnectionId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchJiraBinding,
  type WorkbenchJiraIssueLink,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import { JiraApi } from "./JiraApi.ts";
import * as JiraSyncService from "./JiraSyncService.ts";
import { JiraTicketImporter } from "./JiraTicketImporter.ts";
import {
  WorkbenchJiraRepository,
  type WorkbenchJiraRepositoryShape,
} from "./WorkbenchJiraRepository.ts";

const bindingId = WorkbenchJiraBindingId.make("binding-1");
const existingTicketId = WorkbenchTicketId.make("ticket-1");
const unseenTicketId = WorkbenchTicketId.make("ticket-2");

const binding: WorkbenchJiraBinding = {
  id: bindingId,
  projectId: WorkbenchProjectId.make("workspace-1"),
  connectionId: WorkbenchJiraConnectionId.make("connection-1"),
  jiraProjectId: "10000",
  jiraProjectKey: "WB",
  jiraProjectName: "Workbench",
  boardId: 42,
  boardName: "Workbench board",
  sprintId: 7,
  sprintName: "Sprint 7",
  defaultPrimaryT3ProjectId: ProjectId.make("project-1"),
  defaultRepositoryProjectIds: [ProjectId.make("project-1")],
  statusMappings: [{ jiraStatusId: "2", workbenchStatus: "in_progress" }],
  active: true,
  lastSyncedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const oldIssue = (issueId: string): WorkbenchJiraIssueLink => ({
  bindingId,
  ticketId: issueId === "10001" ? existingTicketId : unseenTicketId,
  issue: {
    issueId,
    key: `WB-${issueId}`,
    url: `https://example.atlassian.net/browse/WB-${issueId}`,
    summary: "Old summary",
    issueType: { id: "story", name: "Story" },
    status: { id: "2", name: "In Progress" },
    epic: null,
    flagged: false,
    rank: 0,
    remoteUpdatedAt: null,
  },
  active: true,
  linkedAt: "2026-09-01T00:00:00.000Z",
  lastSeenAt: "2026-09-01T00:00:00.000Z",
});

describe("JiraSyncService", () => {
  it.effect("preserves existing Ticket identity and deactivates issues no longer assigned", () =>
    Effect.gen(function* () {
      let links: ReadonlyArray<WorkbenchJiraIssueLink> = [oldIssue("10001"), oldIssue("10002")];
      let savedBinding: WorkbenchJiraBinding = binding;
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.none()),
        getConnection: () => Effect.succeed(Option.none()),
        listConnections: () => Effect.succeed([]),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        getBinding: () => Effect.succeed(Option.some(binding)),
        listBindings: () => Effect.succeed([binding]),
        upsertBinding: (next) =>
          Effect.sync(() => {
            savedBinding = next;
          }),
        listIssueLinks: () => Effect.succeed(links),
        replaceIssueLinks: (_id, next) =>
          Effect.sync(() => {
            links = next;
          }),
      } satisfies WorkbenchJiraRepositoryShape);
      const api = JiraApi.of({
        listProjects: () => Effect.die("unexpected project read"),
        listBoards: () => Effect.die("unexpected board read"),
        listSprints: () => Effect.die("unexpected sprint read"),
        getBoardConfiguration: () => Effect.die("unexpected configuration read"),
        listAssignedSprintIssues: () =>
          Effect.succeed([
            {
              ...oldIssue("10001").issue,
              summary: "Updated from Jira",
            },
          ]),
      });
      const importer = JiraTicketImporter.of({
        upsertJiraProjection: ({ existingTicketId: id }) =>
          id === null ? Effect.die("expected existing Ticket link") : Effect.succeed(id),
      });
      const service = yield* JiraSyncService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraTicketImporter, importer),
      );

      const result = yield* service.syncBinding({ bindingId });

      assert.strictEqual(result.updated, 1);
      assert.strictEqual(result.deactivated, 1);
      assert.strictEqual(links[0]?.ticketId, existingTicketId);
      assert.strictEqual(links[0]?.issue.summary, "Updated from Jira");
      assert.isFalse(links[1]?.active ?? true);
      assert.isNotNull(savedBinding.lastSyncedAt);
    }),
  );

  it.effect("serializes concurrent synchronization for the same binding", () =>
    Effect.gen(function* () {
      const firstRequestStarted = yield* Deferred.make<void>();
      const releaseFirstRequest = yield* Deferred.make<void>();
      const apiCallCount = yield* Ref.make(0);
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.none()),
        getConnection: () => Effect.succeed(Option.none()),
        listConnections: () => Effect.succeed([]),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        getBinding: () => Effect.succeed(Option.some(binding)),
        listBindings: () => Effect.succeed([binding]),
        upsertBinding: () => Effect.void,
        listIssueLinks: () => Effect.succeed([]),
        replaceIssueLinks: () => Effect.void,
      } satisfies WorkbenchJiraRepositoryShape);
      const api = JiraApi.of({
        listProjects: () => Effect.die("unexpected project read"),
        listBoards: () => Effect.die("unexpected board read"),
        listSprints: () => Effect.die("unexpected sprint read"),
        getBoardConfiguration: () => Effect.die("unexpected configuration read"),
        listAssignedSprintIssues: () =>
          Effect.gen(function* () {
            const call = yield* Ref.updateAndGet(apiCallCount, (count) => count + 1);
            if (call === 1) {
              yield* Deferred.succeed(firstRequestStarted, undefined);
              yield* Deferred.await(releaseFirstRequest);
            }
            return [];
          }),
      });
      const importer = JiraTicketImporter.of({
        upsertJiraProjection: () => Effect.die("unexpected Ticket import"),
      });
      const service = yield* JiraSyncService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraTicketImporter, importer),
      );

      const first = yield* service.syncBinding({ bindingId }).pipe(Effect.forkChild);
      yield* Deferred.await(firstRequestStarted);
      const second = yield* service.syncBinding({ bindingId }).pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      assert.strictEqual(yield* Ref.get(apiCallCount), 1);
      yield* Deferred.succeed(releaseFirstRequest, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      assert.strictEqual(yield* Ref.get(apiCallCount), 2);
    }),
  );
});
