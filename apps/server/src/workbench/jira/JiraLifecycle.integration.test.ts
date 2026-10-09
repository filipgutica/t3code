import { seedNativeThread } from "../testing/nativeThreads.ts";
import {
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchJiraBindingId,
  WorkbenchJiraConnectionId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchJiraBinding,
  type WorkbenchJiraConnection,
  type WorkbenchJiraIssueLink,
  type WorkbenchJiraIssueSnapshot,
  type WorkbenchJiraSprint,
  WorkbenchJiraOperationError,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as GitWorkflowService from "../../git/GitWorkflowService.ts";
import { WorkbenchStore, WorkbenchStoreLive } from "../WorkbenchStore.ts";
import { JiraApi } from "@t3tools/workbench/jira/JiraApi";
import * as JiraSyncService from "@t3tools/workbench/jira/JiraSyncService";
import { JiraSyncService as JiraSyncServiceTag } from "@t3tools/workbench/jira/JiraSyncService";
import { JiraAuthService } from "@t3tools/workbench/jira/JiraAuthService";
import {
  JiraTicketImporter,
  layer as jiraTicketImporterLayer,
} from "@t3tools/workbench/jira/JiraTicketImporter";
import * as JiraTicketWriteService from "@t3tools/workbench/jira/JiraTicketWriteService";
import * as WorkbenchJiraService from "@t3tools/workbench/jira/WorkbenchJiraService";
import * as WorkspaceLifecycleService from "@t3tools/workbench/WorkspaceLifecycleService";
import {
  layerSql as jiraRepositoryLayer,
  WorkbenchJiraRepository,
} from "@t3tools/workbench/jira/WorkbenchJiraRepository";

const TestLayer = jiraTicketImporterLayer.pipe(
  Layer.provideMerge(WorkbenchStoreLive),
  Layer.provideMerge(jiraRepositoryLayer),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provideMerge(
    Layer.mock(GitWorkflowService.GitWorkflowService, {
      isRepository: () => Effect.succeed(true),
    }),
  ),
);

const createdAt = "2026-09-01T00:00:00.000Z";
const workspaceId = WorkbenchProjectId.make("jira-lifecycle-workspace");
const primaryProjectId = ProjectId.make("jira-lifecycle-primary");
const secondaryProjectId = ProjectId.make("jira-lifecycle-secondary");
const ticketId = WorkbenchTicketId.make("jira-lifecycle-ticket");
const threadId = ThreadId.make("jira-lifecycle-thread");
const assignmentId = WorkbenchAssignmentId.make("jira-lifecycle-assignment");
const bindingId = WorkbenchJiraBindingId.make("jira-lifecycle-binding");
const connectionId = WorkbenchJiraConnectionId.make("jira-lifecycle-connection");

const connection: WorkbenchJiraConnection = {
  id: connectionId,
  cloudId: "jira-lifecycle-cloud",
  siteName: "Lifecycle Jira",
  siteUrl: "https://lifecycle.atlassian.net",
  avatarUrl: null,
  scopes: ["read:project:jira", "read:sprint:jira-software", "write:jira-work"],
  createdAt,
  updatedAt: createdAt,
};

const makeBinding = (input: {
  readonly selectedSprints: ReadonlyArray<{ readonly id: number; readonly name: string }>;
  readonly observedActiveSprintIds: ReadonlyArray<number>;
}): WorkbenchJiraBinding => ({
  id: bindingId,
  projectId: workspaceId,
  connectionId,
  jiraProjectId: "10000",
  jiraProjectKey: "WB",
  jiraProjectName: "Workbench",
  boardId: 42,
  boardName: "Workbench board",
  sprintId: input.selectedSprints[0]!.id,
  sprintName: input.selectedSprints[0]!.name,
  defaultPrimaryT3ProjectId: primaryProjectId,
  defaultRepositoryProjectIds: [primaryProjectId, secondaryProjectId],
  statusMappings: [{ jiraStatusId: "2", workbenchStatus: "in_progress" }],
  selectedSprints: input.selectedSprints,
  followActiveSprint: true,
  observedActiveSprintIds: input.observedActiveSprintIds,
  boardMode: "mapped",
  boardColumns: [],
  active: true,
  lastSyncedAt: null,
  lastSyncError: null,
  createdAt,
  updatedAt: createdAt,
});

const makeSprint = (id: number, name = `Sprint ${id}`): WorkbenchJiraSprint => ({
  id,
  name,
  state: "active",
  goal: "",
  startDate: null,
  endDate: null,
  completeDate: null,
});

const makeIssue = ({
  summary,
  remoteUpdatedAt = "2026-09-01T00:00:00.000Z",
}: {
  readonly summary: string;
  readonly remoteUpdatedAt?: string;
}): WorkbenchJiraIssueSnapshot => ({
  issueId: "10001",
  key: "WB-1",
  url: "https://lifecycle.atlassian.net/browse/WB-1",
  summary,
  description: `${summary} description`,
  issueType: { id: "10001", name: "Story" },
  status: { id: "2", name: "In Progress" },
  epic: null,
  flagged: false,
  rank: 0,
  remoteUpdatedAt,
});

const makeIssueLink = (issue: WorkbenchJiraIssueSnapshot): WorkbenchJiraIssueLink => ({
  bindingId,
  ticketId,
  issue,
  active: true,
  linkedAt: createdAt,
  lastSeenAt: createdAt,
});

const seedState = (binding: WorkbenchJiraBinding) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const workbench = yield* WorkbenchStore;
    const repository = yield* WorkbenchJiraRepository;

    yield* sql`
      INSERT INTO projection_projects (
        project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
      ) VALUES
        (${primaryProjectId}, 'Primary repository', '/repos/primary', '[]', ${createdAt}, ${createdAt}, NULL),
        (${secondaryProjectId}, 'Secondary repository', '/repos/secondary', '[]', ${createdAt}, ${createdAt}, NULL)
    `;
    yield* seedNativeThread({
      threadId: threadId,
      projectId: primaryProjectId,
      title: "Lifecycle thread",
      createdAt: createdAt,
      deletedAt: null,
    });
    yield* workbench.createProject({
      id: workspaceId,
      title: "Jira lifecycle workspace",
      linkedProjectIds: [primaryProjectId, secondaryProjectId],
      createdAt,
    });
    yield* workbench.createTicket({
      id: ticketId,
      projectId: workspaceId,
      title: "Local ticket title",
      kind: "story",
      markdown: "Local ticket description",
      primaryT3ProjectId: primaryProjectId,
      repositoryProjectIds: [primaryProjectId, secondaryProjectId],
      createdAt,
    });
    yield* workbench.createAssignment({
      id: assignmentId,
      ticketId,
      threadId,
      createdAt,
    });
    yield* repository.upsertConnection(connection, "lifecycle-credential");
    yield* repository.upsertBinding(binding);
    yield* repository.replaceIssueLinks(bindingId, [
      makeIssueLink(makeIssue({ summary: "Seeded issue" })),
    ]);

    return { repository, workbench };
  });

const makeSyncService = ({
  api,
  importer,
  repository,
}: {
  readonly api: JiraApi["Service"];
  readonly importer: JiraTicketImporter["Service"];
  readonly repository: WorkbenchJiraRepository["Service"];
}) =>
  JiraSyncService.make.pipe(
    Effect.provideService(WorkbenchJiraRepository, repository),
    Effect.provideService(JiraApi, api),
    Effect.provideService(JiraTicketImporter, importer),
  );

const stubApi = (input: {
  readonly listSprints: () => Effect.Effect<ReadonlyArray<WorkbenchJiraSprint>>;
  readonly listAssignedSprintIssues: (
    sprintId: number,
  ) => Effect.Effect<ReadonlyArray<WorkbenchJiraIssueSnapshot>>;
}) =>
  JiraApi.of({
    listProjects: () => Effect.die("unexpected Jira project read"),
    listBoards: () => Effect.die("unexpected Jira board read"),
    listSprints: input.listSprints,
    getBoardConfiguration: () => Effect.die("unexpected Jira configuration read"),
    listAssignedSprintIssues: ({ sprintId }) => input.listAssignedSprintIssues(sprintId),
    prepareIssueCreation: () => Effect.die("unexpected Jira issue preparation"),
    createIssue: () => Effect.die("unexpected Jira issue creation"),
    addIssueToSprint: () => Effect.die("unexpected Jira sprint update"),
  });

describe("Jira lifecycle persistence", () => {
  it.effect(
    "serializes Workspace lifecycle with Jira I/O and retains native records and connections",
    () =>
      Effect.gen(function* () {
        const binding = makeBinding({
          selectedSprints: [{ id: 101, name: "Sprint 101" }],
          observedActiveSprintIds: [101],
        });
        const { repository, workbench } = yield* seedState(binding);
        const importer = yield* JiraTicketImporter;
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const lifecycleRequested = yield* Deferred.make<void>();
        let jiraReads = 0;
        const api = stubApi({
          listSprints: () => Effect.succeed([makeSprint(101)]),
          listAssignedSprintIssues: () =>
            Effect.gen(function* () {
              jiraReads += 1;
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);
              return [makeIssue({ summary: "Synced before archive" })];
            }),
        });
        const sync = yield* makeSyncService({ api, importer, repository });
        const lifecycleSync = JiraSyncServiceTag.of({
          ...sync,
          withBindingPermit: (id, effect) =>
            Deferred.succeed(lifecycleRequested, undefined).pipe(
              Effect.andThen(sync.withBindingPermit(id, effect)),
            ),
        });
        const lifecycle = yield* WorkspaceLifecycleService.WorkspaceLifecycleService.pipe(
          Effect.provide(WorkspaceLifecycleService.layer),
          Effect.provideService(JiraSyncServiceTag, lifecycleSync),
        );
        const refresh = yield* sync.syncBinding({ bindingId }).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        const archive = yield* lifecycle
          .archive({
            id: workspaceId,
            expectedRevision: 0,
            archivedAt: createdAt,
            updatedAt: createdAt,
          })
          .pipe(Effect.forkChild);
        yield* Deferred.await(lifecycleRequested);
        assert.strictEqual(
          Option.getOrThrow(yield* workbench.getProject(workspaceId)).archivedAt,
          null,
        );
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(refresh);
        const archived = yield* Fiber.join(archive);
        assert.strictEqual(archived.archivedAt, createdAt);
        assert.strictEqual(
          (yield* workbench.getSnapshot).tickets[0]?.title,
          "Synced before archive",
        );
        assert.strictEqual(
          (yield* sync.syncBinding({ bindingId }).pipe(Effect.flip)).code,
          "invalid_binding",
        );
        const writer = yield* JiraTicketWriteService.make.pipe(
          Effect.provideService(JiraSyncServiceTag, sync),
          Effect.provideService(JiraApi, api),
          Effect.provideService(
            JiraAuthService,
            JiraAuthService.of({
              begin: () => Effect.die("unexpected OAuth start"),
              complete: () => Effect.die("unexpected OAuth completion"),
              getAccessToken: () => Effect.die("archived Workspace must not read credentials"),
            }),
          ),
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("unexpected Jira write")),
          ),
        );
        assert.strictEqual(
          (yield* writer
            .updateTicket({
              ticketId,
              markdown: "Blocked edit",
              expectedRemoteUpdatedAt: createdAt,
            })
            .pipe(Effect.flip)).code,
          "invalid_binding",
        );
        assert.strictEqual(
          (yield* writer
            .createTicket({
              id: WorkbenchTicketId.make("archived-create"),
              projectId: workspaceId,
              title: "Blocked create",
              kind: "story",
              markdown: "",
              primaryT3ProjectId: primaryProjectId,
              createdAt,
              binding,
            })
            .pipe(Effect.flip)).code,
          "invalid_binding",
        );
        assert.strictEqual(jiraReads, 1);
        yield* repository.upsertBinding({ ...binding, active: false });
        const restored = yield* lifecycle.archive({
          id: workspaceId,
          expectedRevision: archived.revision ?? 0,
          archivedAt: null,
          updatedAt: createdAt,
        });
        assert.strictEqual(
          Option.getOrThrow(yield* repository.getBinding(bindingId)).active,
          false,
        );
        yield* lifecycle.delete({
          id: workspaceId,
          expectedRevision: restored.revision ?? 0,
          deletedAt: createdAt,
          expectedTicketCount: 1,
          expectedEpicCount: 0,
        });
        const snapshot = yield* workbench.getSnapshot;
        assert.strictEqual(snapshot.projects.length, 0);
        assert.strictEqual(snapshot.tickets.length, 0);
        assert.deepStrictEqual(yield* repository.listBindings(), []);
        assert.strictEqual((yield* repository.listConnections()).length, 1);
        assert.strictEqual(
          Option.getOrThrow(yield* repository.getCredentialId(connectionId)),
          "lifecycle-credential",
        );
        const sql = yield* SqlClient.SqlClient;
        assert.strictEqual(
          (yield* sql`SELECT project_id FROM projection_projects WHERE deleted_at IS NULL`).length,
          2,
        );
        assert.strictEqual(
          (yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL`)
            .length,
          1,
        );
        assert.strictEqual((yield* sql`SELECT assignment_id FROM workbench_assignments`).length, 1);
        assert.strictEqual((yield* sql`SELECT binding_id FROM workbench_jira_bindings`).length, 1);
        assert.strictEqual(jiraReads, 1);
      }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("rejects first-time Jira binding creation that finishes after Workspace archive", () =>
    Effect.gen(function* () {
      const binding = makeBinding({
        selectedSprints: [{ id: 101, name: "Sprint 101" }],
        observedActiveSprintIds: [101],
      });
      const { repository, workbench } = yield* seedState(binding);
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM workbench_jira_bindings WHERE binding_id = ${bindingId}`;
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const api = JiraApi.of({
        ...stubApi({
          listSprints: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as([makeSprint(101)]),
            ),
          listAssignedSprintIssues: () => Effect.die("unexpected Jira issue read"),
        }),
        getBoardConfiguration: () =>
          Effect.succeed({
            boardId: 42,
            name: "Workbench board",
            type: "scrum",
            columns: [],
            rankFieldId: null,
          }),
      });
      const importer = yield* JiraTicketImporter;
      const sync = yield* makeSyncService({ api, importer, repository });
      const service = yield* WorkbenchJiraService.make.pipe(
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraSyncServiceTag, sync),
        Effect.provideService(
          JiraAuthService,
          JiraAuthService.of({
            begin: () => Effect.die("unexpected OAuth start"),
            complete: () => Effect.die("unexpected OAuth completion"),
            getAccessToken: () => Effect.die("unexpected credential read"),
          }),
        ),
        Effect.provideService(
          JiraTicketWriteService.JiraTicketWriteService,
          JiraTicketWriteService.JiraTicketWriteService.of({
            createTicket: () => Effect.die("unexpected Ticket creation"),
            getTicketTransitions: () => Effect.die("unexpected transition lookup"),
            updateTicket: () => Effect.die("unexpected Ticket write"),
            startTicketExecution: () => Effect.die("unexpected Jira execution"),
          }),
        ),
      );
      const creation = yield* service.createBinding(binding).pipe(Effect.result, Effect.forkChild);
      yield* Deferred.await(started);
      const lifecycle = yield* WorkspaceLifecycleService.WorkspaceLifecycleService.pipe(
        Effect.provide(WorkspaceLifecycleService.layer),
        Effect.provideService(JiraSyncServiceTag, sync),
      );
      yield* lifecycle.archive({
        id: workspaceId,
        expectedRevision: 0,
        archivedAt: createdAt,
        updatedAt: createdAt,
      });
      yield* Deferred.succeed(release, undefined);
      const result = yield* Fiber.join(creation);
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") assert.strictEqual(result.failure.code, "invalid_binding");
      assert.deepStrictEqual(yield* repository.listBindings(), []);
      assert.strictEqual(
        Option.getOrThrow(yield* workbench.getProject(workspaceId)).archivedAt,
        createdAt,
      );
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect(
    "publishes one local Ticket in place and resumes sprint placement without another Jira issue",
    () =>
      Effect.gen(function* () {
        const initialBinding = makeBinding({
          selectedSprints: [{ id: 101, name: "Sprint 101" }],
          observedActiveSprintIds: [101],
        });
        const { repository, workbench } = yield* seedState(initialBinding);
        yield* repository.replaceIssueLinks(bindingId, []);
        yield* repository.upsertConnection(
          {
            ...connection,
            scopes: [...connection.scopes, "read:jira-user", "write:sprint:jira-software"],
          },
          "lifecycle-credential",
        );
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
        INSERT INTO workbench_ticket_workspaces (
          ticket_id, attempt_id, status, branch_name, error_message, created_at, updated_at
        ) VALUES (
          ${ticketId}, 'publication-attempt', 'ready', 'workbench/publication', NULL,
          ${createdAt}, ${createdAt}
        )
      `;
        yield* sql`
        INSERT INTO workbench_ticket_workspace_repositories (
          ticket_id, t3_project_id, attempt_id, is_primary, source_path, worktree_path,
          branch_name, status, error_message, created_at, updated_at
        ) VALUES (
          ${ticketId}, ${primaryProjectId}, 'publication-attempt', 1, '/repos/primary', '/worktrees/publication',
          'workbench/publication', 'ready', NULL, ${createdAt}, ${createdAt}
        )
      `;
        const before = yield* workbench.getSnapshot;
        const ticket = before.tickets.find((candidate) => candidate.id === ticketId)!;
        const issue = {
          ...makeIssue({ summary: ticket.title }),
          description: ticket.markdown,
        };
        const createCalls = yield* Ref.make(0);
        const placements = yield* Ref.make<Array<{ sprintId: number; issueKey: string }>>([]);
        const api = JiraApi.of({
          ...stubApi({
            listSprints: () => Effect.succeed([makeSprint(101)]),
            listAssignedSprintIssues: () => Effect.succeed([issue]),
          }),
          prepareIssueCreation: () =>
            Effect.succeed({ issueTypeId: "10001", accountId: "account-1" }),
          createIssue: () =>
            Ref.update(createCalls, (count) => count + 1).pipe(
              Effect.as({ id: issue.issueId, key: issue.key }),
            ),
          addIssueToSprint: ({ sprintId, issueKey }) =>
            Effect.gen(function* () {
              const attempts = yield* Ref.updateAndGet(placements, (entries) =>
                entries.concat({ sprintId, issueKey }),
              );
              if (attempts.length === 1)
                return yield* new WorkbenchJiraOperationError({
                  code: "request_failed",
                  message: "Sprint placement failed.",
                });
            }),
        });
        const importer = yield* JiraTicketImporter;
        const sync = yield* makeSyncService({ api, importer, repository });
        const auth = JiraAuthService.of({
          begin: () => Effect.die("unexpected Jira auth start"),
          complete: () => Effect.die("unexpected Jira auth completion"),
          getAccessToken: () => Effect.succeed("lifecycle-access-token"),
        });
        const dependencies = Layer.mergeAll(
          Layer.succeed(WorkbenchJiraRepository, repository),
          Layer.succeed(JiraApi, api),
          Layer.succeed(JiraAuthService, auth),
          Layer.succeed(JiraSyncServiceTag, sync),
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("unexpected direct HTTP request")),
          ),
        );
        const writer = yield* JiraTicketWriteService.make.pipe(Effect.provide(dependencies));
        const service = yield* WorkbenchJiraService.make.pipe(
          Effect.provide(dependencies),
          Effect.provideService(JiraTicketWriteService.JiraTicketWriteService, writer),
        );
        const input = {
          ...ticket,
          jiraSprintId: 101,
          existingLocalTicketRevision: ticket.revision,
        };
        const failed = yield* Effect.flip(service.createTicket(input));
        assert.strictEqual(failed.code, "request_failed");
        assert.deepStrictEqual(yield* workbench.getSnapshot, before);
        const published = yield* service.createTicket(input);
        assert.strictEqual(published.id, ticketId);
        assert.strictEqual(published.markdown, ticket.markdown);
        assert.deepStrictEqual(published.repositoryProjectIds, ticket.repositoryProjectIds);
        const after = yield* workbench.getSnapshot;
        assert.strictEqual(after.tickets.length, before.tickets.length);
        assert.deepStrictEqual(after.assignments, before.assignments);
        assert.deepStrictEqual(after.ticketWorkspaces, before.ticketWorkspaces);
        const links = yield* repository.listIssueLinks(bindingId);
        assert.strictEqual(links.length, 1);
        assert.strictEqual(links[0]?.ticketId, ticketId);
        assert.strictEqual(links[0]?.issue.key, "WB-1");
        assert.strictEqual(yield* Ref.get(createCalls), 1);
        assert.deepStrictEqual(yield* Ref.get(placements), [
          { sprintId: 101, issueKey: "WB-1" },
          { sprintId: 101, issueKey: "WB-1" },
        ]);
      }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect(
    "replaces an ended sprint without changing Ticket identity, repository scope, or assignment across service recreation",
    () =>
      Effect.gen(function* () {
        const initialBinding = makeBinding({
          selectedSprints: [
            { id: 101, name: "Sprint 101" },
            { id: 102, name: "Sprint 102" },
          ],
          observedActiveSprintIds: [101, 102],
        });
        const { repository, workbench } = yield* seedState(initialBinding);
        const localTicket = yield* workbench.createTicket({
          id: WorkbenchTicketId.make("local-only-ticket"),
          projectId: workspaceId,
          title: "Keep this Ticket local",
          kind: "story",
          markdown: "Local context",
          primaryT3ProjectId: primaryProjectId,
          createdAt,
        });
        const importer = yield* JiraTicketImporter;
        let activeSprints: ReadonlyArray<WorkbenchJiraSprint> = [makeSprint(101), makeSprint(102)];
        let issueSummary = "Initial Jira projection";
        const requestedSprintIds: Array<number> = [];
        const api = stubApi({
          listSprints: () => Effect.succeed(activeSprints),
          listAssignedSprintIssues: (sprintId) =>
            Effect.sync(() => {
              requestedSprintIds.push(sprintId);
              return [makeIssue({ summary: issueSummary })];
            }),
        });

        const firstService = yield* makeSyncService({ api, importer, repository });
        yield* firstService.syncBinding({ bindingId });

        activeSprints = [makeSprint(101), makeSprint(103)];
        issueSummary = "Rollover Jira projection";
        requestedSprintIds.length = 0;
        const restartedService = yield* makeSyncService({ api, importer, repository });
        yield* restartedService.syncBinding({ bindingId });

        const savedBinding = Option.getOrThrow(yield* repository.getBinding(bindingId));
        const links = yield* repository.listIssueLinks(bindingId);
        const snapshot = yield* workbench.getSnapshot;
        assert.deepStrictEqual(
          snapshot.tickets.find((ticket) => ticket.id === localTicket.id),
          localTicket,
        );
        assert.strictEqual(
          links.some((link) => link.ticketId === localTicket.id),
          false,
        );
        const savedTicket = snapshot.tickets.find((ticket) => ticket.id === ticketId);
        const savedAssignment = snapshot.assignments.find(
          (assignment) => assignment.ticketId === ticketId,
        );

        assert.deepStrictEqual(requestedSprintIds, [101, 103]);
        assert.deepStrictEqual(savedBinding.selectedSprints, [
          { id: 101, name: "Sprint 101" },
          { id: 103, name: "Sprint 103" },
        ]);
        assert.deepStrictEqual(savedBinding.observedActiveSprintIds, [101, 103]);
        assert.strictEqual(savedBinding.sprintId, 101);
        assert.strictEqual(savedBinding.sprintName, "Sprint 101");
        assert.strictEqual(links[0]?.ticketId, ticketId);
        assert.strictEqual(links[0]?.issue.summary, issueSummary);
        assert.strictEqual(savedTicket?.id, ticketId);
        assert.deepStrictEqual(savedTicket?.repositoryProjectIds, [
          primaryProjectId,
          secondaryProjectId,
        ]);
        assert.strictEqual(savedAssignment?.id, assignmentId);
        assert.isNull(savedBinding.lastSyncError);
      }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("keeps the persisted projection and sprint selection when rollover is ambiguous", () =>
    Effect.gen(function* () {
      const initialBinding = makeBinding({
        selectedSprints: [{ id: 201, name: "Sprint 201" }],
        observedActiveSprintIds: [201],
      });
      const { repository, workbench } = yield* seedState(initialBinding);
      const importer = yield* JiraTicketImporter;
      let activeSprints: ReadonlyArray<WorkbenchJiraSprint> = [makeSprint(201)];
      let issueSummary = "Stable Jira projection";
      const issueRead = yield* Ref.make(0);
      const api = stubApi({
        listSprints: () => Effect.succeed(activeSprints),
        listAssignedSprintIssues: () =>
          Ref.updateAndGet(issueRead, (count) => count + 1).pipe(
            Effect.as([makeIssue({ summary: issueSummary })]),
          ),
      });
      const service = yield* makeSyncService({ api, importer, repository });
      yield* service.syncBinding({ bindingId });

      activeSprints = [makeSprint(202), makeSprint(203)];
      issueSummary = "Should not replace stable projection";
      const error = yield* Effect.flip(service.syncBinding({ bindingId }));

      const savedBinding = Option.getOrThrow(yield* repository.getBinding(bindingId));
      const links = yield* repository.listIssueLinks(bindingId);
      const snapshot = yield* workbench.getSnapshot;

      assert.strictEqual(error.code, "invalid_binding");
      assert.isTrue(error.message.includes("Multiple new active Jira sprints"));
      assert.strictEqual(yield* Ref.get(issueRead), 1);
      assert.deepStrictEqual(savedBinding.selectedSprints, [{ id: 201, name: "Sprint 201" }]);
      assert.deepStrictEqual(savedBinding.observedActiveSprintIds, [201]);
      assert.strictEqual(savedBinding.sprintId, 201);
      assert.strictEqual(links[0]?.issue.summary, "Stable Jira projection");
      assert.strictEqual(
        snapshot.tickets.find((ticket) => ticket.id === ticketId)?.title,
        "Stable Jira projection",
      );
      assert.isTrue(savedBinding.lastSyncError?.includes("Multiple new active") ?? false);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("serializes a delayed refresh and Jira-backed edit with the shared binding lock", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(createdAt));
      const initialBinding = makeBinding({
        selectedSprints: [{ id: 301, name: "Sprint 301" }],
        observedActiveSprintIds: [301],
      });
      const { repository, workbench } = yield* seedState(initialBinding);
      const importer = yield* JiraTicketImporter;
      const refreshStarted = yield* Deferred.make<void>();
      const releaseRefresh = yield* Deferred.make<void>();
      const editAttemptStarted = yield* Deferred.make<void>();
      const writerPermitEntered = yield* Deferred.make<void>();
      const httpPutStarted = yield* Deferred.make<void>();
      const issueReads = yield* Ref.make(0);
      const putCount = yield* Ref.make(0);
      const remoteIssue = yield* Ref.make(
        makeIssue({ summary: "Delayed refresh projection", remoteUpdatedAt: createdAt }),
      );
      const api = stubApi({
        listSprints: () => Effect.succeed([makeSprint(301)]),
        listAssignedSprintIssues: () =>
          Effect.gen(function* () {
            const read = yield* Ref.updateAndGet(issueReads, (count) => count + 1);
            if (read === 1) {
              yield* Deferred.succeed(refreshStarted, undefined);
              yield* Deferred.await(releaseRefresh);
            }
            return [yield* Ref.get(remoteIssue)];
          }),
      });
      const service = yield* makeSyncService({ api, importer, repository });
      const auth = JiraAuthService.of({
        begin: () => Effect.die("unexpected Jira auth start"),
        complete: () => Effect.die("unexpected Jira auth completion"),
        getAccessToken: () => Effect.succeed("lifecycle-access-token"),
      });
      const http = HttpClient.make((request) => {
        if (request.method !== "PUT") return Effect.die(`unexpected HTTP method ${request.method}`);
        const body =
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
        const description = (
          JSON.parse(body) as { readonly fields?: { readonly description?: string } }
        ).fields?.description;
        return Ref.updateAndGet(putCount, (count) => count + 1).pipe(
          Effect.andThen(
            Ref.update(remoteIssue, (issue) => ({
              ...issue,
              ...(description === undefined ? {} : { description }),
              remoteUpdatedAt: "2026-09-01T00:00:04.000Z",
            })),
          ),
          Effect.andThen(Deferred.succeed(httpPutStarted, undefined)),
          Effect.as(HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }))),
        );
      });
      const writer = yield* JiraTicketWriteService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraAuthService, auth),
        Effect.provideService(
          JiraSyncServiceTag,
          JiraSyncServiceTag.of({
            withBindingPermit: (id, effect) =>
              Deferred.succeed(writerPermitEntered, undefined).pipe(
                Effect.andThen(service.withBindingPermit(id, effect)),
              ),
            syncBinding: service.syncBinding,
          }),
        ),
        Effect.provideService(JiraTicketImporter, importer),
        Effect.provideService(HttpClient.HttpClient, http),
      );

      const refresh = yield* service.syncBinding({ bindingId }).pipe(Effect.forkChild);
      yield* Deferred.await(refreshStarted);
      // A completed refresh updates only its bookkeeping timestamp. A waiting writer should
      // still be allowed to proceed when the binding configuration is unchanged.
      yield* TestClock.adjust("1 second");
      const edit = yield* Effect.gen(function* () {
        yield* Deferred.succeed(editAttemptStarted, undefined);
        return yield* writer.updateTicket({
          ticketId,
          markdown: "Edit saved after refresh description",
          expectedRemoteUpdatedAt: createdAt,
        });
      }).pipe(Effect.forkChild);
      yield* Deferred.await(editAttemptStarted);
      yield* Deferred.await(writerPermitEntered);
      assert.strictEqual(yield* Ref.get(putCount), 0);
      assert.deepStrictEqual(yield* Deferred.poll(httpPutStarted), Option.none());

      yield* Deferred.succeed(releaseRefresh, undefined);
      yield* Fiber.join(refresh);
      const refreshedBinding = Option.getOrThrow(yield* repository.getBinding(bindingId));
      assert.strictEqual(refreshedBinding.updatedAt, "2026-09-01T00:00:01.000Z");
      const edited = yield* Fiber.join(edit);
      const persistedRemoteIssue = yield* Ref.get(remoteIssue);
      const snapshot = yield* workbench.getSnapshot;
      const persisted = snapshot.tickets.find((ticket) => ticket.id === ticketId);
      const links = yield* repository.listIssueLinks(bindingId);

      assert.strictEqual(edited.description, "Edit saved after refresh description");
      assert.strictEqual(persistedRemoteIssue.description, "Edit saved after refresh description");
      assert.strictEqual(persisted?.markdown, "Edit saved after refresh description");
      assert.strictEqual(links[0]?.issue.description, "Edit saved after refresh description");
      assert.strictEqual(persisted?.id, ticketId);
      assert.deepStrictEqual(persisted?.repositoryProjectIds, [
        primaryProjectId,
        secondaryProjectId,
      ]);
    }).pipe(Effect.provide(Layer.merge(TestLayer, TestClock.layer()))),
  );
});
